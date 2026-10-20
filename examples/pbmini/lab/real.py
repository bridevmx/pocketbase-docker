"""Pruebas REALES con las variables de `.env` (raíz del repositorio; nunca se versiona). Datos aislados en lab/.run/real: no toca tu base real.
  python real.py serve            arranca el servidor de pruebas (módulos activados) con el entorno del .env y se queda en primer plano
  python real.py check [--send]   comprueba contra la API REAL de Telegram: getMe, getWebhookInfo y (con --send) un mensaje de prueba a TELEGRAM_TEST_CHAT
  python real.py relay            (sin túnel) consulta getUpdates a Telegram y reenvía cada actualización al webhook LOCAL con el secret; para probar /start y botones reales desde tu móvil
  python real.py demo             (con `serve` en marcha) simula un evento de TU app: crea un pedido de la cuenta vinculada y cambia su estado => llega el aviso con botón a tu Telegram
  python real.py clipserve        servidor de pruebas con el módulo `clip` ACTIVADO y un túnel cloudflared (la URL pública se lee sola); Ctrl+C para parar
  python real.py clipdemo         (con `clipserve` en marcha) crea un usuario y un pago REAL de CLIP_TEST_AMOUNT pesos, imprime el link y vigila hasta que se confirme
  python real.py clipstatus <id>  estado de un pago;  python real.py cliprefund <id> [--confirm]  reembolso total (MUEVE DINERO: sin --confirm solo simula; lo ejecuta una persona)
  python real.py selftest         (con `serve` en marcha) recorre vincular -> enviar -> grupo -> alerta -> botón -> login contra el servidor y la API real
El token solo se usa por entorno y se redacta en todo lo que se imprime."""
import json, os, re, shutil, subprocess, sys, time, hmac, hashlib, urllib.parse, urllib.request, http.client
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); REPO = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, HERE)
import lab as L
import attacks_tg as T
import attacks_clip as AC

def load_env(path=os.path.join(REPO, ".env")):
    env = {}
    if not os.path.isfile(path): sys.exit(f"falta {path} (copia .env.example a .env y rellénalo)")
    for ln in open(path, encoding="utf-8"):
        ln = ln.split(" #")[0].rstrip() if " #" in ln else ln.rstrip()
        if not ln.strip() or ln.lstrip().startswith("#") or "=" not in ln: continue
        k, v = ln.split("=", 1); env[k.strip()] = v.strip().strip('"').strip("'")
    return env
E = load_env()
TOKEN = E.get("TELEGRAM_BOT_TOKEN", "")
def red(s): return str(s).replace(TOKEN, "«token»") if TOKEN else str(s)
def need(*ks):
    miss = [k for k in ks if not E.get(k)]
    if miss: sys.exit("faltan en .env: " + ", ".join(miss))
def host(): h, p = (E.get("PB_HTTP") or "127.0.0.1:8095").rsplit(":", 1); return h, int(p)

def tg_api(method, params=None, timeout=15):
    need("TELEGRAM_BOT_TOKEN")
    base = (E.get("TELEGRAM_API_URL") or "https://api.telegram.org").rstrip("/")
    req = urllib.request.Request(f"{base}/bot{TOKEN}/{method}", json.dumps(params or {}).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b"{}") | {"http": e.code}
    except Exception as e: return {"ok": False, "description": red(e)}

def check(send):
    r = tg_api("getMe"); print("getMe:", "OK @" + r["result"]["username"] if r.get("ok") else "FALLO " + red(r.get("description")))
    if not r.get("ok"): sys.exit(1)
    w = tg_api("getWebhookInfo").get("result", {}); print("webhook registrado:", w.get("url") or "(ninguno)", "| pendientes:", w.get("pending_update_count"), "| último error:", w.get("last_error_message") or "-")
    if E.get("TELEGRAM_WEBHOOK_URL") and not (w.get("url") or "").startswith(E["TELEGRAM_WEBHOOK_URL"]): print("  aviso: el webhook de Telegram no apunta a TELEGRAM_WEBHOOK_URL (se registra al arrancar `serve`)")
    chat = E.get("TELEGRAM_TEST_CHAT") or (E.get("TELEGRAM_OPERATOR_CHATS") or "").split(",")[0].strip()
    print("chat de prueba:", chat or "(no definido)")
    if send:
        if not chat: sys.exit("define TELEGRAM_TEST_CHAT o TELEGRAM_OPERATOR_CHATS")
        r = tg_api("sendMessage", {"chat_id": chat, "text": "pbmini: prueba real de envío (puedes ignorar este mensaje)"}); print("sendMessage:", "OK" if r.get("ok") else "FALLO " + red(r.get("description")))
        if not r.get("ok"): sys.exit(1)

def serve():
    need("PB_SUPERUSER_PASSWORD"); exe = L.provision(None); h, port = host()
    root = os.path.join(L.RUN, "real"); pg = root + "-pages"; shutil.rmtree(pg, ignore_errors=True); os.makedirs(pg)
    open(os.path.join(pg, "index.js"), "w", encoding="utf-8").write('module.exports = { auth: "public", get: (ctx) => ctx.json({ ok: true }) };')
    for rel, txt in T.PAGES.items():
        fp = os.path.join(pg, rel); os.makedirs(os.path.dirname(fp), exist_ok=True); open(fp, "w", newline="\n", encoding="utf-8").write(txt)
    keep = os.path.join(root, "pb_data")
    saved = None
    if os.path.isdir(keep):   # conserva los datos entre arranques
        saved = root + "-pbdata"; shutil.rmtree(saved, ignore_errors=True); shutil.move(keep, saved)
    cfg = ('module.exports = { sessions: { enabled: true, legacy: "allow" }, mail: { maxPerRecipientPerHour: 5, maxPerHour: 50 },'
           ' telegram: { enabled: true, collection: "users", groups: { staff: { field: "name", values: ["staff"] }, bulk: { field: "name", values: ["bulk"] } }, login: { enabled: %s, maxAge: 600 } } };' % ("true" if E.get("TELEGRAM_MINIAPP_URL") else "false"))
    L.build_sandbox(root, pg, symlinks=False, clean=True, hooks_extra={"pbmini.config.js": cfg, "telegram/actions/approve.js": T.ACTION, "pedidos.pb.js": T.HOOK})
    if saved and os.path.isdir(saved): shutil.rmtree(keep, ignore_errors=True); shutil.move(saved, keep)
    env = dict(os.environ, **{k: v for k, v in E.items() if v != ""}); env.setdefault("PBMINI_PUBLIC_AUDIT", "warn")
    subprocess.run([exe, "superuser", "upsert", E.get("PB_SUPERUSER_EMAIL", "admin@real.test"), E["PB_SUPERUSER_PASSWORD"], f"--dir={root}/pb_data"], capture_output=True, cwd=root, env=env)
    print(f"servidor de pruebas en http://{h}:{port} (datos en {root}); Ctrl+C para detener", flush=True)
    p = subprocess.run([exe, "serve", f"--http={h}:{port}", f"--dir={root}/pb_data", f"--publicDir={root}/pb_public", f"--hooksDir={root}/pb_hooks", "--indexFallback=false"], cwd=root, env=env)
    sys.exit(p.returncode)

def selftest():
    need("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "PB_SUPERUSER_PASSWORD"); h, port = host()
    chat = E.get("TELEGRAM_TEST_CHAT") or (E.get("TELEGRAM_OPERATOR_CHATS") or "").split(",")[0].strip()
    if not chat or not re.fullmatch(r"[0-9]{1,16}", chat): sys.exit("selftest necesita un chat PRIVADO (id positivo) en TELEGRAM_TEST_CHAT o como primer TELEGRAM_OPERATOR_CHATS")
    tgid = int(chat); J = {"Content-Type": "application/json"}; res = []
    def call(m, p, tok=None, body=None, hdr=None):
        c = http.client.HTTPConnection(h, port, timeout=20); hh = {**J, **(hdr or {})}
        if tok: hh["Authorization"] = tok
        c.request(m, p, json.dumps(body) if body is not None else None, hh); r = c.getresponse(); d = r.read().decode("utf-8", "replace"); return r.status, d
    def step(name, ok, info=""): res.append(ok); print(("  ok   " if ok else "  FALLO "), name, red(info)[:200])
    st, d = call("POST", "/api/collections/_superusers/auth-with-password", body={"identity": E.get("PB_SUPERUSER_EMAIL", "admin@real.test"), "password": E["PB_SUPERUSER_PASSWORD"]})
    if st != 200: sys.exit("no se pudo iniciar sesión como superusuario del servidor de pruebas (¿está `serve` en marcha?)")
    su = json.loads(d)["token"]; email = f"real{int(time.time())}@real.test"
    st, d = call("POST", "/api/collections/users/records", su, {"email": email, "password": "Passw0rd!!real", "passwordConfirm": "Passw0rd!!real", "verified": True, "name": "staff"}); uid = json.loads(d)["id"]
    st, d = call("POST", "/api/collections/users/auth-with-password", body={"identity": email, "password": "Passw0rd!!real"}); tok = json.loads(d)["token"]
    n = [0]
    def hook(u): return call("POST", "/_telegram/webhook", body=u, hdr={"X-Telegram-Bot-Api-Secret-Token": E["TELEGRAM_WEBHOOK_SECRET"]})
    def msg(t): n[0] += 1; return {"update_id": int(time.time()) * 10 + n[0], "message": {"message_id": 1, "from": {"id": tgid, "is_bot": False, "first_name": "T"}, "chat": {"id": tgid, "type": "private"}, "date": 0, "text": t}}
    st, d = call("POST", "/tg/link", tok, {}); m = re.search(r"start=([A-Za-z0-9]{32})", d); step("enlace de vinculación", st == 200 and bool(m), d[:80])
    st, d = hook(msg("/start " + (m.group(1) if m else "x"))); step("/start procesado (el bot responde en tu Telegram: «Cuenta vinculada»)", st == 200)
    st, d = call("POST", "/tg/me", tok, {"title": "Prueba real", "text": "Mensaje de pbmini <b>escapado</b>", "key": "real-1"}); step("envío real a tu chat", st == 200 and json.loads(d).get("status") == "sent", d[:100])
    st, d = call("POST", "/tg/me", tok, {"title": "Prueba real", "text": "x", "key": "real-1"}); step("misma key = sin duplicado", st == 200 and json.loads(d).get("status") == "duplicate", d[:100])
    st, d = call("POST", "/tg/btn", tok, {"kind": "ok"}); step("mensaje con botones (pulsa «Aprobar» en tu Telegram)", st == 200 and json.loads(d).get("status") == "sent", d[:100])
    st, d = call("POST", "/tg/group", su, {"name": "staff", "text": "aviso de grupo (prueba real)", "key": "real-g1"}); step("grupo staff encolado", st == 200 and json.loads(d).get("queued") == 1, d[:100])
    st, _ = call("POST", "/api/crons/pbmini_telegram_outbox", su, {}); time.sleep(2)
    if E.get("TELEGRAM_OPERATOR_CHATS"):
        st, d = call("POST", "/tg/alert", su, {"text": "alerta de operadores (prueba real)", "key": "real-a1"}); step("alerta a operadores encolada", st == 200 and json.loads(d).get("queued", 0) >= 1, d[:100])
        call("POST", "/api/crons/pbmini_telegram_outbox", su, {}); time.sleep(2)
    q = urllib.parse.quote(f'rid = "{uid}"')
    st, d = call("GET", f"/api/collections/pbmini_tg_outbox/records?perPage=50&filter={q}", su); items = json.loads(d)["items"]
    step("cola: todo enviado, sin contenido guardado", bool(items) and all(i["state"] == "sent" and i["payload"] == "" for i in items), str([(i["state"], i["error"]) for i in items]))
    print("\nresultado:", "OK" if all(res) else "CON FALLOS", f"({sum(res)}/{len(res)})"); sys.exit(0 if all(res) else 1)

def relay():
    need("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"); h, port = host()
    w = tg_api("getWebhookInfo").get("result", {})
    if w.get("url"): sys.exit(f"Telegram tiene un webhook registrado ({w['url']}): getUpdates no funciona a la vez. Bórralo con deleteWebhook o no uses relay.")
    print(f"relay activo: Telegram -> http://{h}:{port}/_telegram/webhook (Ctrl+C para parar). Escribe al bot desde tu Telegram.", flush=True)
    off = 0
    while True:
        r = tg_api("getUpdates", {"offset": off, "timeout": 25, "allowed_updates": ["message", "callback_query", "my_chat_member"]}, timeout=40)
        if not r.get("ok"): print("getUpdates falló:", red(r.get("description")), flush=True); time.sleep(3); continue
        for u in r["result"]:
            off = u["update_id"] + 1
            m = u.get("message") or (u.get("callback_query") or {}).get("message") or u.get("my_chat_member") or {}
            kind = next((k for k in ("message", "callback_query", "my_chat_member") if k in u), "otro")
            print(f"  update {u['update_id']} {kind} chat={m.get('chat', {}).get('id')} tipo={m.get('chat', {}).get('type')}", flush=True)
            try:
                c = http.client.HTTPConnection(h, port, timeout=20)
                c.request("POST", "/_telegram/webhook", json.dumps(u), {"Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": E["TELEGRAM_WEBHOOK_SECRET"]})
                print("    -> webhook local:", c.getresponse().status, flush=True)
            except Exception as e: print("    -> el servidor local no responde:", red(e), flush=True)

def demo():
    need("PB_SUPERUSER_PASSWORD"); h, port = host()
    def call(m, p, tok=None, body=None):
        c = http.client.HTTPConnection(h, port, timeout=20); hh = {"Content-Type": "application/json"}
        if tok: hh["Authorization"] = tok
        c.request(m, p, json.dumps(body) if body is not None else None, hh); r = c.getresponse(); return r.status, json.loads(r.read() or b"{}")
    st, d = call("POST", "/api/collections/_superusers/auth-with-password", body={"identity": E.get("PB_SUPERUSER_EMAIL", "admin@real.test"), "password": E["PB_SUPERUSER_PASSWORD"]}); su = d["token"]
    if call("GET", "/api/collections/pedidos", su)[0] == 404: print("colección pedidos:", call("POST", "/api/collections", su, T.PEDIDOS)[0])
    st, d = call("GET", "/api/collections/pbmini_telegram/records?perPage=1&filter=" + urllib.parse.quote("status = 'active'") + "&sort=-created", su)
    if not d.get("items"): sys.exit("no hay ninguna cuenta vinculada: abre un enlace /start primero")
    rid = d["items"][0]["rid"]; num = "R-" + str(int(time.time()) % 100000)
    st, d = call("POST", "/api/collections/pedidos/records", su, {"cliente": rid, "numero": num, "estado": "nuevo"}); print("pedido creado:", st, num); pid = d["id"]; time.sleep(2)
    st, d = call("PATCH", f"/api/collections/pedidos/records/{pid}", su, {"estado": "enviado"}); print("estado -> enviado:", st); time.sleep(2)
    st, d = call("GET", "/api/collections/pbmini_tg_outbox/records?perPage=5&sort=-created", su)
    print("cola:", [(i["state"], i["error"]) for i in d["items"]])

def clipserve():
    need("PB_SUPERUSER_PASSWORD", "CLIP_API_TOKEN", "CLIP_WEBHOOK_TOKEN"); exe = L.provision(None); h, port = host()
    root = os.path.join(L.RUN, "realclip"); pg = root + "-pages"; shutil.rmtree(pg, ignore_errors=True); os.makedirs(pg)
    for rel, txt in AC.PAGES.items():
        fp = os.path.join(pg, rel); os.makedirs(os.path.dirname(fp), exist_ok=True); open(fp, "w", newline="\n", encoding="utf-8").write(txt)
    work = os.path.join(L.RUN, "realclip-tunnel"); shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
    empty = os.path.join(work, "empty-cf.yml"); open(empty, "w").write("")   # un ~/.cloudflared/config.yml con `ingress` anularia --url
    tl = open(os.path.join(work, "tunnel.log"), "wb")
    cf = subprocess.Popen(["cloudflared", "tunnel", "--config", empty, "--url", f"http://{h}:{port}", "--no-autoupdate"], stdout=tl, stderr=subprocess.STDOUT, shell=True)
    url, end = None, time.time() + 60
    while time.time() < end and not url:
        time.sleep(1); m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", open(os.path.join(work, "tunnel.log"), encoding="utf-8", errors="replace").read()); url = m.group(0) if m else None
    if not url: cf.kill(); sys.exit("no se obtuvo la URL del túnel de cloudflared")
    print("túnel:", url, flush=True)
    saved = None
    if os.path.isdir(os.path.join(root, "pb_data")): saved = root + "-pbdata"; shutil.rmtree(saved, ignore_errors=True); shutil.move(os.path.join(root, "pb_data"), saved)
    cfg = 'module.exports = { clip: { enabled: true, reconcile: { minAgeMinutes: 0 } } };'
    L.build_sandbox(root, pg, symlinks=False, clean=True, hooks_extra={"pbmini.config.js": cfg})
    if saved and os.path.isdir(saved): shutil.rmtree(os.path.join(root, "pb_data"), ignore_errors=True); shutil.move(saved, os.path.join(root, "pb_data"))
    env = dict(os.environ, **{k: v for k, v in E.items() if v != ""}); env["CLIP_PUBLIC_URL"] = url; env.setdefault("PBMINI_PUBLIC_AUDIT", "warn")
    subprocess.run([exe, "superuser", "upsert", E.get("PB_SUPERUSER_EMAIL", "admin@real.test"), E["PB_SUPERUSER_PASSWORD"], f"--dir={root}/pb_data"], capture_output=True, cwd=root, env=env)
    print(f"servidor con Clip en http://{h}:{port} (público: {url}); Ctrl+C para detener", flush=True)
    try: subprocess.run([exe, "serve", f"--http={h}:{port}", f"--dir={root}/pb_data", f"--publicDir={root}/pb_public", f"--hooksDir={root}/pb_hooks", "--indexFallback=false"], cwd=root, env=env)
    finally: subprocess.run(["taskkill", "/F", "/T", "/PID", str(cf.pid)], capture_output=True)

def _clipapi():
    need("PB_SUPERUSER_PASSWORD"); h, port = host()
    def call(m, p, tok=None, body=None):
        c = http.client.HTTPConnection(h, port, timeout=60); hh = {"Content-Type": "application/json"}
        if tok: hh["Authorization"] = tok
        c.request(m, p, json.dumps(body) if body is not None else None, hh); r = c.getresponse(); d = r.read().decode("utf-8", "replace")
        try: return r.status, json.loads(d)
        except Exception: return r.status, {"raw": d[:200]}
    st, d = call("POST", "/api/collections/_superusers/auth-with-password", body={"identity": E.get("PB_SUPERUSER_EMAIL", "admin@real.test"), "password": E["PB_SUPERUSER_PASSWORD"]})
    if st != 200: sys.exit("no se pudo iniciar sesión como superusuario (¿está `clipserve` en marcha?)")
    return call, d["token"]

def clipdemo():
    call, su = _clipapi(); pesos = float(E.get("CLIP_TEST_AMOUNT") or "1"); cents = int(round(pesos * 100))
    em = f"clip{int(time.time())}@real.test"
    call("POST", "/api/collections/users/records", su, {"email": em, "password": "Passw0rd!!real", "passwordConfirm": "Passw0rd!!real", "verified": True})
    st, d = call("POST", "/api/collections/users/auth-with-password", body={"identity": em, "password": "Passw0rd!!real"}); tok = d["token"]
    opts = {"amount": cents, "description": "Prueba pbmini (modulo clip)", "subject": {"kind": "demo", "id": f"d{int(time.time())}"}, "urls": {"success": "/", "error": "/", "default": "/"}}
    st, d = call("POST", "/clip/raw", tok, {"opts": json.dumps(opts)})
    if st != 200: sys.exit(f"createPayment falló: {st} {red(json.dumps(d))[:300]}")
    print(f"pago creado: id={d['id']} referencia={d['reference']} estado={d['status']}")
    print(f"PAGA ESTE LINK (${pesos} reales): {d['url']}")
    print("vigilando hasta 10 minutos…", flush=True)
    last = None; end = time.time() + 600
    while time.time() < end:
        st, r = call("POST", "/clip/verify", tok, {"id": d["id"]}); sts = r.get("status")
        if sts != last: print(f"  {time.strftime('%H:%M:%S')} estado: {sts}", flush=True); last = sts
        if sts in ("paid", "failed", "expired", "review"): break
        time.sleep(4)
    st, r = call("GET", f"/api/collections/pbmini_clip_payments/records/{d['id']}", su)
    print("\nfila:", json.dumps({k: r.get(k) for k in ("status", "receipt_no", "amount", "currency", "paid_at", "closed_at", "note")}, ensure_ascii=False))
    if last == "paid": print(f"\nPara reembolsar (MUEVE DINERO; lo ejecutas tú):  python examples\\pbmini\\lab\\real.py cliprefund {d['id']} --confirm")

def clipstatus():
    call, su = _clipapi(); pid = sys.argv[2]
    st, r = call("GET", f"/api/collections/pbmini_clip_payments/records/{pid}", su)
    print(json.dumps({k: r.get(k) for k in ("id", "status", "receipt_no", "amount", "currency", "reference", "paid_at", "closed_at", "refund_id", "refund_receipt_no", "refunded_at", "note")}, ensure_ascii=False, indent=1))

def cliprefund():
    call, su = _clipapi(); pid = sys.argv[2]; confirm = "--confirm" in sys.argv
    st, r = call("GET", f"/api/collections/pbmini_clip_payments/records/{pid}", su)
    if st != 200: sys.exit(f"pago no encontrado: {st}")
    print(f"Reembolso TOTAL del pago {pid}: estado={r.get('status')} recibo={r.get('receipt_no')} monto={r.get('amount')} centavos")
    if not confirm: print("(simulacro: NO se pidió nada a Clip. Añade --confirm para reembolsar de verdad.)"); return
    st, d = call("POST", "/clip/op", su, {"op": "refund", "id": pid})
    print(f"respuesta {st}: {red(json.dumps(d, ensure_ascii=False))[:500]}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "serve": serve()
    elif cmd == "check": check("--send" in sys.argv)
    elif cmd == "clipserve": clipserve()
    elif cmd == "clipdemo": clipdemo()
    elif cmd == "clipstatus": clipstatus()
    elif cmd == "cliprefund": cliprefund()
    elif cmd == "demo": demo()
    elif cmd == "relay": relay()
    elif cmd == "selftest": selftest()
    else: print(__doc__)
