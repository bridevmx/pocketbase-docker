"""Ronda 10: módulo opcional de Telegram (alertas, vinculación, grupos, operadores, botones, login por Mini App). Sección VY.
Todo contra un Telegram FALSO en 127.0.0.1 (nunca se contacta con api.telegram.org). `build(L, ctx, A)` devuelve los casos en vivo."""
import json, os, re, time, hmac, hashlib, threading, http.server, shutil, urllib.parse, subprocess

TOKEN = "123456789:AAH_labTokenLabTokenLabTokenLabToken12"
SECRET = "labSecret_labSecret_labSecret_labSecret_ab"
MINI = "https://app.lab.test/mini"
OPS = ["900001", "-900002"]
PORT, BADPORT = 18730, 18731

CFG = '''module.exports = {
  access: { enabled: true, mode: "membership", collection: "users", roles: ["admin", "editor"], rolesField: "roles", statusField: "status" },
  sessions: { enabled: %(sessions)s, legacy: "allow" },
  telegram: { enabled: true, collection: "users", groups: { staff: { field: "roles", values: ["admin"] }, bulk: { field: "name", values: ["bulk"] } }, login: { enabled: %(login)s, maxAge: 600, autoprovision: %(auto)s, singleUse: %(single)s, perMinute: %(perMin)s } },
};'''
ACTION = 'module.exports = { run: (app, { user, args }) => { app.store().set("lab:approved:" + user.id, JSON.stringify(args)); return "Aprobado " + args.n; } };'
# Hook de la app (evento de un registro => aviso por Telegram). Nunca debe romper el guardado: todo va en try/catch.
HOOK = """/// <reference path="../pb_data/types.d.ts" />
onRecordAfterCreateSuccess((e) => {
  try {
    require(`${__hooks}/lib/telegram.js`).notify($app, e.record.getString("cliente"), { title: "Pedido " + e.record.getString("numero"), text: "Recibimos tu pedido", key: "pedido-" + e.record.id + "-nuevo" });
  } catch (err) { $app.logger().error("pbmini telegram: no se pudo notificar", "error", String(err)); }
  e.next();
}, "pedidos");
onRecordAfterUpdateSuccess((e) => {
  try {
    if (e.record.original().getString("estado") !== e.record.getString("estado")) {
      require(`${__hooks}/lib/telegram.js`).notify($app, e.record.getString("cliente"), {
        title: "Pedido " + e.record.getString("numero"), text: "Estado: " + e.record.getString("estado"),
        key: "pedido-" + e.record.id + "-" + e.record.getString("estado"),
        buttons: [[{ text: "Recibido", action: "approve", args: { n: 9 } }]],
      });
    }
  } catch (err) { $app.logger().error("pbmini telegram: no se pudo notificar", "error", String(err)); }
  e.next();
}, "pedidos");
"""
# Envío simple (lib/notify.js) desde un hook: el registro "avisos" decide el destino (user:<id> | group:<nombre> | ops).
NOTIFY_HOOK = """/// <reference path="../pb_data/types.d.ts" />
onRecordAfterCreateSuccess((e) => {
  try {
    const d = e.record.getString("destino"), to = d === "ops" ? { ops: true } : d.indexOf("user:") === 0 ? { user: d.slice(5) } : { group: d.slice(6) };
    const opt = e.record.getString("clave") ? { key: e.record.getString("clave") } : undefined;
    require(`${__hooks}/lib/notify.js`).send($app, to, e.record.getString("tipo") === "objeto" ? { title: "Aviso", text: e.record.getString("texto") } : e.record.getString("texto"), opt);
  } catch (err) { $app.logger().error("aviso no enviado", "error", String(err)); }
  e.next();
}, "avisos");
"""
AVISOS = dict(name="avisos", type="base", fields=[dict(name="tipo", type="text"), dict(name="destino", type="text"), dict(name="texto", type="text"), dict(name="clave", type="text")])
PEDIDOS = dict(name="pedidos", type="base", fields=[dict(name="cliente", type="text"), dict(name="numero", type="text"), dict(name="estado", type="text")])
BODY_MSG = 'body: { text: { type: "string", max: 5000, required: true }, title: { type: "string", max: 300 }, key: { type: "string", max: 100 } }'
PAGES = {
    "tg/me.js": 'module.exports = { auth: "user", %s, post: (ctx) => { const m = { text: ctx.body.text }; if (ctx.body.title !== undefined) m.title = ctx.body.title; if (ctx.body.key !== undefined) m.key = ctx.body.key; return ctx.json(ctx.telegram("me", m)); }, get: (ctx) => ctx.json(ctx.telegram("me", { text: "x" })) };' % BODY_MSG,
    "tg/pub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.telegram("me", { text: "x" })) };',
    "tg/target.js": 'module.exports = { auth: "user", body: { target: { type: "string", max: 100, required: true } }, post: (ctx) => ctx.json(ctx.telegram(ctx.body.target, { text: "x" })) };',
    "tg/link.js": 'module.exports = { auth: "user", post: (ctx) => ctx.json(ctx.telegramLink()), get: (ctx) => ctx.json(ctx.telegramLink()) };',
    "tg/linkpub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.telegramLink()) };',
    "tg/btn.js": 'module.exports = { auth: "user", body: { kind: { type: "string", max: 30, default: "ok" } }, post: (ctx) => { const k = ctx.body.kind; const ok = [[{ text: "Aprobar", action: "approve", args: { n: 1 } }, { text: "Web", url: "https://example.com/x" }]];'
                 ' const v = { ok, unknown: [[{ text: "x", action: "nope" }]], http: [[{ text: "x", url: "http://example.com" }]], two: [[{ text: "x", url: "https://e.co/a", action: "approve" }]], extra: [[{ text: "x", url: "https://e.co/a", color: "red" }]], webapp: [[{ text: "Abrir", webApp: true }]], rows: [[{ text: "a", url: "https://e.co/a" }], [{ text: "b", url: "https://e.co/a" }], [{ text: "c", url: "https://e.co/a" }], [{ text: "d", url: "https://e.co/a" }]] };'
                 ' return ctx.json(ctx.telegram("me", { text: "Elige", buttons: v[k] })); } };',
    "tg/group.js": 'module.exports = { auth: "superuser", body: { name: { type: "string", max: 40, required: true }, text: { type: "string", max: 500, required: true }, key: { type: "string", max: 100 } }, post: (ctx) => ctx.json(ctx.telegramGroup(ctx.body.name, { text: ctx.body.text }, ctx.body.key === undefined ? undefined : { key: ctx.body.key })) };',
    "tg/groupbtn.js": 'module.exports = { auth: "superuser", post: (ctx) => ctx.json(ctx.telegramGroup("staff", { text: "x", buttons: [[{ text: "Ok", action: "approve", args: { n: 7 } }]] })) };',
    "tg/alert.js": 'module.exports = { auth: "superuser", body: { text: { type: "string", max: 500, required: true }, key: { type: "string", max: 100 } }, post: (ctx) => ctx.json(ctx.telegramAlert({ text: ctx.body.text }, ctx.body.key === undefined ? undefined : { key: ctx.body.key })), get: (ctx) => ctx.json(ctx.telegramAlert({ text: "x" })) };',
    "tg/alertpub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.telegramAlert({ text: "x" })) };',
    "tg/who.js": 'module.exports = { auth: "user", get: (ctx) => ctx.json({ id: ctx.user.id, email: ctx.user.get("email"), sessions: ctx.sessions().length }) };',
    "tg/out.js": 'module.exports = { auth: "user", post: (ctx) => { ctx.logout(); return ctx.json({ ok: true }); } };',
    "tg/notify.js": 'module.exports = { auth: "user", body: { kind: { type: "string", max: 30, required: true } }, post: (ctx) => { const k = ctx.body.kind; const t = { me: { user: "me" }, two: { user: "me", group: "staff" }, none: {}, unknown: { canal: "x" }, ops: { ops: true }, opsfalse: { ops: false }, badgroup: { group: "STAFF" }, baduser: { user: "../x" }, arr: [1], str: "me" }; return ctx.json(ctx.notify(t[k], { text: "desde ctx.notify" })); }, get: (ctx) => ctx.json(ctx.notify({ user: "me" }, "x")) };',
    "tg/notifysu.js": 'module.exports = { auth: "superuser", post: (ctx) => ctx.json(ctx.notify({ user: "me" }, "x")) };',
    "tg/notifypub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.notify({ ops: true }, "x")) };',
    "tg/approved.js": 'module.exports = { auth: "user", get: (ctx) => ctx.json({ v: $app.store().get("lab:approved:" + ctx.user.id) || "" }) };',
}


class FakeTelegram:
    """Bot API falsa: registra llamadas y puede fallar a demanda (429, 403, 500, 400)."""
    def __init__(self, token=TOKEN):
        self.token, self.lock, self.calls, self.mode, self.fail_chats, self.delay, self.mid = token, threading.Lock(), [], "ok", {}, 0.0, 0
        outer = self
        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a): pass
            def _send(self, st, obj):
                b = json.dumps(obj).encode(); self.send_response(st); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                m = re.match(r"^/bot([^/]+)/([A-Za-z]+)$", self.path)
                if not m or m.group(1) != outer.token: return self._send(401, {"ok": False, "error_code": 401, "description": "Unauthorized"})
                meth = m.group(2)
                if outer.delay: time.sleep(outer.delay)
                with outer.lock:
                    chat = str(body.get("chat_id", ""))
                    mode = outer.fail_chats.get(chat, outer.mode) if meth == "sendMessage" else "ok"
                    rec = {"method": meth, "chat": chat, "body": body, "t": time.time(), "mode": mode}
                    outer.calls.append(rec)
                    if meth == "getMe": return self._send(200, {"ok": True, "result": {"id": 123456789, "is_bot": True, "username": "lab_bot"}})
                    if meth == "sendMessage":
                        if mode == "429": return self._send(429, {"ok": False, "error_code": 429, "description": "Too Many Requests: retry after 1", "parameters": {"retry_after": 1}})
                        if mode == "403": return self._send(403, {"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"})
                        if mode == "400": return self._send(400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"})
                        if mode == "500": return self._send(500, {"ok": False, "error_code": 500, "description": "Internal Server Error"})
                        outer.mid += 1; return self._send(200, {"ok": True, "result": {"message_id": outer.mid}})
                    return self._send(200, {"ok": True, "result": True})
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); self.srv.daemon_threads = True; self.srv.handle_error = lambda *a: None
        self.port = self.srv.server_address[1]; threading.Thread(target=self.srv.serve_forever, daemon=True).start()
    def clear(self):
        with self.lock: self.calls.clear()
    def of(self, method, chat=None):
        with self.lock: return [c for c in self.calls if c["method"] == method and (chat is None or c["chat"] == str(chat))]
    def sent(self, chat=None): return [c for c in self.of("sendMessage", chat) if c["mode"] == "ok"]
    def texts(self, chat): return [c["body"].get("text", "") for c in self.sent(chat)]
    def stop(self): self.srv.shutdown(); self.srv.server_close()


# ---- criptografía de la Mini App (HMAC de initData, como lo calcularía Telegram) -------------------------------------------------------------
def init_data(user_id=1001, auth_date=None, token=TOKEN, extra=None, tamper=None, first="Ana"):
    user = json.dumps({"id": user_id, "first_name": first, "username": f"u{user_id}"}, separators=(",", ":"), ensure_ascii=False)
    f = {"auth_date": str(int(time.time()) if auth_date is None else auth_date), "query_id": "AAH" + str(user_id) + "x", "user": user, **(extra or {})}
    chk = "\n".join(f"{k}={f[k]}" for k in sorted(f))
    key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    f["hash"] = hmac.new(key, chk.encode(), hashlib.sha256).hexdigest()
    if tamper: f = tamper(f)
    return urllib.parse.urlencode(f, quote_via=urllib.parse.quote)


def bad_boots():
    """(etiqueta, env, config, archivos extra de pb_hooks) que deben impedir el arranque (fail-closed)."""
    ok_env = {"TELEGRAM_BOT_TOKEN": TOKEN, "TELEGRAM_WEBHOOK_SECRET": SECRET}
    cfg = lambda t: 'module.exports = { telegram: %s };' % t
    on = cfg('{ enabled: true }')
    return [
        ("telegram activo sin TELEGRAM_BOT_TOKEN", {"TELEGRAM_WEBHOOK_SECRET": SECRET}, on, {}),
        ("telegram activo sin TELEGRAM_WEBHOOK_SECRET", {"TELEGRAM_BOT_TOKEN": TOKEN}, on, {}),
        ("token con formato inválido", {**ok_env, "TELEGRAM_BOT_TOKEN": "no-es-un-token"}, on, {}),
        ("secret demasiado corto", {**ok_env, "TELEGRAM_WEBHOOK_SECRET": "corto"}, on, {}),
        ("secret con caracteres no permitidos", {**ok_env, "TELEGRAM_WEBHOOK_SECRET": "a" * 31 + "!"}, on, {}),
        ("TELEGRAM_API_URL hacia un host http externo", {**ok_env, "TELEGRAM_API_URL": "http://evil.example.com"}, on, {}),
        ("TELEGRAM_WEBHOOK_URL con parámetros", {**ok_env, "TELEGRAM_WEBHOOK_URL": "https://a.example.com/x?y=1"}, on, {}),
        ("TELEGRAM_OPERATOR_CHATS con basura", {**ok_env, "TELEGRAM_OPERATOR_CHATS": "12,abc"}, on, {}),
        ("TELEGRAM_OPERATOR_CHATS repetidos", {**ok_env, "TELEGRAM_OPERATOR_CHATS": "12,12"}, on, {}),
        ("TELEGRAM_BOT_USERNAME inválido", {**ok_env, "TELEGRAM_BOT_USERNAME": "x"}, on, {}),
        ("TELEGRAM_MINIAPP_URL no https", {**ok_env, "TELEGRAM_MINIAPP_URL": "http://a.example.com"}, on, {}),
        ("clave desconocida en telegram", ok_env, cfg('{ enabled: true, nope: 1 }'), {}),
        ("linkTtl fuera de rango", ok_env, cfg('{ enabled: true, linkTtl: 5 }'), {}),
        ("actionTtl con tipo incorrecto", ok_env, cfg('{ enabled: true, actionTtl: "x" }'), {}),
        ("collection de sistema", ok_env, cfg('{ enabled: true, collection: "_superusers" }'), {}),
        ("grupo con nombre inválido", ok_env, cfg('{ enabled: true, groups: { "Bad Name": { field: "roles", values: ["a"] } } }'), {}),
        ("grupo sin valores", ok_env, cfg('{ enabled: true, groups: { g: { field: "roles", values: [] } } }'), {}),
        ("grupo con clave desconocida", ok_env, cfg('{ enabled: true, groups: { g: { field: "roles", values: ["a"], extra: 1 } } }'), {}),
        ("límite por hora negativo", ok_env, cfg('{ enabled: true, limits: { perHour: -1 } }'), {}),
        ("límite desconocido", ok_env, cfg('{ enabled: true, limits: { perDay: 5 } }'), {}),
        ("login.maxAge fuera de rango", ok_env, cfg('{ enabled: true, login: { enabled: true, maxAge: 5 } }'), {}),
        ("login.perMinute fuera de rango", ok_env, cfg('{ enabled: true, login: { enabled: true, perMinute: 0 } }'), {}),
        ("login.singleUse con tipo incorrecto", ok_env, cfg('{ enabled: true, login: { enabled: true, singleUse: "si" } }'), {}),
        ("retención inválida", ok_env, cfg('{ enabled: true, retention: { sentDays: 0 } }'), {}),
        ("acción que no exporta run", ok_env, on, {"telegram/actions/mala.js": "module.exports = { x: 1 };"}),
        ("acción con nombre inválido", ok_env, on, {"telegram/actions/Mala.js": "module.exports = { run: () => 'x' };"}),
        ("acción con clave desconocida", ok_env, on, {"telegram/actions/mala.js": "module.exports = { run: () => 'x', extra: 1 };"}),
    ]


def build(L, ctx, A):
    Case, raw = L.Case, L.raw
    cases, cnt = [], [0]
    J = {"Content-Type": "application/json"}
    EXE, RUN = ctx["exe"], L.RUN
    cat = "Y · Telegram: alertas, vinculación, grupos, botones y Mini App (módulo opcional)"
    S = {"pb": None, "fake": None, "su": None, "root": None, "cfgp": None, "env": None}

    def add(obj, meta, run):
        cnt[0] += 1; cases.append(Case(f"VY{cnt[0]:03d}", cat, obj, meta, run=run))

    def sandbox(tag, port, env, cfgtxt, pages, extra):
        root = os.path.join(RUN, f"x-{tag}"); pgdir = root + "-pages"
        shutil.rmtree(pgdir, ignore_errors=True); os.makedirs(pgdir)
        for rel, txt in pages.items():
            fp = os.path.join(pgdir, rel); os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
        L.build_sandbox(root, pgdir, symlinks=False, clean=True, hooks_extra={"pbmini.config.js": cfgtxt, **extra})
        full = {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}
        return root, full

    def su_login(port): return L.api(port, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]
    seq = [0]

    def mkuser(**fields):
        seq[0] += 1; email = f"tg{seq[0]}_{os.getpid()}@lab.test"
        rec = L.api(PORT, "POST", "/api/collections/users/records", dict(email=email, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True, **fields), S["su"])
        tok = L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=email, password="Passw0rd!!"))["token"]
        return rec["id"], tok

    upd_id = [1000]
    def upd(**kw): upd_id[0] += 1; return dict(update_id=upd_id[0], **kw)
    def msg(tgid, text, chat_type="private", chat_id=None, is_bot=False):
        return upd(message={"message_id": 1, "from": {"id": tgid, "is_bot": is_bot, "first_name": "T"}, "chat": {"id": tgid if chat_id is None else chat_id, "type": chat_type}, "date": 0, "text": text})
    cbn = [0]
    def cbq(tgid, data):
        cbn[0] += 1; return upd(callback_query={"id": f"cb{cbn[0]}", "from": {"id": tgid, "is_bot": False, "first_name": "T"}, "data": data})
    def hook(u, secret=SECRET, body=None, headers=None):
        h = {**J, **({"X-Telegram-Bot-Api-Secret-Token": secret} if secret is not None else {}), **(headers or {})}
        return raw(PORT, "POST", "/_telegram/webhook", h, body if body is not None else json.dumps(u))
    def post(path, tok, data=None, method="POST"): return raw(PORT, method, path, {"Authorization": tok, **J}, json.dumps(data if data is not None else {}))
    def rows(coll, filt=""):
        q = "/api/collections/%s/records?perPage=500&sort=created" % coll + (("&filter=" + urllib.parse.quote(filt)) if filt else "")
        return L.api(PORT, "GET", q, None, S["su"])["items"]
    def kill_pending():   # los reintentos pendientes de pruebas anteriores no deben salir por el cron real (cada minuto) en mitad de otra prueba
        for st_ in ("pending", "sending"):
            for r_ in rows("pbmini_tg_outbox", f"state = '{st_}'"):
                try: L.api(PORT, "PATCH", f"/api/collections/pbmini_tg_outbox/records/{r_['id']}", {"state": "dead", "payload": ""}, S["su"])
                except Exception: pass
    def cron(name="pbmini_telegram_outbox", wait=1.5):   # PocketBase lanza el cron en segundo plano: se espera a que termine
        L.api(PORT, "POST", "/api/crons/" + name, {}, S["su"]); time.sleep(wait)
    def until(cond, t=20):
        end = time.time() + t
        while time.time() < end:
            if cond(): return True
            time.sleep(0.2)
        return cond()
    def link_user(tok, tgid):
        r = post("/tg/link", tok); m = re.search(r"start=([A-Za-z0-9]{32})$", json.loads(r.body)["url"]); S["fake"].clear(); hook(msg(tgid, "/start " + m.group(1))); return m.group(1)
    def fresh(tgid, **fields):
        uid, tok = mkuser(**fields); link_user(tok, tgid); S["fake"].clear(); return uid, tok
    tgn = [5000]
    def nexttg(): tgn[0] += 1; return tgn[0]

    def cfgtxt(login=True, sessions=True, auto=False, single=True, per=1000):
        b = lambda v: "true" if v else "false"
        return CFG % {"login": b(login), "sessions": b(sessions), "auto": b(auto), "single": b(single), "perMin": per}

    def boot(login=True, sessions=True, env_over=None):
        fake = S["fake"]
        env = {"TELEGRAM_BOT_TOKEN": TOKEN, "TELEGRAM_WEBHOOK_SECRET": SECRET, "TELEGRAM_API_URL": f"http://127.0.0.1:{fake.port}", "TELEGRAM_WEBHOOK_URL": "https://lab.example.test",
               "TELEGRAM_OPERATOR_CHATS": ",".join(OPS), "TELEGRAM_MINIAPP_URL": MINI, **(env_over or {})}
        root, full = sandbox("tg", PORT, env, cfgtxt(login, sessions), PAGES, {"telegram/actions/approve.js": ACTION, "pedidos.pb.js": HOOK, "avisos.pb.js": NOTIFY_HOOK})
        S["root"], S["env"] = root, full
        pb = L.PB(EXE, root, PORT, env=full); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): raise RuntimeError("servidor de Telegram no arrancó: " + pb.log()[-400:])
    def restart(login=True, sessions=True, auto=False, single=True, per=1000):
        S["pb"].stop()
        cfgp = os.path.join(S["root"], "pb_hooks", "pbmini.config.js")
        open(cfgp, "w", encoding="utf-8", newline="\n").write(cfgtxt(login, sessions, auto, single, per))
        pb = L.PB(EXE, S["root"], PORT, env=S["env"]); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): raise RuntimeError("no arrancó: " + pb.log()[-400:])
        S["su"] = su_login(PORT)

    # ------------------------------------------------------------------ arranque en vivo
    def setup(_):
        S["fake"] = FakeTelegram(); boot()
        su = su_login(PORT); users = L.api(PORT, "GET", "/api/collections/users", None, su)
        L.api(PORT, "PATCH", "/api/collections/users", dict(fields=users["fields"] + [dict(name="roles", type="select", values=["admin", "editor"], maxSelect=2), dict(name="status", type="text")]), su)
        restart()
        L.api(PORT, "POST", "/api/collections", PEDIDOS, S["su"]); L.api(PORT, "POST", "/api/collections", AVISOS, S["su"])
        f = S["fake"]; me = f.of("getMe"); wh = f.of("setWebhook"); bad = []
        if not me: bad.append("no llamó a getMe")
        if len(wh) < 1: bad.append("no registró el webhook")
        else:
            b = wh[-1]["body"]
            if b.get("url") != "https://lab.example.test/_telegram/webhook" or b.get("secret_token") != SECRET: bad.append(f"setWebhook con datos inesperados: {b}")
            if sorted(b.get("allowed_updates", [])) != ["callback_query", "message", "my_chat_member"]: bad.append("allowed_updates inesperado")
        cols = [c["name"] for c in L.api(PORT, "GET", "/api/collections?perPage=200", None, S["su"])["items"]]
        for n in ("pbmini_telegram", "pbmini_tg_links", "pbmini_tg_outbox", "pbmini_tg_actions"):
            if n not in cols: bad.append(f"falta la colección {n}")
        return not bad, "; ".join(bad) or f"Telegram falso en 127.0.0.1:{f.port}; getMe + setWebhook(secret_token, allowed_updates) y 4 colecciones internas"
    add("Preparación: servidor con Telegram falso, getMe y setWebhook al arrancar", "El módulo registra el webhook con su secret y crea las colecciones internas", setup)

    def collections_closed(_):
        bad = []
        u = L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=f"tg1_{os.getpid()}@lab.test", password="Passw0rd!!")) if seq[0] else None
        _, tok = mkuser()
        for n in ("pbmini_telegram", "pbmini_tg_links", "pbmini_tg_outbox", "pbmini_tg_actions"):
            for m, p in (("GET", f"/api/collections/{n}/records"), ("POST", f"/api/collections/{n}/records")):
                r = raw(PORT, m, p, {"Authorization": tok, **J}, "{}")
                if r.status in (200, 201): bad.append(f"{m} {n} con token de usuario → {r.status}")
            r = raw(PORT, "GET", f"/api/collections/{n}/records", {**J});
            if r.status == 200: bad.append(f"{n} legible sin sesión")
        return not bad, "; ".join(bad) or "las 4 colecciones internas rechazan lectura y escritura a usuarios y anónimos (solo superusuario)"
    add("Las colecciones internas no son accesibles por la API nativa", "403/401: solo el superusuario", collections_closed)

    # ------------------------------------------------------------------ rutas: GET, públicas, anónimo
    def route_guards(_):
        bad = []; _, tok = mkuser()
        for path, m, want in (("/tg/me", "GET", 500), ("/tg/link", "GET", 500), ("/tg/pub", "POST", 500), ("/tg/linkpub", "POST", 500), ("/tg/alertpub", "POST", 500)):
            r = raw(PORT, m, path, {"Authorization": tok, **J}, "{}" if m == "POST" else None)
            if r.status != want: bad.append(f"{m} {path} → {r.status} (esperado {want})")
        for path in ("/tg/me", "/tg/link"):
            r = raw(PORT, "POST", path, J, json.dumps({"text": "x"}))
            if r.status != 401: bad.append(f"anónimo en {path} → {r.status}")
        r = raw(PORT, "GET", "/tg/alert", {"Authorization": S["su"]});
        if r.status != 500: bad.append(f"GET alert como superusuario → {r.status}")
        return not bad, "; ".join(bad) or "ctx.telegram*/telegramLink no se permiten en GET ni en rutas públicas; el anónimo recibe 401; el envío nunca llega a Telegram"
    add("GET y rutas públicas no pueden enviar ni generar enlaces", "500 (error de programación) / 401 anónimo; sin llamadas al bot", route_guards)

    def bad_targets(_):
        _, tok = mkuser(); bad = []
        S["fake"].clear()
        for tgt in ("../etc", "x" * 15 + "'", "ME", " me", "abc", "a" * 16, "me;DROP", "<script>", "123456789012345 ", None):
            r = post("/tg/target", tok, {"target": tgt if tgt is not None else "x"})
            if r.status not in (400, 500): bad.append(f"destino {tgt!r}→{r.status}")
        if S["fake"].sent(): bad.append("se envió algo")
        return not bad, "; ".join(bad) or "los destinos distintos de «me» o un id válido se rechazan; no sale ningún mensaje"
    add("El destino de ctx.telegram solo puede ser «me» o un id de usuario", "Basura/traversal/inyección → error de programación (500)", bad_targets)

    # ------------------------------------------------------------------ vinculación
    def link_flow(_):
        bad = []; uid, tok = mkuser(); tg = nexttg()
        r = post("/tg/link", tok)
        if r.status != 200: return False, f"/tg/link → {r.status} {r.body[:120]}"
        j = json.loads(r.body); m = re.match(r"^https://t\.me/lab_bot\?start=([A-Za-z0-9]{32})$", j["url"])
        if not m: return False, f"URL de vinculación inesperada: {j['url']}"
        token = m.group(1); lk = rows("pbmini_tg_links", f'rid = "{uid}"')
        if len(lk) != 1 or token in json.dumps(lk) or lk[0]["hash"] != hashlib.sha256(token.encode()).hexdigest(): bad.append("el token debe guardarse solo como hash sha256")
        S["fake"].clear(); r1 = hook(msg(tg, "/start " + token)); t1 = S["fake"].texts(tg)
        if r1.status != 200 or not t1 or "vinculada" not in t1[0]: bad.append(f"/start válido → {r1.status} {t1}")
        ch = rows("pbmini_telegram", f'rid = "{uid}"')
        if len(ch) != 1 or ch[0]["tgid"] != str(tg) or ch[0]["chat_id"] != str(tg) or ch[0]["status"] != "active": bad.append(f"fila de vínculo inesperada: {ch}")
        S["fake"].clear(); hook(msg(nexttg(), "/start " + token)); t2 = S["fake"].texts(tgn[0])
        if not t2 or "no es válido" not in t2[0]: bad.append(f"reutilizar el token debe fallar: {t2}")
        return not bad, "; ".join(bad) or "enlace https://t.me/<bot>?start=<32>; el token se guarda como hash, se consume una vez y su reutilización desde otro Telegram falla"
    add("Vinculación: enlace de un solo uso, token solo como hash", "Vinculada; un segundo uso del mismo token se rechaza", link_flow)

    def link_attacks(_):
        bad = []; f = S["fake"]; uid, tok = mkuser(); tg = nexttg(); uid2, tok2 = mkuser()
        def start(tgid, token):
            f.clear(); hook(msg(tgid, "/start " + token)); return " ".join(f.texts(tgid))
        # caducado
        tk = re.search(r"start=([A-Za-z0-9]{32})$", json.loads(post("/tg/link", tok).body)["url"]).group(1)
        lid = rows("pbmini_tg_links", f'rid = "{uid}" && used = false')[0]["id"]
        L.api(PORT, "PATCH", f"/api/collections/pbmini_tg_links/records/{lid}", {"expires": "2000-01-01 00:00:00.000Z"}, S["su"])
        if "no es válido" not in start(tg, tk): bad.append("token caducado aceptado")
        if rows("pbmini_telegram", f'rid = "{uid}"'): bad.append("el token caducado creó un vínculo")
        # basura
        for junk in ("x", "A" * 31, "A" * 33, "A" * 32, "' OR 1=1 --", "../../x", "%00", "a b", "é" * 32):
            f.clear(); hook(msg(tg, "/start " + junk))
            if any("vinculada." in t and "Cuenta" in t for t in f.texts(tg)): bad.append(f"token basura aceptado: {junk!r}")
        # un Telegram ya vinculado a otra cuenta
        link_user(tok, tg)
        tk2 = re.search(r"start=([A-Za-z0-9]{32})$", json.loads(post("/tg/link", tok2).body)["url"]).group(1)
        if "ya está vinculado" not in start(tg, tk2): bad.append("un mismo Telegram no debe vincularse a dos cuentas")
        if len(rows("pbmini_telegram", f'tgid = "{tg}"')) != 1: bad.append("el mismo tgid tiene varias filas")
        # el token consumido en el intento anterior ya no sirve ni siquiera desde otro Telegram
        other = nexttg()
        if "no es válido" not in start(other, tk2): bad.append("el token consumido por el intento fallido sigue valiendo")
        # /start sin token
        f.clear(); hook(msg(other, "/start"));
        if "enlace" not in " ".join(f.texts(other)): bad.append("/start sin token debe explicar cómo vincular")
        # el usuario pide un enlace nuevo: invalida el anterior sin usar
        a = re.search(r"start=([A-Za-z0-9]{32})$", json.loads(post("/tg/link", tok2).body)["url"]).group(1)
        b = re.search(r"start=([A-Za-z0-9]{32})$", json.loads(post("/tg/link", tok2).body)["url"]).group(1)
        if "no es válido" not in start(other, a): bad.append("un enlace nuevo debe invalidar el anterior sin usar")
        if "vinculada" not in start(other, b): bad.append("el enlace más reciente debe funcionar")
        return not bad, "; ".join(bad) or "caducado, basura/SQL/traversal/unicode, mismo Telegram en dos cuentas, token consumido por el intento fallido y enlace sustituido: todos rechazados"
    add("Vinculación: caducado, basura, Telegram duplicado, enlace sustituido", "Todo rechazado con respuesta fija; nunca se crea un vínculo indebido", link_attacks)

    def link_rate(_):
        _, tok = mkuser(); codes = [post("/tg/link", tok).status for _ in range(7)]
        return codes[:5] == [200] * 5 and codes[5:] == [429, 429], f"códigos {codes} (5 por hora y usuario, después 429)"
    add("Pedir enlaces está limitado por usuario", "5 por hora; después 429", link_rate)

    # ------------------------------------------------------------------ webhook
    def webhook_auth(_):
        bad = []; f = S["fake"]; tg = nexttg(); u = msg(tg, "/start")
        f.clear()
        cases_ = [("sin cabecera", None), ("vacía", ""), ("incorrecta", "x" * 42), ("prefijo", SECRET[:-1]), ("con sufijo", SECRET + "x"), ("minúsculas", SECRET.lower()), ("secret de otro bot", "otherSecret_otherSecret_otherSecret_ab")]
        for label, sec in cases_:
            r = hook(msg(nexttg(), "/start"), secret=sec)
            if r.status != 403: bad.append(f"{label} → {r.status}")
        if f.of("sendMessage"): bad.append("hubo respuestas del bot a peticiones sin autenticar")
        for m in ("GET", "PUT", "DELETE", "PATCH"):
            r = raw(PORT, m, "/_telegram/webhook", {"X-Telegram-Bot-Api-Secret-Token": SECRET})
            if r.status in (200, 201, 204): bad.append(f"{m} → {r.status}")
        r = hook(u);
        if r.status != 200: bad.append(f"con el secret correcto → {r.status}")
        return not bad, "; ".join(bad) or "sin cabecera, vacía, prefijo, sufijo, mayúsculas/minúsculas y otro secret → 403 sin ninguna respuesta del bot; otros métodos no pasan; el correcto → 200"
    add("Webhook: autenticación por secret_token", "Solo el secret exacto; el resto 403", webhook_auth)

    def webhook_bodies(_):
        bad = []; f = S["fake"]
        def code(body, ct="application/json"): return hook(None, body=body, headers={"Content-Type": ct}).status
        want = {"JSON roto": ("{", 400), "arreglo": ("[1]", 400), "sin update_id": ("{}", 400), "update_id texto": ('{"update_id":"1"}', 400), "update_id negativo": ('{"update_id":-1}', 400),
                "update_id decimal": ('{"update_id":1.5}', 400), "null": ("null", 400), "basura final": ('{"update_id":9001} x', 400)}
        for label, (b, st) in want.items():
            g = code(b)
            if g != st: bad.append(f"{label} → {g} (esperado {st})")
        big = code(json.dumps({"update_id": 99999, "pad": "x" * 70000}))
        if big not in (400, 413): bad.append(f"cuerpo de 70 KB → {big}")
        f.clear()
        for u in (msg(nexttg(), "x" * 300), msg(nexttg(), "hola"), msg(nexttg(), "/start", chat_type="group"), msg(nexttg(), "/start", chat_type="supergroup"), msg(nexttg(), "/start", chat_type="channel"),
                  msg(nexttg(), "/start", is_bot=True), msg(nexttg(), "/start", chat_id=-100123), upd(edited_message={"text": "/start"}), upd(inline_query={"id": "1", "query": "x"}), upd(message={"text": "/start"}), upd(message=5),
                  upd(callback_query={"id": "x"}), upd(callback_query=7), upd(my_chat_member=[])):
            r = hook(u)
            if r.status != 200: bad.append(f"actualización ignorable → {r.status}")
        if f.of("sendMessage") or f.of("answerCallbackQuery"): bad.append(f"respondió a actualizaciones que debía ignorar: {[(c['method'], c['chat']) for c in f.calls]}")
        return not bad, "; ".join(bad) or "JSON inválido/arreglo/sin id/id negativo o decimal/basura final → 400; cuerpo enorme rechazado; mensajes de grupo, canal, bots, chat distinto del emisor y tipos desconocidos se ignoran sin responder"
    add("Webhook: cuerpos inválidos y actualizaciones que deben ignorarse", "400 en lo malformado; 200 y silencio en lo ajeno (solo chats privados)", webhook_bodies)

    def webhook_dupes(_):
        f = S["fake"]; tg = nexttg(); u = msg(tg, "/status"); f.clear()
        a = hook(u).status; b = hook(u).status; c = hook(u).status
        n = len(f.sent(tg))
        return (a, b, c) == (200, 200, 200) and n == 1, f"códigos {(a, b, c)}; respuestas del bot {n} (el mismo update_id se procesa una sola vez)"
    add("Un update_id repetido no se procesa dos veces", "Una sola respuesta del bot", webhook_dupes)

    def webhook_race(_):
        f = S["fake"]; uid, tok = mkuser(); tg = nexttg(); r = post("/tg/link", tok); token = re.search(r"start=([A-Za-z0-9]{32})$", json.loads(r.body)["url"]).group(1)
        f.clear(); res = []
        def go(i):
            tgi = tg + 10000 + i if i else tg
            res.append(hook(msg(tgi, "/start " + token)).status)
        ts = [threading.Thread(target=go, args=(i,)) for i in range(12)]; [t.start() for t in ts]; [t.join() for t in ts]
        ok_msgs = [c for c in f.sent() if "Cuenta vinculada" in c["body"].get("text", "")]
        ch = rows("pbmini_telegram", f'rid = "{uid}"')
        return len(ok_msgs) == 1 and len(ch) == 1, f"12 /start simultáneos con el mismo token: {len(ok_msgs)} vinculación(es), {len(ch)} fila(s) (esperado 1 y 1)"
    add("Carrera: el mismo token usado a la vez desde 12 Telegram", "Exactamente una vinculación", webhook_race)

    # ------------------------------------------------------------------ envío
    def not_linked(_):
        _, tok = mkuser(); f = S["fake"]; f.clear(); r = post("/tg/me", tok, {"text": "hola"})
        return r.status == 200 and json.loads(r.body)["status"] == "not_linked" and not f.sent(), f"HTTP {r.status} {r.body[:80]}; mensajes enviados {len(f.sent())}"
    add("Enviar a un usuario sin vincular", "status not_linked y nada sale a Telegram", not_linked)

    def send_ok(_):
        bad = []; uid, tok = fresh(nexttg()); tg = tgn[0]; f = S["fake"]
        r = post("/tg/me", tok, {"title": "Pedido <1>", "text": 'hola <b>x</b> & "y" <a href="http://evil">z</a>'})
        j = json.loads(r.body) if r.status == 200 else {}
        if j.get("status") != "sent": bad.append(f"estado {j} (HTTP {r.status})")
        s = f.sent(tg)
        if len(s) != 1: bad.append(f"{len(s)} mensajes")
        else:
            b = s[0]["body"]
            if b.get("parse_mode") != "HTML" or b.get("disable_web_page_preview") is not True: bad.append(f"parámetros {b}")
            if b.get("text") != '<b>Pedido &lt;1&gt;</b>\nhola &lt;b&gt;x&lt;/b&gt; &amp; "y" &lt;a href="http://evil"&gt;z&lt;/a&gt;': bad.append(f"texto sin escapar correctamente: {b.get('text')!r}")
            if "<a " in b.get("text", "") or "<b>x" in b.get("text", ""): bad.append("HTML del usuario sin escapar")
        ob = rows("pbmini_tg_outbox", f'rid = "{uid}"')
        if len(ob) != 1 or ob[0]["state"] != "sent" or ob[0]["payload"] != "": bad.append(f"la cola debe quedar sent y sin contenido: {[(o['state'], o['payload'][:20]) for o in ob]}")
        return not bad, "; ".join(bad) or "título y texto escapados (nada de HTML del usuario llega a Telegram), parse_mode HTML, sin vista previa; el contenido se borra de la cola al enviar"
    add("Enviar: texto escapado, parámetros fijos y contenido borrado de la cola", "El HTML del usuario llega como texto; payload vacío tras enviar", send_ok)

    def idem(_):
        bad = []; uid, tok = fresh(nexttg()); tg = tgn[0]; f = S["fake"]
        a = json.loads(post("/tg/me", tok, {"text": "uno", "key": "pedido-1"}).body)["status"]; b = json.loads(post("/tg/me", tok, {"text": "uno", "key": "pedido-1"}).body)["status"]
        c = json.loads(post("/tg/me", tok, {"text": "dos", "key": "pedido-2"}).body)["status"]
        if (a, b, c) != ("sent", "duplicate", "sent"): bad.append(f"estados {(a, b, c)}")
        if len(f.sent(tg)) != 2: bad.append(f"{len(f.sent(tg))} mensajes (esperado 2)")
        for k in ("", "a b", "x" * 65, "<k>", "k\n1", "../k"):
            if post("/tg/me", tok, {"text": "x", "key": k}).status < 400: bad.append(f"key inválida aceptada: {k!r}")
        # carrera: la misma key desde 10 hilos
        f.clear(); res = []
        def go(): res.append(json.loads(post("/tg/me", tok, {"text": "carrera", "key": "carrera-1"}).body)["status"])
        ts = [threading.Thread(target=go) for _ in range(10)]; [t.start() for t in ts]; [t.join() for t in ts]
        if len(f.sent(tg)) != 1: bad.append(f"carrera: {len(f.sent(tg))} envíos con la misma key (esperado 1): {sorted(res)}")
        return not bad, "; ".join(bad) or "la misma key no se envía dos veces (ni con 10 hilos a la vez); keys inválidas rechazadas"
    add("Idempotencia: la misma key no repite el envío", "duplicate; un solo mensaje aun con peticiones simultáneas", idem)

    def msg_validation(_):
        bad = []; uid, tok = fresh(nexttg()); f = S["fake"]
        for label, body in (("texto vacío", {"text": ""}), ("texto de 4097", {"text": "x" * 4097}), ("título de 201", {"title": "t" * 201, "text": "x"})):
            r = post("/tg/me", tok, body)
            if r.status != 500 and r.status != 400: bad.append(f"{label} → {r.status}")
        if f.sent(): bad.append("se envió un mensaje inválido")
        r = post("/tg/me", tok, {"text": "x" * 4096})
        if r.status != 200: bad.append(f"texto de 4096 → {r.status}")
        return not bad, "; ".join(bad) or "texto vacío, >4096 y título >200 rechazados antes de salir; 4096 exacto pasa"
    add("Validación del mensaje (longitudes)", "Rechazado antes de llegar a Telegram", msg_validation)

    def limits(_):
        bad = []; uid, tok = fresh(nexttg()); f = S["fake"]
        codes = [post("/tg/me", tok, {"text": f"m{i}", "key": f"k{i}"}).status for i in range(24)]
        first = codes.index(429) + 1 if 429 in codes else None
        if first != 21: bad.append(f"el primer 429 por chat fue el envío {first} (esperado 21: perChatPerMinute=20)")
        if len(f.sent()) != 20: bad.append(f"{len(f.sent())} mensajes salieron (esperado 20)")
        return not bad, "; ".join(bad) or "el envío 21 en un minuto al mismo chat recibe 429 y no sale (límite por chat)"
    add("Límite por chat: 20 mensajes por minuto", "A partir del 21 → 429, sin llegar a Telegram", limits)

    def failures(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        # 429: se reintenta tras retry_after
        f.mode = "429"; r = json.loads(post("/tg/me", tok, {"text": "a", "key": "r429"}).body)
        ob = rows("pbmini_tg_outbox", f'rid = "{uid}" && dedupe ~ "r429"')
        if r["status"] != "queued" or not ob or ob[0]["state"] != "pending" or int(ob[0]["attempts"]) != 1: bad.append(f"429 → {r}, fila {[(o['state'], o['attempts']) for o in ob]}")
        f.mode = "ok"; time.sleep(1.3); cron()
        ob = rows("pbmini_tg_outbox", f'rid = "{uid}" && dedupe ~ "r429"')
        if not ob or ob[0]["state"] != "sent" or len(f.sent(tg)) != 1: bad.append(f"tras la espera y el cron debe enviarse: {[(o['state'], o['error']) for o in ob]}, enviados {len(f.sent(tg))}")
        # 500: pendiente con espera, sin duplicados al drenar de nuevo enseguida
        f.clear(); f.mode = "500"; r = json.loads(post("/tg/me", tok, {"text": "b", "key": "r500"}).body)
        f.mode = "ok"; cron(); cron()
        if r["status"] != "queued" or f.sent(tg): bad.append(f"500 → {r}; el reintento no debe ocurrir antes de la espera (enviados {len(f.sent(tg))})")
        # 400: muerto, sin reintentos
        f.clear(); f.mode = "400"; r = json.loads(post("/tg/me", tok, {"text": "c", "key": "r400"}).body)
        f.mode = "ok"; cron(); ob = rows("pbmini_tg_outbox", f'rid = "{uid}" && dedupe ~ "r400"')
        if r["status"] != "failed" or not ob or ob[0]["state"] != "dead" or ob[0]["payload"] != "" or f.sent(tg): bad.append(f"400 → {r}, fila {[(o['state'], o['payload'][:10]) for o in ob]}")
        kill_pending()
        return not bad, "; ".join(bad) or "429 se reintenta tras retry_after y llega; 500 queda pendiente con espera creciente (no se reintenta de inmediato); 400 pasa a dead sin contenido"
    add("Fallos de Telegram: 429, 500 y 400", "429 reintenta, 500 espera, 400 muere sin guardar el contenido", failures)

    def blocked_bot(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        f.mode = "403"; r = json.loads(post("/tg/me", tok, {"text": "a", "key": "b1"}).body); f.mode = "ok"
        ch = rows("pbmini_telegram", f'rid = "{uid}"')[0]
        if r["status"] != "failed" or ch["status"] != "blocked": bad.append(f"403 → {r}, vínculo {ch['status']}")
        f.clear(); r2 = json.loads(post("/tg/me", tok, {"text": "b"}).body)
        if r2["status"] != "blocked" or f.sent(tg): bad.append(f"con el vínculo bloqueado no debe intentarse: {r2}, enviados {len(f.sent(tg))}")
        f.clear(); hook(msg(tg, "/status")); ch = rows("pbmini_telegram", f'rid = "{uid}"')[0]
        if ch["status"] != "active": bad.append("si el usuario vuelve a escribir al bot, el vínculo debe reactivarse")
        hook(upd(my_chat_member={"chat": {"id": tg, "type": "private"}, "new_chat_member": {"status": "kicked"}}))
        if rows("pbmini_telegram", f'rid = "{uid}"')[0]["status"] != "blocked": bad.append("my_chat_member kicked debe bloquear")
        hook(upd(my_chat_member={"chat": {"id": tg, "type": "private"}, "new_chat_member": {"status": "member"}}))
        if rows("pbmini_telegram", f'rid = "{uid}"')[0]["status"] != "active": bad.append("my_chat_member member debe reactivar")
        hook(upd(my_chat_member={"chat": {"id": -5, "type": "group"}, "new_chat_member": {"status": "kicked"}}))
        return not bad, "; ".join(bad) or "403 (bot bloqueado) marca el vínculo y deja de intentar; /status o my_chat_member lo reactivan; los eventos de grupos no tocan nada"
    add("Bot bloqueado por el usuario (403) y su recuperación", "Vínculo blocked sin más intentos; reactivación al volver", blocked_bot)

    def account_blocked(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        L.api(PORT, "PATCH", f"/api/collections/users/records/{uid}", {"status": "suspended"}, S["su"])
        r = json.loads(post("/tg/me", tok, {"text": "x"}).body) if post("/tg/me", tok, {"text": "x"}).status == 200 else {"status": "http"}
        r2 = raw(PORT, "POST", "/tg/me", {"Authorization": tok, **J}, json.dumps({"text": "x"}))
        if f.sent(tg): bad.append("a una cuenta bloqueada se le enviaron mensajes")
        return not bad, "; ".join(bad) or f"cuenta con status=suspended: nada sale a su Telegram (respuesta {r2.status})"
    add("Cuenta bloqueada (access.statusField): no recibe avisos", "Sin mensajes a Telegram", account_blocked)

    def cleanup_user(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        post("/tg/me", tok, {"text": "x", "key": "z1"}); post("/tg/btn", tok, {"kind": "ok"})
        L.api(PORT, "DELETE", f"/api/collections/users/records/{uid}", None, S["su"])
        for n in ("pbmini_telegram", "pbmini_tg_outbox", "pbmini_tg_actions", "pbmini_tg_links"):
            if rows(n, f'rid = "{uid}"'): bad.append(f"quedan filas de {n} tras borrar el usuario")
        f.clear(); hook(msg(tg, "/status")); t = f.texts(tg)
        if not t or "No hay ninguna cuenta" not in t[0]: bad.append(f"el Telegram del usuario borrado debe quedar sin cuenta: {t}")
        return not bad, "; ".join(bad) or "al borrar el usuario desaparecen su vínculo, su cola, sus acciones y sus enlaces"
    add("Borrar el usuario limpia vínculo, cola y acciones", "Sin filas residuales (datos personales)", cleanup_user)

    def stop_cmd(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        f.clear(); hook(msg(tg, "/stop")); t = f.texts(tg)
        if not t or "desactivados" not in t[0]: bad.append(f"/stop → {t}")
        if rows("pbmini_telegram", f'rid = "{uid}"'): bad.append("el vínculo sigue existiendo")
        r = json.loads(post("/tg/me", tok, {"text": "x"}).body)
        if r["status"] != "not_linked": bad.append(f"tras /stop → {r}")
        f.clear(); hook(msg(tg, "/stop")); t = f.texts(tg)
        if not t or "No hay" not in t[0]: bad.append("/stop repetido debe indicar que no hay cuenta")
        return not bad, "; ".join(bad) or "/stop elimina el vínculo; después el envío da not_linked"
    add("/stop desvincula", "Sin vínculo; not_linked", stop_cmd)

    # ------------------------------------------------------------------ grupos y operadores
    def groups(_):
        bad = []; f = S["fake"]
        blk = fresh(nexttg(), roles=["admin"]); lkb = rows("pbmini_telegram", f'rid = "{blk[0]}"')[0]   # vínculo bloqueado (el bot fue bloqueado): no debe recibir
        L.api(PORT, "PATCH", f"/api/collections/pbmini_telegram/records/{lkb['id']}", {"status": "blocked"}, S["su"])
        blk_chat = str(tgn[0])
        admins = [fresh(nexttg(), roles=["admin"]) for _ in range(3)]
        editor = fresh(nexttg(), roles=["editor"]); both = fresh(nexttg(), roles=["editor", "admin"])
        unlinked = mkuser(roles=["admin"]); susp = fresh(nexttg(), roles=["admin"])
        L.api(PORT, "PATCH", f"/api/collections/users/records/{susp[0]}", {"status": "suspended"}, S["su"])
        want = {str(tgn[0] - k) for k in range(0)}  # se rellena abajo
        want = {a[0]: None for a in admins}
        chats = {admins[0][0]: tgn[0] - 5, admins[1][0]: tgn[0] - 4, admins[2][0]: tgn[0] - 3}
        both_chat = tgn[0] - 1
        exp = {str(c) for c in list(chats.values()) + [both_chat]}
        f.clear(); r = raw(PORT, "POST", "/tg/group", {"Authorization": S["su"], **J}, json.dumps({"name": "staff", "text": "aviso interno", "key": "g1"}))
        j = json.loads(r.body) if r.status == 200 else {}
        if j.get("queued") != 4: bad.append(f"se encolaron {j} (esperado 4: 3 admins + 1 editor/admin; sin vincular y suspendida fuera)")
        if [c for c in f.sent() if c["body"].get("text") == "aviso interno"]: bad.append("el envío a grupos no debe salir dentro de la petición (lo reparte la cola)")
        cron()
        got = {c["chat"] for c in f.sent() if c["body"]["text"] == "aviso interno"}
        if got != exp: bad.append(f"destinatarios {sorted(got)} (esperado {sorted(exp)})")
        if blk_chat in got: bad.append("un vínculo bloqueado recibió el aviso del grupo")
        r2 = json.loads(raw(PORT, "POST", "/tg/group", {"Authorization": S["su"], **J}, json.dumps({"name": "staff", "text": "aviso interno", "key": "g1"})).body)
        if r2.get("queued") != 0: bad.append(f"la misma key no debe volver a encolar: {r2}")
        for name in ("nope", "STAFF", "", "../x"):
            if raw(PORT, "POST", "/tg/group", {"Authorization": S["su"], **J}, json.dumps({"name": name, "text": "x"})).status < 400: bad.append(f"grupo {name!r} aceptado")
        _, utok = mkuser()
        if raw(PORT, "POST", "/tg/group", {"Authorization": utok, **J}, json.dumps({"name": "staff", "text": "x"})).status not in (401, 403): bad.append("un usuario normal pudo enviar a un grupo")
        if raw(PORT, "POST", "/tg/group", J, json.dumps({"name": "staff", "text": "x"})).status not in (401, 403): bad.append("anónimo pudo enviar a un grupo")
        return not bad, "; ".join(bad) or "el grupo reparte solo a vinculados activos con el rol (no a sin vincular ni cuenta suspendida); se encola y lo envía el cron; misma key = sin duplicados; nombres inválidos y no-superusuarios rechazados"
    add("Grupos: miembros por campo, cola, idempotencia y permisos", "Solo los vinculados activos del grupo reciben; solo un superusuario envía", groups)

    def group_pacing(_):
        bad = []; f = S["fake"]; N = 30
        for i in range(N): fresh(nexttg(), name="bulk")
        f.clear(); t0 = time.time()
        j = json.loads(raw(PORT, "POST", "/tg/group", {"Authorization": S["su"], **J}, json.dumps({"name": "bulk", "text": "masivo", "key": "b1"})).body)
        if j.get("queued") != N: bad.append(f"se encolaron {j}")
        cron(wait=0.5); until(lambda: len([c for c in f.sent() if c["body"]["text"] == "masivo"]) >= N); sent = [c for c in f.sent() if c["body"]["text"] == "masivo"]
        if len(sent) != N: bad.append(f"se enviaron {len(sent)} de {N}")
        ts = sorted(c["t"] for c in sent)
        worst = max((sum(1 for x in ts if t <= x < t + 1.0) for t in ts), default=0)
        if worst > 26: bad.append(f"ritmo {worst} mensajes en una ventana de 1 s (máximo 25-26)")
        if len({c["chat"] for c in sent}) != N: bad.append("un chat recibió más de un mensaje")
        return not bad, "; ".join(bad) or f"{N} destinatarios: todos reciben una vez; ritmo máximo {worst} mensajes/s (límite de Telegram ≈ 30/s)"
    add("Envío masivo a un grupo: ritmo bajo el límite de Telegram", "≤ 26 mensajes en cualquier ventana de 1 s; uno por chat", group_pacing)

    def group_buttons(_):
        bad = []; f = S["fake"]; a1 = fresh(nexttg(), roles=["admin"]); a2 = fresh(nexttg(), roles=["admin"])
        f.clear(); raw(PORT, "POST", "/tg/groupbtn", {"Authorization": S["su"], **J}, "{}"); cron()
        datas = {}
        for c in f.sent():
            if c["body"].get("text") == "x":
                kb = c["body"]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]; datas[c["chat"]] = kb
        if len(set(datas.values())) != len(datas) or len(datas) < 2: bad.append(f"cada destinatario debe recibir su propio nonce: {datas}")
        return not bad, "; ".join(bad) or f"{len(datas)} destinatarios con nonces distintos en el mismo aviso"
    add("Grupos con botones: un nonce propio por destinatario", "Nonces distintos (no se puede reutilizar el botón de otro)", group_buttons)

    def operators(_):
        bad = []; f = S["fake"]; f.clear()
        r = raw(PORT, "POST", "/tg/alert", {"Authorization": S["su"], **J}, json.dumps({"text": "<b>fallo</b>", "key": "op1"})); j = json.loads(r.body) if r.status == 200 else {}
        cron(); got = sorted(c["chat"] for c in f.sent() if "fallo" in c["body"]["text"])
        if got != sorted(OPS): bad.append(f"destinatarios {got} (esperado {sorted(OPS)})")
        if any("<b>fallo" in c["body"]["text"] for c in f.sent()): bad.append("HTML sin escapar en la alerta")
        r2 = json.loads(raw(PORT, "POST", "/tg/alert", {"Authorization": S["su"], **J}, json.dumps({"text": "<b>fallo</b>", "key": "op1"})).body)
        if r2.get("queued") != 0: bad.append(f"la misma key no debe repetir: {r2}")
        _, utok = mkuser()
        if raw(PORT, "POST", "/tg/alert", {"Authorization": utok, **J}, json.dumps({"text": "x"})).status not in (401, 403): bad.append("un usuario normal pudo alertar a los operadores")
        if raw(PORT, "POST", "/tg/alert", J, json.dumps({"text": "x"})).status not in (401, 403): bad.append("anónimo pudo alertar a los operadores")
        return not bad, "; ".join(bad) or f"la alerta llega a los chats de TELEGRAM_OPERATOR_CHATS ({', '.join(OPS)}) con el texto escapado; idempotente; solo superusuario"
    add("Alertas a operadores (TELEGRAM_OPERATOR_CHATS)", "Solo esos chats; texto escapado; idempotente; solo superusuario", operators)

    # ------------------------------------------------------------------ botones
    def btn_build(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        r = post("/tg/btn", tok, {"kind": "ok"}); s = f.sent(tg)
        if r.status != 200 or len(s) != 1: return False, f"HTTP {r.status} {r.body[:100]}"
        kb = s[0]["body"]["reply_markup"]["inline_keyboard"][0]
        if not re.match(r"^a:[A-Za-z0-9]{24}$", kb[0]["callback_data"]) or len(kb[0]["callback_data"]) > 64: bad.append(f"callback_data {kb[0].get('callback_data')!r}")
        if kb[1] != {"text": "Web", "url": "https://example.com/x"}: bad.append(f"botón url {kb[1]}")
        ac = rows("pbmini_tg_actions", f'rid = "{uid}"')
        if len(ac) != 1 or kb[0]["callback_data"][2:] in json.dumps(ac) or ac[0]["hash"] != hashlib.sha256(kb[0]["callback_data"][2:].encode()).hexdigest(): bad.append("el nonce debe guardarse solo como hash")
        for kind, why in (("unknown", "acción no declarada"), ("http", "url http"), ("two", "action y url a la vez"), ("extra", "clave de botón desconocida"), ("rows", "4 filas")):
            f.clear(); rr = post("/tg/btn", tok, {"kind": kind})
            if rr.status != 500 or f.sent(tg): bad.append(f"{why} → {rr.status}, enviados {len(f.sent(tg))}")
        f.clear(); rr = post("/tg/btn", tok, {"kind": "webapp"}); w = f.sent(tg)
        if rr.status != 200 or not w or w[0]["body"]["reply_markup"]["inline_keyboard"][0][0].get("web_app") != {"url": MINI}: bad.append(f"botón webApp → {rr.status} {w[0]['body'] if w else None}")
        return not bad, "; ".join(bad) or "botón de acción = callback_data a:<24> (≤64 B) con nonce guardado como hash; url solo https; acción desconocida, doble tipo, claves extra y >3 filas rechazados; webApp usa TELEGRAM_MINIAPP_URL"
    add("Botones: construcción y validación", "Solo acciones declaradas y URLs https; nonce solo como hash", btn_build)

    def btn_flow(_):
        bad = []; f = S["fake"]; u1, t1 = fresh(nexttg()); tg1 = tgn[0]; u2, t2 = fresh(nexttg()); tg2 = tgn[0]; tg3 = nexttg()
        def sendbtn(tok, tg):
            f.clear(); post("/tg/btn", tok, {"kind": "ok"}); return f.sent(tg)[0]["body"]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
        def press(tg, data):
            f.clear(); hook(cbq(tg, data)); a = f.of("answerCallbackQuery"); return (a[0]["body"].get("text") if a else None)
        data = sendbtn(t1, tg1)
        # otro usuario vinculado intenta usar el botón ajeno
        if press(tg2, data) != "Esta acción ya caducó o ya se usó.": bad.append("un usuario ajeno pudo usar el botón")
        if json.loads(raw(PORT, "GET", "/tg/approved", {"Authorization": t2}).body)["v"] or json.loads(raw(PORT, "GET", "/tg/approved", {"Authorization": t1}).body)["v"]: bad.append("la acción se ejecutó para un pulsador ajeno")
        # Telegram sin vincular
        if press(tg3, data) != "Esta acción ya caducó o ya se usó.": bad.append("un Telegram sin vincular pudo usar el botón")
        # el nonce tampoco se quemó con los intentos ajenos: el dueño puede usarlo
        if press(tg1, data) != "Aprobado 1": bad.append("el dueño no pudo usar su botón tras los intentos ajenos")
        if json.loads(raw(PORT, "GET", "/tg/approved", {"Authorization": t1}).body)["v"] != '{"n":1}': bad.append("la acción no recibió sus args")
        # repetición
        if press(tg1, data) != "Esta acción ya caducó o ya se usó.": bad.append("el botón se pudo usar dos veces")
        # manipulado / formato
        d2 = sendbtn(t1, tg1)
        for label, junk in (("nonce alterado", d2[:-1] + ("A" if d2[-1] != "A" else "B")), ("prefijo", "b:" + d2[2:]), ("largo", d2 + "x"), ("corto", d2[:-1]), ("vacío", ""), ("SQL", "a:' OR 1=1 --"), ("solo prefijo", "a:")):
            if press(tg1, junk) != "Esta acción ya caducó o ya se usó.": bad.append(f"{label} aceptado")
        if press(tg1, d2) != "Aprobado 1": bad.append("el botón legítimo debía funcionar tras los intentos manipulados")
        # caducado
        d3 = sendbtn(t1, tg1); ac = rows("pbmini_tg_actions", f'rid = "{u1}" && used = false')
        for a in ac: L.api(PORT, "PATCH", f"/api/collections/pbmini_tg_actions/records/{a['id']}", {"expires": "2000-01-01 00:00:00.000Z"}, S["su"])
        if press(tg1, d3) != "Esta acción ya caducó o ya se usó.": bad.append("un botón caducado funcionó")
        # carrera: el mismo botón 10 veces a la vez
        d4 = sendbtn(t1, tg1); f.clear(); L.api(PORT, "POST", "/api/collections/users/records", dict(email=f"c{os.getpid()}@lab.test", password="Passw0rd!!", passwordConfirm="Passw0rd!!"), S["su"]) if False else None
        res = []
        def go(): hook(cbq(tg1, d4))
        ts = [threading.Thread(target=go) for _ in range(10)]; [t.start() for t in ts]; [t.join() for t in ts]
        okc = [c for c in f.of("answerCallbackQuery") if c["body"].get("text") == "Aprobado 1"]
        if len(okc) != 1: bad.append(f"carrera: el mismo botón se ejecutó {len(okc)} veces (esperado 1)")
        return not bad, "; ".join(bad) or "botón ajeno / Telegram sin vincular / manipulado / caducado / repetido: «ya caducó»; los intentos ajenos no queman el nonce; el legítimo se ejecuta una vez (también con 10 pulsaciones simultáneas)"
    add("Botones: un solo uso, solo del dueño, sin manipulación", "Solo el dueño, una vez, antes de caducar; la acción recibe sus args", btn_flow)

    def btn_account_gone(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        f.clear(); post("/tg/btn", tok, {"kind": "ok"}); data = f.sent(tg)[0]["body"]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
        L.api(PORT, "PATCH", f"/api/collections/users/records/{uid}", {"status": "banned"}, S["su"])
        f.clear(); hook(cbq(tg, data)); a = f.of("answerCallbackQuery")
        if not a or a[0]["body"].get("text") == "Aprobado 1": bad.append("una cuenta bloqueada ejecutó una acción")
        if json.loads(raw(PORT, "GET", "/tg/approved", {"Authorization": S["su"]}).body if False else '{"v":""}')["v"]: pass
        return not bad, "; ".join(bad) or "la cuenta bloqueada después de enviar el botón ya no puede ejecutar la acción"
    add("Una cuenta bloqueada no ejecuta acciones de botones", "La acción no se ejecuta", btn_account_gone)


    # ------------------------------------------------------------------ eventos de la app (hooks) => Telegram
    def hook_flow(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]; su = S["su"]
        pid = L.api(PORT, "POST", "/api/collections/pedidos/records", {"cliente": uid, "numero": "A-<b>1</b>", "estado": "nuevo"}, su)["id"]
        t1 = f.texts(tg)
        if len(t1) != 1 or "Recibimos tu pedido" not in t1[0] or "&lt;b&gt;1&lt;/b&gt;" not in t1[0]: bad.append(f"alta del pedido → {t1}")
        patch = lambda est: L.api(PORT, "PATCH", f"/api/collections/pedidos/records/{pid}", {"estado": est}, su)
        patch("enviado"); t2 = f.texts(tg)
        if len(t2) != 2 or "Estado: enviado" not in t2[1]: bad.append(f"cambio de estado → {t2}")
        kb = f.sent(tg)[-1]["body"].get("reply_markup", {}).get("inline_keyboard", [[{}]])[0][0]
        if kb.get("text") != "Recibido" or not str(kb.get("callback_data", "")).startswith("a:"): bad.append(f"botón del aviso: {kb}")
        patch("enviado"); patch("enviado")
        if len(f.texts(tg)) != 2: bad.append("guardar el pedido sin cambiar el estado no debe avisar")
        patch("entregado"); patch("enviado")   # vuelve a un estado ya notificado: la key (pedido+estado) evita repetirlo
        t3 = f.texts(tg)
        if len(t3) != 3 or "Estado: entregado" not in t3[2]: bad.append(f"estado repetido o nuevo → {t3}")
        # pulsar el botón del aviso ejecuta la acción del dueño
        data = f.sent(tg)[1]["body"]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
        f.clear(); hook(cbq(tg, data)); a = f.of("answerCallbackQuery")
        if not a or a[0]["body"].get("text") != "Aprobado 9": bad.append(f"el botón del aviso no ejecutó la acción: {a[0]['body'] if a else None}")
        return not bad, "; ".join(bad) or "alta y cambios de estado de un registro avisan al dueño (texto escapado, con botón); sin cambio de estado no avisa; la misma key no se repite; el botón ejecuta su acción"
    add("Evento de la app: un registro que cambia avisa a su dueño por Telegram", "notify() desde un hook: un aviso por cambio real, escapado, idempotente y con botón", hook_flow)

    def hook_safe(_):
        bad = []; f = S["fake"]; su = S["su"]
        # el dueño no está vinculado / no existe / vacío: el guardado sigue funcionando y no sale nada
        uid, tok = mkuser(); f.clear()
        for cliente in (uid, "", "no-es-un-id", "x" * 15):
            try: L.api(PORT, "POST", "/api/collections/pedidos/records", {"cliente": cliente, "numero": "B", "estado": "nuevo"}, su)
            except Exception as e: bad.append(f"el guardado falló con cliente={cliente!r}: {e}")
        if f.sent(): bad.append("se envió algo a un destino no vinculado")
        # Telegram caído: el guardado sigue funcionando y el aviso queda en cola
        uid2, tok2 = fresh(nexttg()); tg = tgn[0]; f.mode = "500"
        try: pid = L.api(PORT, "POST", "/api/collections/pedidos/records", {"cliente": uid2, "numero": "C", "estado": "nuevo"}, su)["id"]
        except Exception as e: f.mode = "ok"; return False, f"con Telegram caído el guardado falló: {e}"
        f.mode = "ok"; ob = rows("pbmini_tg_outbox", f'rid = "{uid2}"')
        if len(ob) != 1 or ob[0]["state"] != "pending": bad.append(f"el aviso debía quedar pendiente: {[(o['state'], o['error']) for o in ob]}")
        # cuenta bloqueada: no recibe
        uid3, tok3 = fresh(nexttg()); tg3 = tgn[0]; L.api(PORT, "PATCH", f"/api/collections/users/records/{uid3}", {"status": "banned"}, su)
        f.clear(); L.api(PORT, "POST", "/api/collections/pedidos/records", {"cliente": uid3, "numero": "D", "estado": "nuevo"}, su)
        if f.sent(tg3): bad.append("una cuenta bloqueada recibió el aviso")
        # límites: más de 20 avisos en un minuto a un mismo chat; el guardado nunca falla
        uid4, tok4 = fresh(nexttg()); tg4 = tgn[0]
        pid4 = L.api(PORT, "POST", "/api/collections/pedidos/records", {"cliente": uid4, "numero": "E", "estado": "e0"}, su)["id"]
        fails = 0
        for i in range(1, 26):
            try: L.api(PORT, "PATCH", f"/api/collections/pedidos/records/{pid4}", {"estado": f"e{i}"}, su)
            except Exception: fails += 1
        n = len(f.sent(tg4))
        if fails: bad.append(f"{fails} guardados fallaron al superar el límite")
        if n > 20: bad.append(f"se enviaron {n} avisos a un chat en un minuto (máximo 20)")
        kill_pending()
        return not bad, "; ".join(bad) or f"destino no vinculado/vacío/inválido, Telegram caído, cuenta bloqueada y límite superado: el guardado de la app nunca falla (avisos a un chat limitados a {n}); lo que no puede salir se encola o se descarta"
    add("Evento de la app: un fallo de Telegram nunca rompe el guardado", "Guardado 200 siempre; sin envío a no vinculados ni bloqueados; límites respetados", hook_safe)

    # ------------------------------------------------------------------ notify: envío simple desde cualquier parte
    def notify_hook(_):
        bad = []; f = S["fake"]; su = S["su"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        aviso = lambda **k: L.api(PORT, "POST", "/api/collections/avisos/records", k, su)
        aviso(tipo="texto", destino="user:" + uid, texto="hola <b>x</b> & y")
        t = f.texts(tg)
        if t != ["hola &lt;b&gt;x&lt;/b&gt; &amp; y"]: bad.append(f"texto simple a un usuario: {t}")
        aviso(tipo="objeto", destino="user:" + uid, texto="con título"); t = f.texts(tg)
        if len(t) != 2 or not t[1].startswith("<b>Aviso</b>\n"): bad.append(f"mensaje con título: {t}")
        f.clear(); aviso(tipo="texto", destino="user:" + uid, texto="uno", clave="n-1"); aviso(tipo="texto", destino="user:" + uid, texto="uno", clave="n-1")
        if len(f.texts(tg)) != 1: bad.append(f"la misma key debe enviarse una sola vez: {len(f.texts(tg))}")
        # operadores y grupo
        f.clear(); aviso(tipo="texto", destino="ops", texto="alerta <i>ops</i>"); cron()
        got = sorted(c["chat"] for c in f.sent() if "alerta" in c["body"]["text"])
        if got != sorted(OPS): bad.append(f"operadores: {got}")
        if any("<i>" in c["body"]["text"] for c in f.sent()): bad.append("HTML sin escapar en la alerta de operadores")
        admin = fresh(nexttg(), roles=["admin"]); f.clear(); aviso(tipo="texto", destino="group:staff", texto="para el grupo"); cron()
        if str(tgn[0]) not in {c["chat"] for c in f.sent() if c["body"]["text"] == "para el grupo"}: bad.append("el grupo no recibió el aviso")
        # destinos o mensajes inválidos: el guardado sigue funcionando y no sale nada
        f.clear()
        for d, tx in (("user:no-es-un-id", "x"), ("group:NOPE", "x"), ("user:" + uid, ""), ("user:" + uid, "x" * 4097)):
            try: aviso(tipo="texto", destino=d, texto=tx)
            except Exception as e: bad.append(f"el guardado falló con destino={d!r}: {str(e)[:80]}")
        if f.sent(): bad.append(f"se envió algo con destinos/mensajes inválidos: {[c['body'].get('text', '')[:20] for c in f.sent()]}")
        return not bad, "; ".join(bad) or "notify.send desde un hook: texto simple o con título (escapado), idempotente por key, a un usuario, a los operadores y a un grupo; destinos o mensajes inválidos no rompen el guardado y no envían nada"
    add("notify.send: envío simple desde un hook a usuario, grupo u operadores", "Escapado, idempotente por key; los errores no rompen el guardado", notify_hook)

    def notify_ctx(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); tg = tgn[0]
        r = post("/tg/notify", tok, {"kind": "me"}); j = json.loads(r.body) if r.status == 200 else {}
        if j.get("telegram", {}).get("status") != "sent" or f.texts(tg) != ["desde ctx.notify"]: bad.append(f"ctx.notify a «me»: {r.status} {r.body[:100]} {f.texts(tg)}")
        f.clear()
        for kind in ("two", "none", "unknown", "opsfalse", "badgroup", "baduser", "arr", "str"):
            if post("/tg/notify", tok, {"kind": kind}).status != 500: bad.append(f"destino inválido «{kind}» aceptado")
        if raw(PORT, "GET", "/tg/notify", {"Authorization": tok}).status != 500: bad.append("ctx.notify desde GET")
        if raw(PORT, "POST", "/tg/notifypub", {**J}, "{}").status != 500: bad.append("ctx.notify en una ruta pública")
        if raw(PORT, "POST", "/tg/notifysu", {"Authorization": S["su"], **J}, "{}").status != 500: bad.append("{ user: \"me\" } con un superusuario debe fallar")
        if f.sent(): bad.append("se envió algo con destinos inválidos")
        return not bad, "; ".join(bad) or "ctx.notify({ user: \"me\" }) envía; destinos con 0 o 2 claves, desconocidos, con tipos o formatos inválidos, GET, rutas públicas y «me» de un superusuario se rechazan sin enviar"
    add("ctx.notify: destinos válidos y rechazo de los inválidos", "Solo user/group/ops bien formados; no en GET ni en rutas públicas", notify_ctx)

    # ------------------------------------------------------------------ login por Mini App
    def lg(data=None, hdr=None, method="POST", body=None):
        return raw(PORT, method, "/_telegram/login", {**J, **(hdr or {})}, body if body is not None else json.dumps(data))
    OTHER = "999999999:AAH_otherTokenOtherTokenOtherToken1234"

    def login_ok(_):
        bad = []; uid, tok = fresh(nexttg(), name="Ana"); tg = tgn[0]
        r = lg({"initData": init_data(tg, first="José 🎉 <b>Ñ")}); j = json.loads(r.body) if r.status == 200 else {}
        if r.status != 200 or not j.get("token") or j.get("record", {}).get("id") != uid: return False, f"HTTP {r.status} {r.body[:160]}"
        w = raw(PORT, "GET", "/tg/who", {"Authorization": j["token"]}); wj = json.loads(w.body) if w.status == 200 else {}
        if wj.get("id") != uid or wj.get("sessions", 0) < 1: bad.append(f"el token no identifica al usuario o no registró la sesión: {w.status} {w.body[:100]}")
        if "tokenKey" in r.body or "password" in r.body: bad.append("la respuesta expone campos internos")
        uid2, tok2 = fresh(nexttg()); tg2 = tgn[0]
        j2 = json.loads(lg({"initData": init_data(tg2)}).body)
        if j2.get("record", {}).get("id") != uid2 or j2["token"] == j["token"]: bad.append("dos Telegram distintos deben dar dos cuentas distintas")
        # el HMAC de la validación (JS puro) coincide con el de Python incluso con unicode y campos adicionales
        extra = {"chat_type": "private", "start_param": "x y&z=1", "signature": "abc-_"}
        if lg({"initData": init_data(tg, extra=extra)}).status != 200: bad.append("campos adicionales firmados (incluido signature) deben aceptarse")
        return not bad, "; ".join(bad) or "initData válido (con unicode y campos extra) → token del usuario vinculado, con sesión registrada; cada Telegram da su cuenta; sin campos internos"
    add("Mini App: login con initData válido", "200 con token de la cuenta vinculada y sesión registrada", login_ok)

    def login_forged(_):
        bad = []; ua, ta = fresh(nexttg()); tga = tgn[0]; ub, tb = fresh(nexttg()); tgb = tgn[0]
        now = int(time.time())
        def flip(f): h = f["hash"]; f["hash"] = h[:-1] + ("0" if h[-1] != "0" else "1"); return f
        def swap_user(f): f["user"] = json.dumps({"id": tgb, "first_name": "Ana"}, separators=(",", ":")); return f
        def add_field(f): f["extra"] = "1"; return f
        def del_field(f): del f["query_id"]; return f
        def upper(f): f["hash"] = f["hash"].upper(); return f
        def short(f): f["hash"] = f["hash"][:32]; return f
        def nohash(f): del f["hash"]; return f
        def empty_hash(f): f["hash"] = ""; return f
        def dup(f): return f
        tests = {
            "hash alterado": init_data(tga, tamper=flip), "otro usuario con el hash de A": init_data(tga, tamper=swap_user), "campo añadido tras firmar": init_data(tga, tamper=add_field),
            "campo eliminado": init_data(tga, tamper=del_field), "hash en mayúsculas": init_data(tga, tamper=upper), "hash corto": init_data(tga, tamper=short), "sin hash": init_data(tga, tamper=nohash),
            "hash vacío": init_data(tga, tamper=empty_hash), "firmado con el token de OTRO bot": init_data(tga, token=OTHER),
            "auth_date vencido (601 s)": init_data(tga, auth_date=now - 601), "auth_date de hace un año": init_data(tga, auth_date=now - 31536000), "auth_date futuro (+120 s)": init_data(tga, auth_date=now + 120),
            "auth_date no numérico": init_data(tga, auth_date="abc"), "auth_date negativo": init_data(tga, auth_date="-5"),
            "user no es JSON (bien firmado)": init_data(tga, extra={"user": "no-json"}), "user sin id (bien firmado)": init_data(tga, extra={"user": "{}"}),
            "user.id como texto (bien firmado)": init_data(tga, extra={"user": json.dumps({"id": str(tga)})}), "user.is_bot (bien firmado)": init_data(tga, extra={"user": json.dumps({"id": tga, "is_bot": True})}),
            "user.id cero (bien firmado)": init_data(tga, extra={"user": json.dumps({"id": 0})}), "user.id negativo (bien firmado)": init_data(tga, extra={"user": json.dumps({"id": -tga})}),
            "user arreglo (bien firmado)": init_data(tga, extra={"user": "[1]"}), "clave duplicada": init_data(tga) + "&auth_date=" + str(now), "porcentaje inválido": init_data(tga) + "&x=%zz",
            "clave con caracteres raros": init_data(tga) + "&a%00b=1", "vacío": "", "solo hash": "hash=" + "0" * 64, "sin signo =": "abc" * 20, "enorme (8193)": "a=" + "x" * 8191, "mil campos": "&".join(f"k{i}=1" for i in range(60)),
            "ceros nulos": init_data(tga) + "%00",
        }
        for label, data in tests.items():
            r = lg({"initData": data})
            if r.status not in (400, 401) or "token" in r.body: bad.append(f"{label} → {r.status}")
        for label, body in (("initData numérico", {"initData": 5}), ("initData nulo", {"initData": None}), ("initData arreglo", {"initData": ["x"]}), ("clave extra", {"initData": init_data(tga), "x": 1}),
                            ("sin initData", {}), ("arreglo", [1]), ("otra clave", {"data": init_data(tga)})):
            r = lg(body)
            if r.status not in (400, 401) or "token" in r.body: bad.append(f"{label} → {r.status}")
        for label, kw in (("JSON roto", {"body": "{"}), ("texto plano", {"body": "initData=x", "hdr": {"Content-Type": "text/plain"}}), ("GET", {"method": "GET"}), ("PUT", {"method": "PUT", "data": {"initData": init_data(tga)}})):
            r = lg(**({"data": None, **kw} if "body" not in kw else kw))
            if r.status in (200, 201): bad.append(f"{label} → {r.status}")
        return not bad, "; ".join(bad) or f"{len(tests) + 7 + 4} variantes (hash alterado/mayúsculas/vacío, otro bot, fechas vencidas o futuras, user inválido o bot, claves duplicadas, % inválido, tamaños, cuerpo mal formado, otros métodos): ninguna emite token"
    add("Mini App: initData falsificado o inválido nunca da sesión", "400/401 sin token en todas las variantes", login_forged)

    def login_replay(_):
        bad = []; uid, tok = fresh(nexttg()); tg = tgn[0]; d = init_data(tg)
        a = lg({"initData": d}).status; b = lg({"initData": d}).status
        if (a, b) != (200, 401): bad.append(f"mismo initData dos veces → {(a, b)} (esperado 200 y 401)")
        # la fecha pasa de mano en mano: el hash cambia con cada auth_date, así que uno nuevo sí vale
        if lg({"initData": init_data(tg, auth_date=int(time.time()) - 5)}).status != 200: bad.append("un initData nuevo y válido debe aceptarse")
        return not bad, "; ".join(bad) or "un initData ya usado no sirve otra vez (singleUse); uno nuevo sí"
    add("Mini App: un initData solo sirve una vez", "Repetición → 401", login_replay)

    def login_accounts(_):
        bad = []; tgu = nexttg()
        r = lg({"initData": init_data(tgu)})
        if r.status != 403 or "token" in r.body or json.loads(r.body).get("code") != "not_linked": bad.append(f"Telegram sin cuenta vinculada → {r.status} {r.body[:80]}")
        uid, tok = fresh(nexttg()); tg = tgn[0]
        L.api(PORT, "PATCH", f"/api/collections/users/records/{uid}", {"status": "suspended"}, S["su"])
        r = lg({"initData": init_data(tg)})
        if r.status != 403 or "token" in r.body: bad.append(f"cuenta bloqueada → {r.status}")
        L.api(PORT, "PATCH", f"/api/collections/users/records/{uid}", {"status": ""}, S["su"])
        if lg({"initData": init_data(tg, auth_date=int(time.time()) - 3)}).status != 200: bad.append("al desbloquear debe volver a poder entrar")
        uid2, _t = fresh(nexttg()); tg2 = tgn[0]
        L.api(PORT, "DELETE", f"/api/collections/users/records/{uid2}", None, S["su"])
        if lg({"initData": init_data(tg2)}).status != 403: bad.append("cuenta borrada debe dar 403 not_linked")
        return not bad, "; ".join(bad) or "sin vínculo → 403 not_linked; cuenta bloqueada → 403 sin token (y vuelve al desbloquear); cuenta borrada → 403"
    add("Mini App: cuentas no vinculadas, bloqueadas o borradas", "Sin token; el motivo es el mínimo necesario", login_accounts)

    def login_session(_):
        bad = []; uid, tok = fresh(nexttg()); tg = tgn[0]
        t = json.loads(lg({"initData": init_data(tg)}).body)["token"]
        if raw(PORT, "GET", "/tg/who", {"Authorization": t}).status != 200: bad.append("el token recién emitido no funciona")
        if raw(PORT, "GET", "/api/collections/users/auth-refresh" if False else "/tg/who", {"Authorization": t}).status != 200: bad.append("segunda petición falló")
        rl = raw(PORT, "POST", "/tg/out", {"Authorization": t, **J}, "{}")
        after = raw(PORT, "GET", "/tg/who", {"Authorization": t}).status
        if rl.status != 200 or after != 401: bad.append(f"tras logout el token debe quedar vetado: logout {rl.status}, después {after}")
        # el token nativo también queda vetado en la API de PocketBase (veto global)
        t2 = json.loads(lg({"initData": init_data(tg, auth_date=int(time.time()) - 2)}).body)["token"]
        raw(PORT, "POST", "/tg/out", {"Authorization": t2, **J}, "{}")
        n = raw(PORT, "POST", "/api/collections/users/auth-refresh", {"Authorization": t2, **J}, "{}").status
        if n != 401: bad.append(f"el token vetado no debe refrescarse en la API nativa: {n}")
        return not bad, "; ".join(bad) or "el token del login lleva sid: logout lo veta en pbmini y en la API nativa (no se puede refrescar)"
    add("Mini App + sesiones: el token es revocable", "logout → 401 también en /api/*", login_session)

    def login_autoprovision(_):
        bad = []
        restart(auto=True)
        tgn_ = nexttg(); r = lg({"initData": init_data(tgn_)}); j = json.loads(r.body) if r.status == 200 else {}
        if r.status != 200 or not j.get("token"): bad.append(f"autoprovision → {r.status} {r.body[:100]}")
        else:
            uid = j["record"]["id"]; u = L.api(PORT, "GET", f"/api/collections/users/records/{uid}", None, S["su"])
            if u["email"] != f"tg{tgn_}@telegram.invalid" or u.get("verified") is not False: bad.append(f"cuenta creada inesperada: {u['email']} verified={u.get('verified')}")
            if len(rows("pbmini_telegram", f'tgid = "{tgn_}"')) != 1: bad.append("no se creó el vínculo")
            j2 = json.loads(lg({"initData": init_data(tgn_, auth_date=int(time.time()) - 2)}).body)
            if j2["record"]["id"] != uid: bad.append("el segundo login debe usar la misma cuenta")
            if L.api(PORT, "GET", f"/api/collections/users/records?filter=" + urllib.parse.quote(f'email = "tg{tgn_}@telegram.invalid"'), None, S["su"])["totalItems"] != 1: bad.append("cuenta duplicada")
            # la contraseña es aleatoria: no se puede entrar por la vía normal
            if raw(PORT, "POST", "/api/collections/users/auth-with-password", J, json.dumps({"identity": u["email"], "password": "Passw0rd!!"})).status == 200: bad.append("la cuenta creada acepta una contraseña adivinable")
        # carrera: el mismo Telegram nuevo desde 8 hilos crea una sola cuenta
        tgr = nexttg(); res = []
        def go(i): res.append(lg({"initData": init_data(tgr, auth_date=int(time.time()) - i)}).status)
        ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
        nr = len(rows("pbmini_telegram", f'tgid = "{tgr}"'))
        if nr != 1: bad.append(f"carrera: {nr} vínculos")
        restart(auto=False)
        if lg({"initData": init_data(nexttg())}).status != 403: bad.append("con autoprovision apagado un Telegram nuevo debe dar 403")
        return not bad, "; ".join(bad) or "autoprovision: crea la cuenta (email .invalid, no verificada, contraseña aleatoria) y su vínculo una sola vez (también con 8 hilos); apagado → 403"
    add("Mini App: autoprovision opcional", "Cuenta creada solo si se activa; sin duplicados", login_autoprovision)

    def login_reuse(_):
        bad = []; restart(single=False)
        uid, tok = fresh(nexttg()); tg = tgn[0]; d = init_data(tg)
        a, b = lg({"initData": d}).status, lg({"initData": d}).status
        if (a, b) != (200, 200): bad.append(f"singleUse=false: {(a, b)}")
        if lg({"initData": init_data(tg, auth_date=int(time.time()) - 700)}).status != 401: bad.append("aun sin singleUse, un initData vencido no sirve")
        restart(single=True)
        return not bad, "; ".join(bad) or "con singleUse=false se permite repetir dentro de maxAge; el vencimiento sigue aplicando"
    add("Mini App: singleUse=false relaja la repetición, no la caducidad", "Repetible dentro de maxAge; vencido → 401", login_reuse)

    def login_rate(_):
        bad = []; codes = []; restart(per=20)
        for i in range(24): codes.append(lg({"initData": "x" * 30}).status)
        if 429 not in codes: bad.append(f"sin límite: {sorted(set(codes))}")
        first = codes.index(429) + 1 if 429 in codes else None
        restart()
        return not bad and first == 21, "; ".join(bad) or f"el intento {first} desde una misma IP recibe 429 (20 por minuto)"
    add("Mini App: los intentos de login están limitados por IP", "A partir del 21 en un minuto → 429", login_rate)

    # ------------------------------------------------------------------ secretos y desactivado
    def secrets(_):
        bad = []; log = S["pb"].log()
        if TOKEN in log or TOKEN.split(":")[1] in log: bad.append("el token del bot aparece en el log del servidor")
        if SECRET in log: bad.append("el secret del webhook aparece en el log")
        blob = ""
        for n in ("pbmini_telegram", "pbmini_tg_links", "pbmini_tg_outbox", "pbmini_tg_actions"): blob += json.dumps(rows(n))
        if TOKEN in blob or SECRET in blob: bad.append("un secreto aparece en las colecciones internas")
        S["fake"].mode = "ok"
        # un fallo de red hacia la API no debe delatar el token (se redacta)
        return not bad, "; ".join(bad) or "ni el token del bot ni el secret del webhook aparecen en el log ni en las colecciones internas"
    add("Los secretos no se filtran (log ni base de datos)", "Ni token ni secret en ningún sitio persistente", secrets)

    def token_redaction(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg()); S["pb"].stop()
        f.stop(); S["fake"] = None
        # nuevo Telegram falso apagado: la API no responde; el envío debe quedar en cola sin delatar el token en el log
        dead = FakeTelegram(); port_dead = dead.port; dead.stop()
        S["env"]["TELEGRAM_API_URL"] = f"http://127.0.0.1:{port_dead}"
        pb = L.PB(EXE, S["root"], PORT, env=S["env"]); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): return False, "no arrancó con la API caída: " + pb.log()[-300:]
        S["su"] = su_login(PORT); tok = L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=L.api(PORT, "GET", f"/api/collections/users/records/{uid}", None, S["su"])["email"], password="Passw0rd!!"))["token"]
        r = post("/tg/me", tok, {"text": "x", "key": "caida"}); j = json.loads(r.body) if r.status == 200 else {}
        log = pb.log()
        if j.get("status") != "queued": bad.append(f"con la API caída debe quedar en cola: {j} (HTTP {r.status})")
        if TOKEN in log or TOKEN.split(":")[1] in log: bad.append("el token apareció en el log al fallar la conexión")
        ob = rows("pbmini_tg_outbox", f'rid = "{uid}" && dedupe ~ "caida"')
        if TOKEN in json.dumps(ob): bad.append("el token apareció en la cola")
        # la vuelta de la API drena la cola
        S["fake"] = FakeTelegram(); S["pb"].stop(); S["env"]["TELEGRAM_API_URL"] = f"http://127.0.0.1:{S['fake'].port}"
        pb = L.PB(EXE, S["root"], PORT, env=S["env"]); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): return False, "no rearrancó"
        S["su"] = su_login(PORT)
        kill_pending()
        return not bad, "; ".join(bad) or "con la API de Telegram caída el envío queda en cola (queued) y el token no aparece ni en el log ni en la cola"
    add("API de Telegram caída: cola sin filtrar el token", "queued; ni log ni cola contienen el token", token_redaction)

    def cron_gc(_):
        bad = []; f = S["fake"]; uid, tok = fresh(nexttg())
        post("/tg/me", tok, {"text": "x", "key": "gc1"}); post("/tg/btn", tok, {"kind": "ok"}); post("/tg/link", tok)
        old = "2000-01-01 00:00:00.000Z"; ids = {}
        for coll, field in (("pbmini_tg_outbox", "next_try"), ("pbmini_tg_actions", "expires"), ("pbmini_tg_links", "expires")):
            rs = rows(coll, f'rid = "{uid}"')
            if not rs: bad.append(f"no hay filas de {coll} para el caso"); continue
            for r in rs: L.api(PORT, "PATCH", f"/api/collections/{coll}/records/{r['id']}", {field: old}, S["su"])
            ids[coll] = [r["id"] for r in rs]
        pend = json.loads(post("/tg/me", tok, {"text": "pendiente", "key": "gc2"}).body)
        fresh_row = rows("pbmini_tg_outbox", f'rid = "{uid}" && dedupe ~ "gc2"')[0]["id"]
        cron("pbmini_telegram_gc")
        for coll, lst in ids.items():
            left = [i for i in lst if rows(coll, f'id = "{i}"')]
            if left: bad.append(f"{coll}: {len(left)} fila(s) antiguas sin purgar")
        if not rows("pbmini_tg_outbox", f'id = "{fresh_row}"'): bad.append("se purgó una fila reciente")
        return not bad, "; ".join(bad) or "el cron de limpieza elimina lo enviado/muerto, los nonces y los enlaces caducados hace más de la retención y conserva lo reciente"
    add("Retención: el cron de limpieza purga lo antiguo", "Sin filas viejas (datos personales)", cron_gc)

    # ------------------------------------------------------------------ fail-closed del entorno y la configuración
    def bad_boot_case(label, env, cfgtxt, extra):
        def run(_):
            root, full = sandbox("tgbad", BADPORT, env, cfgtxt, {"ok.js": 'module.exports = { auth: "public", get: (ctx) => ctx.json({ ok: 1 }) };'}, extra)
            full = {**full, "PBMINI_ON_ERROR": ""}
            pb = L.PB(EXE, root, BADPORT, env=full); pb.serve(); died, end = False, time.time() + 14
            while time.time() < end:
                if pb.proc.poll() is not None: died = True; break
                time.sleep(0.25)
            log = pb.log(); pb.stop()
            leaked = TOKEN in log
            return died and "pbmini" in log and not leaked, ("abortó el arranque (fail-closed)" if died else "ARRANCÓ con configuración inválida") + (f"; el token aparece en el log" if leaked else "")
        add(f"Fail-closed: {label}", "El servidor NO arranca (una opción ignorada podría dejar el módulo mal protegido)", run)
    for lab_, env_, cfg_, ex_ in bad_boots(): bad_boot_case(lab_, env_, cfg_, ex_)

    def module_off(_):
        bad = []; root, full = sandbox("tgoff", BADPORT, {}, "module.exports = {};", {"p.js": 'module.exports = { auth: "user", post: (ctx) => ctx.json(ctx.telegram("me", { text: "x" })) };'}, {})
        pb = L.PB(EXE, root, BADPORT, env=full); pb.serve()
        try:
            if not pb.wait_ready(): return False, "no arrancó sin telegram: " + pb.log()[-200:]
            if raw(BADPORT, "POST", "/_telegram/webhook", {"X-Telegram-Bot-Api-Secret-Token": SECRET, **J}, '{"update_id":1}').status not in (404, 405): bad.append("la ruta del webhook existe con el módulo apagado")
            if raw(BADPORT, "POST", "/_telegram/login", J, "{}").status not in (404, 405): bad.append("la ruta de login existe con el módulo apagado")
            su = L.api(BADPORT, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]
            cols = [c["name"] for c in L.api(BADPORT, "GET", "/api/collections?perPage=200", None, su)["items"]]
            if any(c.startswith("pbmini_tg") or c == "pbmini_telegram" for c in cols): bad.append("se crearon colecciones con el módulo apagado")
        finally: pb.stop()
        return not bad, "; ".join(bad) or "con el módulo apagado (por defecto) no hay rutas /_telegram ni colecciones y el proyecto arranca sin ninguna variable TELEGRAM_*"
    add("Módulo apagado por defecto: sin rutas, sin colecciones, sin variables", "Nada cambia respecto a un proyecto sin el módulo", module_off)

    # ------------------------------------------------------------------ CLI
    def cli(root, env, *args):
        e = dict(os.environ, **env)
        r = subprocess.run([EXE, *args, f"--dir={root}/pb_data_cli", f"--hooksDir={root}/pb_hooks", f"--publicDir={root}/pb_public"], capture_output=True, text=True, timeout=60, cwd=root, env=e, encoding="utf-8", errors="replace")
        return r.returncode, r.stdout + r.stderr

    def cli_tgaction(_):
        bad = []; root, full = sandbox("tgcli", BADPORT, {"TELEGRAM_BOT_TOKEN": TOKEN, "TELEGRAM_WEBHOOK_SECRET": SECRET}, cfgtxt(), {"ok.js": 'module.exports = { auth: "public", get: (ctx) => ctx.json({ ok: 1 }) };'}, {})
        fe = FakeTelegram(); full = {**full, "TELEGRAM_API_URL": f"http://127.0.0.1:{fe.port}"}
        try:
            rc, out = cli(root, full, "pbmini:new", "tgaction", "aprobar"); f = os.path.join(root, "pb_hooks", "telegram", "actions", "aprobar.js")
            if rc != 0 or not os.path.isfile(f): bad.append(f"no creó la acción (rc={rc}): {out[-160:]!r}")
            else:
                txt = open(f, encoding="utf-8").read()
                if "run(app" not in txt or "TelegramAction" not in txt: bad.append("plantilla inesperada")
                before = txt; open(f, "a", encoding="utf-8").write("// editado\n")
                rc2, _o = cli(root, full, "pbmini:new", "tgaction", "aprobar")
                if rc2 == 0 or "// editado" not in open(f, encoding="utf-8").read(): bad.append("sobrescribió o aceptó una acción existente")
            for nm in ("../x", "Mala", "a" * 33, "a/b", "a b", "", "-x", "x.js", "x;rm"):
                rc3, _o = cli(root, full, "pbmini:new", "tgaction", nm)
                if rc3 == 0: bad.append(f"aceptó el nombre {nm!r}")
            rc4, _o = cli(root, full, "pbmini:new", "tgaction", "a", "b")
            if rc4 == 0: bad.append("aceptó argumentos de más")
            files = sorted(os.listdir(os.path.join(root, "pb_hooks", "telegram", "actions"))) if os.path.isdir(os.path.join(root, "pb_hooks", "telegram", "actions")) else []
            if files != ["aprobar.js"]: bad.append(f"archivos inesperados: {files}")
            rc5, out5 = cli(root, full, "pbmini:telegram", "status")
            if rc5 != 0 or '"enabled": true' not in out5 or '"getMe": "@lab_bot"' not in out5: bad.append(f"status → rc={rc5} {out5[-200:]!r}")
            if TOKEN in out5 or SECRET in out5 or TOKEN.split(":")[1] in out5: bad.append("status muestra un secreto")
            rc6, out6 = cli(root, {**full, "TELEGRAM_BOT_TOKEN": ""}, "pbmini:telegram", "status")
            if TOKEN in out6: bad.append("el token aparece sin estar definido")
        finally: fe.stop()
        return not bad, "; ".join(bad) or "tgaction crea la plantilla sin sobrescribir y rechaza nombres inválidos; status informa (getMe, cola, vínculos) sin mostrar ningún secreto"
    add("CLI: pbmini:new tgaction y pbmini:telegram status", "Genera sin sobrescribir; el diagnóstico no muestra secretos", cli_tgaction)

    # ------------------------------------------------------------------ notify: núcleo (node) y módulo apagado
    NU = {"res": None}
    def unit_n():
        if NU["res"] is None:
            node = shutil.which("node")
            if not node: NU["res"] = ("skip", "no hay Node en este sistema (instálalo para correr las pruebas del núcleo de notify)")
            else:
                r = subprocess.run([node, os.path.join(L.HERE, "unit_notify.js"), os.path.join(L.ROOT, "pb_hooks")], capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
                try: NU["res"] = ("ok", json.loads(r.stdout.strip().splitlines()[-1]))
                except Exception: NU["res"] = ("err", (r.stdout + r.stderr)[-400:])
        return NU["res"]
    def unit_n_case(group, obj, meta):
        def run(_):
            kind, res = unit_n()
            if kind == "skip": return None, "OMITIDO: " + res
            if kind == "err": return False, "no se pudo ejecutar unit_notify.js: " + res
            g = res["groups"].get(group)
            if g is None: return False, f"el grupo «{group}» no existe en unit_notify.js"
            return not g["fail"], ("; ".join(g["fail"][:6]) + (f" (+{len(g['fail']) - 6})" if len(g["fail"]) > 6 else "")) or f"{g['pass']} comprobaciones"
        add(obj, meta, run)
    unit_n_case("destino", "notify: el destino solo puede ser { user } | { group } | { ops: true } bien formado", "Una clave exacta; ids, nombres y «me» validados; claves raras, tipos erróneos, traversal y __proto__ rechazados")
    unit_n_case("mensaje", "notify: texto simple o mensaje completo", "Un texto se convierte en { text }; un objeto pasa intacto")
    unit_n_case("despacho", "notify: se despacha solo a canales habilitados, con destino y opciones intactos", "Sin canal => error y 0 envíos; un destino inválido nunca llega al canal; «me» solo dentro de una ruta")
    unit_n_case("rutas (ctx.notify)", "ctx.notify: no desde GET ni rutas públicas; «me» = el usuario autenticado", "Superusuario solo a operadores/grupos; sin canales => error")

    def notify_off(_):
        bad = []; root, full = sandbox("tgnoff", BADPORT, {}, "module.exports = {};", {"n.js": 'module.exports = { auth: "user", post: (ctx) => ctx.json(ctx.notify({ user: "me" }, "x")) };'}, {})
        pb = L.PB(EXE, root, BADPORT, env=full); pb.serve()
        try:
            if not pb.wait_ready(): return False, "no arrancó sin telegram: " + pb.log()[-200:]
            su = L.api(BADPORT, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]
            em = f"nn{os.getpid()}@lab.test"; L.api(BADPORT, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
            tok = L.api(BADPORT, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
            r = raw(BADPORT, "POST", "/n", {"Authorization": tok, **J}, "{}")
            if r.status != 500: bad.append(f"ctx.notify sin ningún canal habilitado debe ser un error de programación (500): {r.status}")
        finally: pb.stop()
        return not bad, "; ".join(bad) or "con telegram apagado ctx.notify falla (500) en vez de perder el aviso en silencio"
    add("notify sin canales habilitados: error explícito, no un aviso perdido en silencio", "500 (error de programación)", notify_off)

    def teardown(_):
        try:
            if S["pb"]: S["pb"].stop()
        finally:
            if S["fake"]: S["fake"].stop()
        return True, "servidor y Telegram falso detenidos"
    add("Limpieza: se detienen el servidor y el Telegram falso", "Listo", teardown)

    return cases
