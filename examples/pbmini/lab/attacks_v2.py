"""Ronda 9: pruebas de las funcionalidades nuevas (esquemas reutilizables, paginación/filtros, transacciones, caché con etiquetas,
layouts y errores, i18n, cron, correo, acceso/membresías, sesiones, generador, tipos). Cada sección declara objetivo + meta.
`build(L, ctx, A)` devuelve los casos en vivo; `bad_pages()` los archivos que deben impedir el arranque (fail-closed)."""
import json, os, re, subprocess, urllib.parse, datetime, time, email, email.header, socketserver, threading

urllib_quote = lambda v: urllib.parse.quote(v, safe="")


class _SmtpHandler(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: (self.wfile.write((s + "\r\n").encode()), self.wfile.flush())
        w("220 sink ESMTP"); data_mode, buf, frm, rcpt = False, [], None, []
        while True:
            line = self.rfile.readline()
            if not line: return
            t = line.decode("utf-8", "replace").rstrip("\r\n")
            if data_mode:
                if t == ".":
                    self.server.messages.append({"from": frm, "to": list(rcpt), "data": "\n".join(buf)}); data_mode, buf = False, []; w("250 ok"); continue
                buf.append(t[1:] if t.startswith("..") else t); continue
            u = t.upper()
            if u.startswith(("EHLO", "HELO")): w("250-sink"); w("250 8BITMIME")
            elif u.startswith("MAIL FROM"): frm = t; w("250 ok")
            elif u.startswith("RCPT TO"): rcpt.append(t); w("250 ok")
            elif u == "DATA": data_mode = True; w("354 go")
            elif u.startswith("QUIT"): w("221 bye"); return
            else: w("250 ok")


class SmtpSink:
    """Servidor SMTP mínimo que captura mensajes (solo 127.0.0.1)."""
    def __init__(self):
        self.srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SmtpHandler); self.srv.daemon_threads = True; self.srv.messages = []
        self.port = self.srv.server_address[1]; threading.Thread(target=self.srv.serve_forever, daemon=True).start()
    @property
    def messages(self): return self.srv.messages
    def parse(self, m):
        msg = email.message_from_string(m["data"])
        dec = lambda v: "".join((p.decode(c or "utf-8", "replace") if isinstance(p, bytes) else p) for p, c in email.header.decode_header(v or ""))
        html = ""
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                pl = part.get_payload(decode=True); html = (pl or b"").decode(part.get_content_charset() or "utf-8", "replace")
        return {"from": dec(msg["From"]), "to": dec(msg["To"]), "subject": dec(msg["Subject"]), "html": html, "raw": m["data"]}


ok_page = 'module.exports = { auth: "public", get: (ctx) => ({}) };'
CFG_OK = 'module.exports = { access: { enabled: true, mode: "membership", roles: ["admin", "editor"], rolesField: "roles", permissions: { editor: ["posts.write"] }, planField: "plan", planOrder: ["free", "pro"] } };'
pg = lambda body: 'module.exports = { %s };' % body


def bad_pages():
    """(etiqueta, {ruta: contenido}) que deben abortar el arranque."""
    return [
        ("esquema reutilizable inexistente", {"x.js": pg('auth: "public", query: "nope", get: (ctx) => ({})')}),
        ("esquema reutilizable con ruta en el nombre (../)", {"x.js": pg('auth: "public", query: "../x", get: (ctx) => ({})'), "_schemas/a.js": 'module.exports = {};'}),
        ("esquema que exporta un arreglo", {"x.js": pg('auth: "public", query: "a", get: (ctx) => ({})'), "_schemas/a.js": 'module.exports = [];'}),
        ("esquema con tipo de campo desconocido", {"x.js": pg('auth: "public", query: "a", get: (ctx) => ({})'), "_schemas/a.js": 'module.exports = { n: "any" };'}),
        ("esquema con campo __proto__", {"x.js": pg('auth: "public", query: "a", get: (ctx) => ({})'), "_schemas/a.js": 'module.exports = JSON.parse(\'{"__proto__":"int"}\');'}),
        ("_schemas con archivo de nombre inválido (mayúsculas)", {"x.js": ok_page, "_schemas/Bad.js": 'module.exports = {};'}),
        ("_schemas con subcarpeta", {"x.js": ok_page, "_schemas/sub/a.js": 'module.exports = {};'}),
        ("_schemas con archivo que no es .js", {"x.js": ok_page, "_schemas/a.json": '{}'}),
        ("esquema en línea que no es un objeto (número)", {"x.js": pg('auth: "public", query: 5, get: (ctx) => ({})')}),
        ("access en una ruta con el módulo apagado (sin pbmini.config.js)", {"x.js": pg('auth: "user", access: { role: "admin" }, get: (ctx) => ({})')}),
        ("config: clave de primer nivel desconocida (typo acess)", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { acess: { enabled: true } };'}),
        ("config: exporta un arreglo", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = [];'}),
        ("config: access.mode inválido", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "magic", roles: ["a"] } };'}),
        ("config: access sin roles", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "role", field: "role" } };'}),
        ("config: access.roles con nombre inválido", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "role", field: "role", roles: ["Admin!"] } };'}),
        ("config: access en colección de sistema", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "role", collection: "_superusers", field: "role", roles: ["a"] } };'}),
        ("config: access.opción desconocida (typo)", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "role", field: "role", roles: ["a"], rol: "x" } };'}),
        ("config: modo role con opciones de membership", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "role", field: "role", roles: ["a"], planField: "plan" } };'}),
        ("config: permissions con un rol no declarado", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "membership", roles: ["a"], rolesField: "r", permissions: { b: ["x"] } } };'}),
        ("config: planOrder sin planField", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "membership", roles: ["a"], rolesField: "r", planOrder: ["free"] } };'}),
        ("config: grace fuera de rango", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "membership", roles: ["a"], rolesField: "r", planField: "p", planOrder: ["free"], grace: 999 } };'}),
        ("config: sessions.legacy inválido", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { sessions: { enabled: true, legacy: "maybe" } };'}),
        ("config: sessions en colección de sistema", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { sessions: { enabled: true, collection: "_superusers" } };'}),
        ("config: mail.maxPerHour cero", {"x.js": ok_page, "../pbmini.config.js": 'module.exports = { mail: { maxPerHour: 0 } };'}),
        ("access con auth public", {"x.js": pg('auth: "public", access: { role: "admin" }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access con rol no declarado", {"x.js": pg('auth: "user", access: { role: "ghost" }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access con permiso no declarado", {"x.js": pg('auth: "user", access: { permission: "nope.x" }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access con plan no declarado", {"x.js": pg('auth: "user", access: { plan: "gold" }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access con dos condiciones a la vez", {"x.js": pg('auth: "user", access: { role: "admin", plan: "pro" }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access con any vacío", {"x.js": pg('auth: "user", access: { any: [] }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access con anidamiento excesivo", {"x.js": pg('auth: "user", access: { any: [{ all: [{ any: [{ role: "admin" }] }] }] }, get: (ctx) => ({})'), "../pbmini.config.js": CFG_OK}),
        ("access en modo role con una condición de plan", {"x.js": pg('auth: "user", access: { plan: "pro" }, get: (ctx) => ({})'), "../pbmini.config.js": 'module.exports = { access: { enabled: true, mode: "role", field: "role", roles: ["admin"] } };'}),
        ("cron: id con mayúsculas", {"x.js": ok_page, "../cron/Bad.js": 'module.exports = { schedule: "* * * * *", run() {} };'}),
        ("cron: schedule inválido (4 campos)", {"x.js": ok_page, "../cron/a.js": 'module.exports = { schedule: "* * * *", run() {} };'}),
        ("cron: schedule con inyección", {"x.js": ok_page, "../cron/a.js": 'module.exports = { schedule: "* * * * *; rm -rf /", run() {} };'}),
        ("cron: schedule fuera de rango (PocketBase lo rechaza)", {"x.js": ok_page, "../cron/a.js": 'module.exports = { schedule: "61 25 * * *", run() {} };'}),
        ("cron: macro @reboot no soportado", {"x.js": ok_page, "../cron/a.js": 'module.exports = { schedule: "@reboot", run() {} };'}),
        ("cron: sin run", {"x.js": ok_page, "../cron/a.js": 'module.exports = { schedule: "* * * * *" };'}),
        ("cron: clave desconocida", {"x.js": ok_page, "../cron/a.js": 'module.exports = { schedule: "* * * * *", run() {}, retries: 3 };'}),
        ("cron: archivo que no es .js", {"x.js": ok_page, "../cron/a.sh": 'rm -rf /'}),
        ("cron: subcarpeta", {"x.js": ok_page, "../cron/sub/a.js": 'module.exports = { schedule: "* * * * *", run() {} };'}),
        ("mail: plantilla sin asunto", {"x.js": ok_page, "../mails/a.html": '<p>x</p>'}),
        ("mail: asunto de varias líneas", {"x.js": ok_page, "../mails/a.html": '<p>x</p>', "../mails/a.subject.txt": 'uno\ndos\n'}),
        ("mail: nombre con mayúsculas", {"x.js": ok_page, "../mails/Bad.html": '<p>x</p>', "../mails/Bad.subject.txt": 'x'}),
        ("mail: extensión no permitida", {"x.js": ok_page, "../mails/a.txt": 'x'}),
        ("mail: subcarpeta", {"x.js": ok_page, "../mails/sub/a.html": '<p>x</p>'}),
        ("consulta sobre la colección interna pbmini_sessions", {"x.js": pg('auth: "public", queries: { q: { collection: "pbmini_sessions", filter: "id != 1" } }, get: (ctx) => ({})')}),
        ("mutación sobre la colección interna pbmini_sessions", {"x.js": pg('auth: "user", mutations: { a: { collection: "pbmini_sessions", op: "delete" } }, post: (ctx) => ({})')}),
        ("layout anidado que extiende pero no declara su propio slot", {"_layout.html": '<!doctype html>{{block "body" .}}{{end}}', "a/_layout.html": '{{define "body"}}wrap{{end}}', "a/index.html": '<p>x</p>'}),
        ("i18n: idiomas con claves distintas", {"x.js": ok_page, "../i18n/en.json": '{"a":"x"}', "../i18n/es.json": '{"a":"x","b":"y"}'}),
        ("i18n: placeholders distintos entre idiomas", {"x.js": ok_page, "../i18n/en.json": '{"a":"hi {name}"}', "../i18n/es.json": '{"a":"hola"}'}),
        ("i18n: nombre de idioma inválido (Bad.json)", {"x.js": ok_page, "../i18n/Bad.json": '{"a":"x"}'}),
        ("i18n: nombre de idioma en_US con guion bajo", {"x.js": ok_page, "../i18n/en_US.json": '{"a":"x"}'}),
        ("i18n: JSON inválido", {"x.js": ok_page, "../i18n/en.json": '{"a": '}),
        ("i18n: la raíz es un arreglo", {"x.js": ok_page, "../i18n/en.json": '["a"]'}),
        ("i18n: valor que no es texto", {"x.js": ok_page, "../i18n/en.json": '{"a": 5}'}),
        ("i18n: valor enorme", {"x.js": ok_page, "../i18n/en.json": '{"a": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'}),
        ("i18n: clave __proto__", {"x.js": ok_page, "../i18n/en.json": '{"__proto__": "x"}'}),
        ("i18n: clave con espacios", {"x.js": ok_page, "../i18n/en.json": '{"a b": "x"}'}),
        ("i18n: archivo que no es .json", {"x.js": ok_page, "../i18n/en.json": '{"a":"x"}', "../i18n/notes.txt": 'hola'}),
        ("i18n: subcarpeta", {"x.js": ok_page, "../i18n/en.json": '{"a":"x"}', "../i18n/sub/es.json": '{"a":"x"}'}),
        ("paginate en un POST", {"x.js": pg('auth: "public", paginate: { perPage: 1, maxPerPage: 2 }, post: (ctx) => ({})')}),
        ("paginate con maxPerPage >= 100", {"x.js": pg('auth: "public", paginate: { perPage: 1, maxPerPage: 100 }, get: (ctx) => ({})')}),
        ("paginate con perPage > maxPerPage", {"x.js": pg('auth: "public", paginate: { perPage: 9, maxPerPage: 5 }, get: (ctx) => ({})')}),
        ("paginate con opción desconocida", {"x.js": pg('auth: "public", paginate: { perPage: 1, maxPerPage: 5, total: true }, get: (ctx) => ({})')}),
        ("paginate junto a una query `page` propia", {"x.js": pg('auth: "public", paginate: { perPage: 1, maxPerPage: 5 }, query: { page: "int" }, get: (ctx) => ({})')}),
        ("paginate con consulta de maxLimit insuficiente", {"x.js": pg('auth: "public", paginate: { perPage: 1, maxPerPage: 5 }, queries: { q: { collection: "posts", filter: "id != 1", maxLimit: 5 } }, get: (ctx) => ({})')}),
        ("filtro declarado sin {:v}", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "id != 1", filters: { a: "title = 1" } } }, get: (ctx) => ({})')}),
        ("filtro declarado con dos {:v}", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "id != 1", filters: { a: "title = {:v} || slug = {:v}" } } }, get: (ctx) => ({})')}),
        ("filtro declarado con otro placeholder", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "id != 1", filters: { a: "title = {:v} || slug = {:w}" } } }, get: (ctx) => ({})')}),
        ("filtro declarado con nombre __proto__", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "id != 1", filters: JSON.parse(`{"__proto__":"title = {:v}"}`) } }, get: (ctx) => ({})')}),
        ("mutations solo con get", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "create", fields: ["title"] } }, get: (ctx) => ({})')}),
        ("mutación sobre colección de sistema", {"x.js": pg('auth: "user", mutations: { a: { collection: "_superusers", op: "create", fields: ["title"] } }, post: (ctx) => ({})')}),
        ("mutación con op inválida", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "upsert", fields: ["title"] } }, post: (ctx) => ({})')}),
        ("mutación sin lista blanca de campos", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "create" } }, post: (ctx) => ({})')}),
        ("mutación con campo de contraseña/privilegio (password)", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "create", fields: ["password"] } }, post: (ctx) => ({})')}),
        ("mutación con campo id", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "update", fields: ["id"] } }, post: (ctx) => ({})')}),
        ("mutación delete con fields", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "delete", fields: ["title"] } }, post: (ctx) => ({})')}),
        ("mutación con opción desconocida", {"x.js": pg('auth: "user", mutations: { a: { collection: "todos", op: "create", fields: ["title"], skipRules: true } }, post: (ctx) => ({})')}),
        ("cache.tags sin cache.server", {"x.js": pg('auth: "public", cache: { maxAge: 10, tags: ["posts"] }, get: (ctx) => ({})')}),
        ("cache.tags con nombre inválido", {"x.js": pg('auth: "public", cache: { maxAge: 10, server: true, tags: ["../x"] }, get: (ctx) => ({})')}),
        ("opción de cache desconocida", {"x.js": pg('auth: "public", cache: { maxAge: 10, vary: "x" }, get: (ctx) => ({})')}),
    ]


def routes_table(ctx):
    """Ejecuta `pocketbase pbmini:routes` sobre el sandbox principal y devuelve la tabla de rutas (lista de dicts)."""
    root, exe = ctx["root"], ctx["exe"]
    env = dict(os.environ, PBMINI_PUBLIC_AUDIT="warn")
    r = subprocess.run([exe, "pbmini:routes", f"--dir={root}/pb_data_cli", f"--hooksDir={root}/pb_hooks", f"--publicDir={root}/pb_public"],
                       capture_output=True, text=True, env=env, cwd=root, timeout=90, encoding="utf-8", errors="replace")
    o = r.stdout; a = o.find("PBMINI_ROUTES_JSON_BEGIN"); b = o.find("PBMINI_ROUTES_JSON_END")
    if a < 0 or b < 0: raise RuntimeError(f"pbmini:routes sin salida (rc={r.returncode}): {(r.stderr or o)[-300:]}")
    return json.loads(o[a + len("PBMINI_ROUTES_JSON_BEGIN"):b])


def build(L, ctx, A):
    Case, raw, port = L.Case, L.raw, ctx["port"]
    cases, cnt = [], {}
    J = {"Content-Type": "application/json"}

    def add(p, cat, obj, meta, path=None, **kw):
        cnt[p] = cnt.get(p, 0) + 1; cases.append(Case(f"V{p}{cnt[p]:03d}", cat, obj, meta, path, **kw))

    # ============================================================ N. Esquemas reutilizables
    cat = "N · Esquemas reutilizables (pages/_schemas)"
    N = lambda obj, meta, path, **kw: add("N", cat, obj, meta, path, **kw)
    N("GET con esquema `paging` y valores por defecto", "page=1,size=10 (defaults del archivo)", "/schemas", st=200, has=['"page":1', '"size":10'])
    N("GET con valores válidos", "Se respetan", "/schemas?page=5&size=20", st=200, has=['"page":5', '"size":20'])
    for q in ("page=0", "page=101", "page=-1", "page=abc", "page=1.5", "page=1e2", "page=%201", "page=1&page=2", "size=51", "size=", "extra=1", "page=0x10", "page=%D9%A1"):
        N(f"GET con valor fuera del esquema: ?{q}", "400 (el esquema compartido se aplica igual que uno en línea)", f"/schemas?{q}", st=400)
    N("POST con cuerpo válido (esquema `note`)", "200 con defaults", "/schemas", m="POST", h=J, d='{"title":"hola"}', st=200, has=['"title":"hola"', '"level":"a"'])
    for label, body in (("campo no declarado (mass assignment)", '{"title":"x","admin":true}'), ("falta el campo requerido", '{}'), ("título de 51 caracteres", json.dumps({"title": "x" * 51})),
                        ("enum fuera de lista", '{"title":"x","level":"z"}'), ("tipo cruzado: título numérico", '{"title":5}'), ("clave __proto__", '{"title":"x","__proto__":{"a":1}}'),
                        ("raíz es un arreglo", '[{"title":"x"}]'), ("JSON con basura al final", '{"title":"x"} basura')):
        N(f"POST: {label}", "400", "/schemas", m="POST", h=J, d=body, st=400)

    def table_has_schema(_):
        t = routes_table(ctx)
        r = next((x for x in t if x["key"] == "GET /schemas"), None); p = next((x for x in t if x["key"] == "POST /schemas"), None)
        if not r or not p: return False, "la tabla de rutas no contiene /schemas"
        ok = r["query"].get("page", {}).get("max") == 100 and r["query"]["page"].get("default") == 1 and p["body"].get("title", {}).get("required") is True and p["body"]["level"].get("enum") == ["a", "b"]
        return ok, f"{len(t)} rutas; schemas: query={list(r['query'])}, body={list(p['body'])}"
    add("N", cat, "`pbmini:routes` refleja el esquema compartido", "La tabla de rutas (fuente del fuzzer guiado y de los tipos) coincide con el archivo", run=table_has_schema)

    def table_is_data(_):
        t = routes_table(ctx); s = json.dumps(t)
        bad = [k for k in ("TOKEN", "password", "hunter2", "DOTCANARY", "Sup3rS3cret") if k in s]
        return not bad and all("handler" not in r for r in t), f"{len(t)} rutas, solo metadatos" + (f"; FUGA {bad}" if bad else "")
    add("N", cat, "`pbmini:routes` solo expone metadatos", "Sin funciones, secretos ni contenido", run=table_is_data)

    # ============================================================ G. Paginación estándar y filtros declarados
    cat = "G · Paginación y filtros declarados"
    G = lambda obj, meta, path, **kw: add("G", cat, obj, meta, path, **kw)
    G("Página por defecto", "perPage=2, página 1, con items/hasMore", "/pg", st=200, has=['"perPage":2', '"page":1', '"items":[', '"hasMore":true'])
    G("perPage máximo permitido", "5 elementos", "/pg?perPage=5", st=200, has=['"perPage":5'])
    for q in ("perPage=6", "perPage=0", "perPage=-1", "perPage=1e1", "perPage=abc", "page=0", "page=1001", "page=-5", "page=1.0", "sort=secret", "sort=title,id", "sort=title;drop", "sort=-created", "sort=TITLE", "sort=",
              "slug=a&slug=b", "filter=id!=''", "where[slug]=x", "limit=1000", "offset=5", "perPage=2&perPage=3"):
        G(f"Parámetro fuera de contrato: ?{q}", "400 (nada llega a la consulta)", "/pg?" + q.replace("'", "%27"), st=400)

    def pages_walk(_):
        seen, bad = {}, []
        for per in (2, 5):
            for pgn in range(1, 8):
                r = raw(port, "GET", f"/pg?page={pgn}&perPage={per}")
                if r.status != 200: bad.append(f"p{pgn}/{per}→{r.status}"); continue
                if "TOPSECRET" in r.body or "private-draft" in r.body or '"secret"' in r.body or "S-X" in r.body: bad.append(f"FUGA p{pgn}/{per}")
                d = json.loads(r.body)
                if len(d["items"]) > per: bad.append(f"más de {per} items")
                for it in d["items"]: seen.setdefault(per, []).append(it["id"])
        for per, ids in seen.items():
            if len(ids) != len(set(ids)): bad.append(f"perPage={per}: elementos repetidos entre páginas")
        return not bad and len(set(seen.get(5, []))) == len(set(seen.get(2, []))) >= 8, "; ".join(bad) or f"{len(set(seen[2]))} registros recorridos sin repetir, sin borradores ni campos hidden"
    G("Recorrer todas las páginas con perPage=2 y 5", "Sin repetidos, sin salirse del tamaño, sin el borrador ni el campo secreto; ambos recorridos ven lo mismo", "/pg", run=pages_walk)

    def sort_check(_):
        a = json.loads(raw(port, "GET", "/pg?perPage=5&sort=title").body)["items"]; b = json.loads(raw(port, "GET", "/pg?perPage=5&sort=-title").body)["items"]
        ta, tb = [x["title"] for x in a], [x["title"] for x in b]
        return ta == sorted(ta) and tb == sorted(tb, reverse=True) and ta != tb, f"asc={ta[:2]} desc={tb[:2]}"
    G("Orden permitido (sort=title y sort=-title)", "Respeta la lista blanca y el sentido", "/pg", run=sort_check)

    def has_more(_):
        p1 = json.loads(raw(port, "GET", "/pg?perPage=5&page=1").body); p2 = json.loads(raw(port, "GET", "/pg?perPage=5&page=2").body); p9 = json.loads(raw(port, "GET", "/pg?perPage=5&page=9").body)
        return p1["hasMore"] is True and p2["hasMore"] is False and p9["items"] == [] and p9["hasMore"] is False, f"p1.hasMore={p1['hasMore']} p2.hasMore={p2['hasMore']} p9={len(p9['items'])} items"
    G("hasMore y página vacía", "hasMore refleja solo lo visible; una página lejana es vacía (200)", "/pg", run=has_more)
    G("Filtro declarado por slug", "Un solo resultado", "/pg?slug=hello", st=200, has=['"slug":"hello"'], hasnt=['"slug":"world"'])
    G("Filtro declarado inexistente en la base", "0 resultados", "/pg?slug=nada", st=200, has=['"items":[]'])
    G("Filtros combinados (slug + pub)", "AND de los fragmentos declarados", "/pg?slug=hello&pub=true", st=200, has=['"slug":"hello"'])
    G("Filtro pub=false sobre una consulta que ya exige published = true", "0 resultados (la consulta base no se relaja)", "/pg?pub=false", st=200, has=['"items":[]'], hasnt=["TOPSECRET"])
    for v in ("x' || 1=1 || '", "hello' || slug != '", "') || (1=1", "%", "_", "hello%00", "\\", "{:v}", "{{7*7}}", "*", "hello\" || \"1\"=\"1", "'; DROP TABLE posts; --", "hello ", "HELLO"):
        G(f"Inyección por el valor del filtro: slug={v[:24]!r}", "El valor va enlazado: 0 resultados (o el exacto) y nunca más filas ni 5xx", "/pg?slug=" + urllib_quote(v), st=200, hasnt=["TOPSECRET", '"slug":"world"', "S-2"])
    G("Código que pide un filtro no declarado", "Falla cerrado (500 genérico), sin ejecutar nada", "/pg/nofilter", st=500, hasnt=["posts", "Error", "stack"])

    # ============================================================ T. Escrituras declaradas y transacciones
    cat = "T · Escrituras declaradas y transacciones"
    T = lambda obj, meta, path, **kw: add("T", cat, obj, meta, path, **kw)
    HA = {"Authorization": ctx["TOKA"], **J}; HB = {"Authorization": ctx["TOKB"], **J}; HSU = {"Authorization": ctx["TOKSU"]}
    AID, BID = ctx["AID"], ctx["BID"]
    st = {}

    def su_list(filt):
        r = raw(port, "GET", "/api/collections/todos/records?perPage=200&filter=" + urllib_quote(filt), {"Authorization": ctx["TOKSU"]})
        return json.loads(r.body).get("items", []) if r.status == 200 else None

    def create_a(_):
        r = raw(port, "POST", "/todos", HA, '{"title":"t1"}'); d = json.loads(r.body) if r.status == 200 else {}
        st["a_todo"] = d.get("id")
        return r.status == 200 and d.get("owner") == AID and d.get("title") == "t1", f"HTTP {r.status}; owner={d.get('owner')}"
    add("T", cat, "Crear con ctx.create (el dueño lo pone el servidor)", "200; owner = id del usuario autenticado", run=create_a)

    def create_b_and_visibility(_):
        r = raw(port, "POST", "/todos", HB, '{"title":"b1"}'); st["b_todo"] = json.loads(r.body).get("id") if r.status == 200 else None
        la = json.loads(raw(port, "GET", "/todos", HA).body); lb = json.loads(raw(port, "GET", "/todos", HB).body)
        ta, tb = [x["title"] for x in la], [x["title"] for x in lb]
        return "t1" in ta and "b1" not in ta and "b1" in tb and "t1" not in tb, f"A ve {ta}; B ve {tb}"
    add("T", cat, "Cada usuario solo ve lo suyo (reglas de PocketBase sobre lo creado)", "A no ve lo de B y viceversa", run=create_b_and_visibility)
    T("Anónimo no puede crear", "401", "/todos", m="POST", h=J, d='{"title":"x"}', st=401)
    T("Mass assignment: intentar fijar el dueño desde el cuerpo", "400 (el cuerpo no declara `owner`)", "/todos", m="POST", h=HA, d=json.dumps({"title": "x", "owner": BID}), st=400)
    T("Cuerpo con tipo cruzado (done como cadena)", "400", "/todos", m="POST", h=HA, d='{"title":"x","done":"true"}', st=400)

    def anon_create(_):
        before = su_list("title = 'anon'"); r = raw(port, "POST", "/todos/anon", J, "{}"); after = su_list("title = 'anon'")
        return r.status == 403 and before == [] and after == [], f"HTTP {r.status}; filas anon={len(after or [])}"
    add("T", cat, "Ruta pública que intenta crear (la regla de creación exige sesión)", "403 y nada guardado", run=anon_create)

    def get_mutation(_):
        r = raw(port, "GET", "/todos/getmut", {"Authorization": ctx["TOKA"]}); rows = su_list("title = 'from-get'")
        return r.status == 500 and rows == [], f"HTTP {r.status}; filas from-get={len(rows or [])}"
    add("T", cat, "Escritura desde un GET (CSRF)", "Prohibida: 500 fail-closed y nada guardado", run=get_mutation)

    def update_own_and_foreign(_):
        a = st.get("a_todo"); b = st.get("b_todo")
        r1 = raw(port, "PATCH", f"/todos/{a}/done", HA, '{"done":true}')
        r2 = raw(port, "PATCH", f"/todos/{a}/done", HB, '{"done":false}')       # B sobre el de A
        r3 = raw(port, "PATCH", f"/todos/{'zzzzzzzzzzzzzzz'}/done", HA, '{"done":true}')
        r4 = raw(port, "PATCH", "/todos/x/done", HA, '{"done":true}')
        row = su_list(f"id = '{a}'")
        return (r1.status == 200 and r2.status == 404 and r3.status == 404 and r4.status == 404 and row and row[0]["done"] is True), f"propio→{r1.status}, ajeno→{r2.status} (404 oculta la existencia), inexistente→{r3.status}, id mal formado→{r4.status}"
    add("T", cat, "Actualizar lo propio, lo ajeno, lo inexistente y un id malformado", "200 / 404 / 404 / 404 (nunca revela si existe)", run=update_own_and_foreign)

    def steal(_):
        a = st.get("a_todo"); r = raw(port, "PATCH", f"/todos/{a}/steal", HB, json.dumps({"owner": BID})); row = su_list(f"id = '{a}'")
        return r.status == 404 and row and row[0]["owner"] == AID, f"HTTP {r.status}; owner={row[0]['owner'] if row else '?'}"
    add("T", cat, "Robo de propiedad: B fija owner=B en un registro de A", "La regla se evalúa contra el registro EXISTENTE: 404 y el dueño no cambia", run=steal)

    def undeclared(_):
        a = st.get("a_todo"); r = raw(port, "PATCH", f"/todos/{a}/undeclared", HA, '{"done":false}'); row = su_list(f"id = '{a}'")
        return r.status == 500 and row and row[0]["done"] is True, f"HTTP {r.status}; done={row[0]['done'] if row else '?'}"
    add("T", cat, "Mutación con un campo fuera de la lista blanca", "Rechazada (500 fail-closed) y el registro no cambia", run=undeclared)

    def batch(mode, expect, created):
        def f(_):
            before = len(su_list("title ~ 'batch-'") or [])
            r = raw(port, "POST", "/todos/batch", HA, json.dumps({"mode": mode})); after = len(su_list("title ~ 'batch-'") or [])
            d = json.loads(r.body) if r.status == 200 else {}
            ok = r.status == expect and (after - before) == created and (mode != "ok" or d.get("seen", 0) >= 2)
            return ok, f"HTTP {r.status}; filas batch +{after - before} (esperado {created})" + (f"; la transacción ve {d.get('seen')}" if mode == "ok" else "")
        return f
    add("T", cat, "Transacción correcta (dos altas)", "200; ambas existen y dentro de la transacción se ven", run=batch("ok", 200, 2))
    add("T", cat, "Transacción con excepción tras dos altas", "Reversión total (0 filas nuevas) y 500 genérico", run=batch("boom", 500, 0))
    add("T", cat, "Transacción con campo fuera de la lista blanca en el segundo paso", "Reversión total y 500", run=batch("badfield", 500, 0))
    add("T", cat, "Transacción donde la regla de creación rechaza un paso (dueño ajeno)", "Reversión total y 403", run=batch("foreign", 403, 0))

    def remove(_):
        a = st.get("a_todo"); r1 = raw(port, "DELETE", f"/todos/{a}/remove", HB); still = su_list(f"id = '{a}'"); r2 = raw(port, "DELETE", f"/todos/{a}/remove", HA); gone = su_list(f"id = '{a}'")
        return r1.status == 404 and len(still or []) == 1 and r2.status == 200 and gone == [], f"B→{r1.status} (sigue existiendo), A→{r2.status}, después: {len(gone or [])} filas"
    add("T", cat, "Borrar lo ajeno y lo propio", "404 sin borrar / 200 y desaparece", run=remove)
    T("CSRF: escritura con cookie desde otro sitio", "401", "/todos", m="POST", h={**J, "Cookie": L.cookie(ctx["TOKA"]), "Sec-Fetch-Site": "cross-site"}, d='{"title":"csrf"}', st=401)
    T("Cuerpo JSON con claves duplicadas __proto__/constructor", "400", "/todos", m="POST", h=HA, d='{"title":"x","constructor":{"prototype":{"owner":"x"}}}', st=400)

    # ============================================================ K. Caché de servidor con etiquetas
    cat = "K · Invalidación de caché por etiquetas"
    def hits(path):
        r = raw(port, "GET", path); return json.loads(r.body) if r.status == 200 else None
    def tags_flow(_):
        bad = []; su = ctx["TOKSU"]
        h1 = hits("/tagged"); h2 = hits("/tagged")
        if not h1 or h1["hits"] != h2["hits"]: bad.append(f"sin caché ({h1} / {h2})")
        u1 = hits("/untagged")
        new = L.api(port, "POST", "/api/collections/posts/records", dict(title="cache-new", slug="cache-new", secret="S-C", published=True), su)
        h3 = hits("/tagged")
        if h3["hits"] == h2["hits"] or h3["n"] != h2["n"] + 1: bad.append(f"crear no invalidó ({h2}→{h3})")
        L.api(port, "PATCH", f"/api/collections/posts/records/{new['id']}", dict(title="cache-new2"), su)
        h4 = hits("/tagged")
        if h4["hits"] == h3["hits"]: bad.append("actualizar no invalidó")
        h4b = hits("/tagged")
        if h4b["hits"] != h4["hits"]: bad.append("no volvió a cachear tras invalidar")
        L.api(port, "DELETE", f"/api/collections/posts/records/{new['id']}", None, su)
        h5 = hits("/tagged")
        if h5["hits"] == h4["hits"] or h5["n"] != h2["n"]: bad.append(f"borrar no invalidó ({h4}→{h5})")
        L.api(port, "POST", "/api/collections/vault/records", dict(note="otra colección"), su)
        h6 = hits("/tagged")
        if h6["hits"] != h5["hits"]: bad.append("una colección ajena invalidó la caché")
        u2 = hits("/untagged")
        if u2["hits"] != u1["hits"]: bad.append("la ruta sin etiquetas se invalidó")
        return not bad, "; ".join(bad) or "crear/actualizar/borrar invalidan; otra colección y la ruta sin etiquetas no"
    add("K", cat, "Cambios en la colección etiquetada (API nativa) invalidan la caché; otras colecciones no", "La respuesta nunca queda obsoleta tras crear/actualizar/borrar", run=tags_flow)

    def tags_via_mutation(_):
        h1 = hits("/tagged")
        r = raw(port, "POST", "/todos", HA, '{"title":"nocache"}')
        h2 = hits("/tagged")
        return r.status == 200 and h1["hits"] == h2["hits"], f"una colección sin etiqueta (todos) no invalida: {h1['hits']}→{h2['hits']}"
    def badtag(_):
        a = hits("/badtag"); b = hits("/badtag")
        return a and b and b["hits"] == a["hits"] + 1, f"hits {a and a['hits']}→{b and b['hits']} (sin caché porque la etiqueta no existe)"
    add("K", cat, "Etiqueta de una colección inexistente (typo)", "Falla hacia «sin caché»: nunca sirve datos que no se podrían invalidar", run=badtag)
    add("K", cat, "Una escritura vía ctx.create en otra colección no toca la caché", "Sin invalidaciones espurias", run=tags_via_mutation)

    # ============================================================ L. Layouts anidados
    cat = "L · Layouts anidados"
    L_ = lambda obj, meta, path, **kw: add("L", cat, obj, meta, path, **kw)
    HTML = {"Accept": "text/html"}

    def ordered(path, marks, extra_has=(), extra_hasnt=()):
        def f(_):
            r = raw(port, "GET", path, HTML)
            if r.status != 200: return False, f"HTTP {r.status}"
            pos = [r.body.find(m) for m in marks]
            bad = [m for m, p in zip(marks, pos) if p < 0] + [f"{a} después de {b}" for (a, pa), (b, pb) in zip(zip(marks, pos), list(zip(marks, pos))[1:]) if pa >= 0 and pb >= 0 and pa > pb]
            bad += [f"falta {x}" for x in extra_has if x not in r.body] + [f"sobra {x}" for x in extra_hasnt if x in r.body]
            return not bad, "; ".join(bad) or "orden correcto: " + " < ".join(marks)
        return f
    add("L", cat, "Layout de un nivel que extiende al raíz", "ROOT-LAYOUT envuelve L1 que envuelve la página", run=ordered("/lay", ["ROOT-LAYOUT", "NAV-PARTIAL", "L1-START", "LAY-PAGE", "L1-END"]))
    add("L", cat, "Dos niveles anidados (raíz > L1 > L2 > página)", "Cada nivel envuelve al siguiente, en orden", run=ordered("/lay/deep", ["ROOT-LAYOUT", "L1-START", "L2-START", "DEEP-PAGE", "L2-END", "L1-END"]))
    add("L", cat, "Página con {{define}} bajo layouts anidados", "Sus bloques (title, inner2) se aplican a cada nivel", run=ordered("/lay/deep/defs", ["ROOT-LAYOUT", "L1-START", "L2-START", "DEFS-PAGE", "L2-END", "L1-END"], extra_has=["<title>Deep Title</title>"]))
    L_("Layout que NO extiende (usa block) sigue reemplazando al raíz", "Compatibilidad: REPL-LAYOUT sin ROOT-LAYOUT", "/lay/replace", st=200, has=["REPL-LAYOUT", "REPL-PAGE"], hasnt=["ROOT-LAYOUT", "L1-START"])
    L_("Los datos de la página llegan a todos los niveles", "El título aparece en L1, L2 y la página", "/lay/deep?t=ZZTOP", st=200, has=["L1-START ZZTOP", "L2-START ZZTOP", "DEEP-PAGE ZZTOP"])
    for i, pay in enumerate(("<script>alert(1)</script>", "\"><img src=x onerror=alert(1)>", "'-alert(1)-'", "{{7*7}}", "{{define \"x\"}}", "</section><script>x()</script>", "javascript:alert(1)", "&lt;b&gt;", "<svg/onload=alert(1)>", "`${7*7}`")):
        def xss(path, pay=pay):
            def f(_):
                r = raw(port, "GET", path + urllib_quote(pay), HTML)
                d = A.html_danger(r.body)
                return r.status == 200 and not d and "49" not in r.body.replace("1.49", ""), f"HTTP {r.status}; peligros={d or 'ninguno'}"
            return f
        add("L", cat, f"XSS en datos que cruzan 2 layouts: {pay[:28]!r}", "Autoescape en todos los niveles: sin etiquetas activas ni evaluación de plantilla", run=xss("/lay/deep?t="))

    # ============================================================ E. Páginas de error
    cat = "E · Páginas de error (_error.html)"
    E = lambda obj, meta, path, **kw: add("E", cat, obj, meta, path, **kw)
    E("400 en una ruta con HTML y Accept: text/html", "Página de error de la raíz (ERR-PAGE 400), no JSON", "/lay?bad=1", h=HTML, st=400, has=["ERR-PAGE 400", "Bad Request"], hdr=[r"content-type: text/html", r"cache-control: no-store", r"x-content-type-options: nosniff", r"content-security-policy"])
    E("400 con Accept: application/json", "JSON clásico", "/lay?bad=1", h={"Accept": "application/json"}, st=400, has=['"error":"invalid query"'], hasnt=["ERR-PAGE"])
    E("400 sin cabecera Accept", "JSON clásico", "/lay?bad=1", st=400, has=['"error":"invalid query"'], hasnt=["ERR-PAGE"])
    E("Accept de navegador completo", "HTML", "/lay?bad=1", h={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}, st=400, has=["ERR-PAGE 400"])
    E("Accept */*", "JSON", "/lay?bad=1", h={"Accept": "*/*"}, st=400, has=['"error"'], hasnt=["ERR-PAGE"])
    E("Accept: text/html;q=0 (rechazado por el cliente)", "JSON", "/lay?bad=1", h={"Accept": "text/html;q=0"}, st=400, hasnt=["ERR-PAGE"])
    E("Accept hostil muy largo", "Sin error de servidor", "/lay?bad=1", h={"Accept": "text/html," * 2000}, st=(400, 431))
    E("Valor de la query NO se refleja en la página de error", "El HTML de error contiene solo Status y Reason", "/lay?bad=%3Cscript%3Ealert(1)%3C/script%3E", h=HTML, st=400, has=["ERR-PAGE 400"], hasnt=["<script", "alert(1)"])
    E("404 por parámetro inválido en una ruta con HTML", "ERR-PAGE 404", "/blog/Bad_Slug", h=HTML, st=404, has=["ERR-PAGE 404", "Not Found"])
    E("500 en una ruta con _error.html propio (el más cercano manda)", "SUBERR 500 sin detalle del error", "/err?x=true", h=HTML, st=500, has=["SUBERR 500"], hasnt=["hunter2", "db password", "ERR-PAGE", "Error:"])
    E("500 con Accept JSON", "JSON genérico", "/err?x=true", st=500, has=['"error":"internal error"'], hasnt=["hunter2", "SUBERR"])
    E("400 en la carpeta con _error.html propio", "SUBERR 400", "/err?x=nope", h=HTML, st=400, has=["SUBERR 400"], hasnt=["ERR-PAGE"])
    E("Un endpoint (.js sin .html) pide HTML y recibe JSON", "Los endpoints nunca renderizan páginas", "/boom", h=HTML, st=500, has=['"error":"internal error"'], hasnt=["ERR-PAGE", "hunter2"])
    E("404 nativo (URL inexistente) con Accept: text/html", "Usa pages/_error.html raíz y cabeceras de seguridad", "/no-existe-xyz", h=HTML, st=404, has=["ERR-PAGE 404", "Not Found"], hdr=[r"content-type: text/html", r"cache-control: no-store", r"content-security-policy"])
    E("404 nativo con Accept JSON", "JSON nativo de PocketBase", "/no-existe-xyz", st=404, has=['"status":404'], hasnt=["ERR-PAGE"])
    E("404 nativo: la ruta pedida no se refleja", "Sin eco de la URL", "/%3Cscript%3Ealert(1)%3C/script%3E", h=HTML, st=404, hasnt=["<script", "alert(1)"])
    E("Archivo público existente no se ve afectado", "200", "/pub.txt", h=HTML, st=200, has=["pub"], hasnt=["ERR-PAGE"])
    E("Página de error con cookie/credenciales no se cachea", "no-store", "/lay?bad=1", h={**HTML, "Authorization": ctx["TOKA"]}, st=400, hdr=[r"cache-control: no-store"])

    # ============================================================ I. i18n
    cat = "I · Internacionalización"
    I = lambda obj, meta, path, **kw: add("I", cat, obj, meta, path, **kw)
    def loc(al=None, q=""):
        def f(_):
            r = raw(port, "GET", "/tr" + q, {"Accept-Language": al} if al is not None else {})
            try: d = json.loads(r.body)
            except Exception: return False, f"HTTP {r.status} {r.body[:80]!r}"
            return r.status == 200, d
        return f
    def expect_locale(label, al, want, q=""):
        def f(_):
            ok, d = loc(al, q)(None)
            return (ok is True and d["locale"] == want), (f"locale={d['locale']} («{d['greeting']}»)" if ok is True else str(d))
        add("I", cat, label, f"Idioma elegido = {want}", run=f)
    expect_locale("Sin Accept-Language", None, "en")
    expect_locale("Accept-Language: es", "es", "es")
    expect_locale("Accept-Language: es-MX,es;q=0.9,en;q=0.8", "es-MX,es;q=0.9,en;q=0.8", "es")
    expect_locale("Accept-Language: en-US,en;q=0.9", "en-US,en;q=0.9", "en")
    expect_locale("Idioma no soportado (fr)", "fr-FR,fr;q=0.9", "en")
    expect_locale("Prioridad por q: en;q=0.5, es;q=0.9", "en;q=0.5, es;q=0.9", "es")
    expect_locale("q=0 excluye el idioma", "es;q=0, en", "en")
    expect_locale("Comodín *", "*", "en")
    expect_locale("Mayúsculas ES", "ES", "es")
    for label, al in (("4000 caracteres", "es," * 1500), ("100 entradas", ",".join(f"x{i};q=0.{i % 10}" for i in range(100))), ("traversal ../../etc/passwd", "../../etc/passwd"), ("__proto__", "__proto__"), ("constructor", "constructor"),
                      ("q fuera de rango en;q=999", "en;q=999"), ("q=NaN", "es;q=NaN"), ("solo puntos y comas", ";;;,,,"), ("byte nulo", "es\x00"), ("espacios y tabuladores", " \t es \t ; \t q=0.5 "), ("es_ES con guion bajo", "es_ES"),
                      ("etiqueta de 40 caracteres", "a" * 40), ("unicode", "ñandú"), ("es;q=1;q=0", "es;q=1;q=0"), ("inyección de cabecera", "es\r\nSet-Cookie: x=1")):
        def hostile(al=al):
            def f(_):
                try: r = raw(port, "GET", "/tr", {"Accept-Language": al})
                except Exception as e: return True, f"el cliente HTTP rechazó la cabecera ({type(e).__name__}); nunca llegó al servidor"
                if r.status == 0: return True, "el cliente HTTP rechazó la cabecera; nunca llegó al servidor"
                if r.status in (400, 431): return True, f"HTTP {r.status}"
                try: d = json.loads(r.body)
                except Exception: return False, f"HTTP {r.status}"
                return r.status == 200 and d["locale"] in ("en", "es") and "Set-Cookie" not in "".join(r.hdrlines), f"HTTP {r.status}, locale={d['locale']}"
            return f
        add("I", cat, f"Accept-Language hostil: {label}", "Idioma válido (o rechazo) y nunca error de servidor", run=hostile())
    I("Clave inexistente", "Devuelve la clave (visible), sin error", "/tr", h={"Accept-Language": "es"}, st=200, has=['"missing":"no_such_key"'])
    for v in ("{name}", "{greeting}", "$&", "$1$2", "{{7*7}}", "<script>alert(1)</script>", "\\n", "{", "}", "{}"):
        def interp(v=v):
            def f(_):
                r = raw(port, "GET", "/tr?name=" + urllib_quote(v), {"Accept-Language": "en"}); d = json.loads(r.body) if r.status == 200 else {}
                return r.status == 200 and d.get("greeting") == f"Hello, {v}!" and d.get("price") == "Price: 5 $&", f"greeting={d.get('greeting')!r}"
            return f
        add("I", cat, f"Interpolación literal con valor {v[:20]!r}", "El valor se inserta tal cual: sin sustitución recursiva ni patrones $&", run=interp())
    def html_page(_):
        r = raw(port, "GET", "/trh?name=" + urllib_quote("<script>alert(1)</script>"), {"Accept-Language": "es", "Accept": "text/html"}); d = A.html_danger(r.body)
        return r.status == 200 and "<h1>Hola mundo</h1>" in r.body and "<i>es</i>" in r.body and not d and "&lt;script&gt;" in r.body, f"HTTP {r.status}; peligros={d or 'ninguno'}"
    add("I", cat, "Plantilla HTML con {{.T.clave}} y valor hostil", "Texto traducido + autoescape; sin etiquetas activas", run=html_page)
    I("Parámetro ?lang= no existe", "400 (el idioma solo sale de Accept-Language)", "/tr?lang=es", st=400)
    I("Los archivos de traducción no son rutas", "404", "/i18n/es.json", st=404)

    def cache_i18n(_):
        bad = []
        r1 = raw(port, "GET", "/trc", {"Accept-Language": "es"}); r2 = raw(port, "GET", "/trc", {"Accept-Language": "en"}); r3 = raw(port, "GET", "/trc", {"Accept-Language": "es"}); r4 = raw(port, "GET", "/trc", {"Accept-Language": "en"})
        try: d1, d2, d3, d4 = (json.loads(r.body) for r in (r1, r2, r3, r4))
        except Exception: return False, "respuestas no JSON"
        if d1["locale"] != "es" or d1["title"] != "Hola mundo": bad.append("es mal")
        if d2["locale"] != "en" or d2["title"] != "Hello world": bad.append(f"ENVENENAMIENTO: en recibió {d2['locale']}/{d2['title']}")
        if d3["hits"] != d1["hits"] or d4["hits"] != d2["hits"]: bad.append("no se cacheó por idioma")
        if d1["hits"] == d2["hits"]: bad.append("los dos idiomas comparten entrada")
        if "accept-language" not in (r1.header("vary") or "").lower(): bad.append("falta Vary: Accept-Language")
        return not bad, "; ".join(bad) or "caché separada por idioma con Vary: Accept-Language"
    add("I", cat, "Caché de servidor con dos idiomas", "Cada idioma su entrada; nunca se sirve el idioma equivocado (envenenamiento)", run=cache_i18n)

    # ============================================================ helpers de la fase D
    SU = {"Authorization": ctx["TOKSU"]}
    cnt_users = [0]

    def mkuser(port_=None, su=None, **fields):
        """Crea un usuario con los campos dados (como superusuario) y devuelve (id, token)."""
        p_, su_ = port_ or port, su or ctx["TOKSU"]
        cnt_users[0] += 1; email = f"v{cnt_users[0]}_{os.getpid()}@lab.test"
        rec = L.api(p_, "POST", "/api/collections/users/records", dict(email=email, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True, **fields), su_)
        tok = L.api(p_, "POST", "/api/collections/users/auth-with-password", dict(identity=email, password="Passw0rd!!"))["token"]
        return rec["id"], tok

    def days(n): return (datetime.datetime.utcnow() + datetime.timedelta(days=n)).strftime("%Y-%m-%d %H:%M:%S.000Z")

    # ============================================================ A. Acceso por roles / membresías (modo membership)
    cat = "A · Acceso: roles, permisos y membresías"
    users = {}
    def setup_users(_):
        users["free"] = mkuser(plan="free")
        users["ed"] = mkuser(roles=["editor"], plan="free")
        users["pro"] = mkuser(plan="pro", plan_expires=days(30))
        users["pro_exp"] = mkuser(plan="pro", plan_expires=days(-10))
        users["pro_grace"] = mkuser(plan="pro", plan_expires=days(-1))
        users["pro_noexp"] = mkuser(plan="pro")
        users["team"] = mkuser(plan="team", plan_expires=days(30))
        users["admin"] = mkuser(roles=["admin"], plan="free")
        users["edpro"] = mkuser(roles=["editor"], plan="pro", plan_expires=days(30))
        users["perm"] = mkuser(perms="billing.view", plan="free")
        users["susp"] = mkuser(roles=["admin"], plan="team", plan_expires=days(30), status="suspended")
        users["gold"] = mkuser(plan="gold")
        users["ghost"] = mkuser(roles=["ghost"], plan="free")
        users["permstar"] = mkuser(perms="*, ../x, <script>, posts.write2", plan="free")
        users["permw"] = mkuser(perms="posts.write", plan="free")
        return True, f"{len(users)} usuarios de prueba creados (planes, roles, vencidos, suspendido, valores hostiles)"
    add("A", cat, "Preparación: usuarios con distintos planes, roles y estados", "Usuarios listos", run=setup_users)

    def matrix(path, want, label):
        """want: {usuario: (status, code|None)}; 'anon' sin credenciales, 'su' superusuario."""
        def f(_):
            bad = []
            for u, (st_, code) in want.items():
                h = {} if u == "anon" else ({"Authorization": ctx["TOKSU"]} if u == "su" else {"Authorization": users[u][1]})
                r = raw(port, "GET", path, h)
                got_code = None
                try: got_code = json.loads(r.body).get("code")
                except Exception: pass
                if r.status != st_ or (code and got_code != code): bad.append(f"{u}→{r.status}/{got_code} (esperado {st_}/{code})")
            return not bad, "; ".join(bad) or f"{len(want)} usuarios con el resultado esperado"
        add("A", cat, label, "Cada usuario recibe exactamente el estado y código esperados", path, run=f)
    matrix("/acc/editor", {"ed": (200, None), "edpro": (200, None), "free": (403, "forbidden"), "admin": (403, "forbidden"), "pro": (403, "forbidden"), "susp": (403, "account_blocked"), "ghost": (403, "forbidden"), "anon": (401, None), "su": (200, None)}, "Ruta con {role:'editor'}")
    matrix("/acc/pro", {"free": (402, "plan_required"), "pro": (200, None), "pro_grace": (200, None), "pro_exp": (402, "membership_expired"), "pro_noexp": (402, "membership_expired"), "team": (200, None), "gold": (402, "plan_required"), "susp": (403, "account_blocked"), "ghost": (402, "plan_required"), "anon": (401, None), "su": (200, None)}, "Ruta con {plan:'pro'} (jerarquía, gracia, vencidos, sin fecha, plan desconocido)")
    matrix("/acc/team", {"pro": (402, "plan_required"), "team": (200, None), "free": (402, "plan_required"), "pro_exp": (402, "membership_expired")}, "Ruta con {plan:'team'}")
    matrix("/acc/write", {"ed": (200, None), "admin": (200, None), "free": (403, "forbidden"), "permw": (200, None), "permstar": (403, "forbidden"), "perm": (403, "forbidden"), "susp": (403, "account_blocked")}, "Ruta con {permission:'posts.write'} (rol, comodín *, permiso individual, valores hostiles)")
    matrix("/acc/billing", {"admin": (200, None), "perm": (200, None), "ed": (403, "forbidden"), "free": (403, "forbidden")}, "Ruta con {permission:'billing.view'} (permiso extra)")
    matrix("/acc/any", {"admin": (200, None), "pro": (200, None), "ed": (402, "plan_required"), "free": (402, "plan_required"), "ghost": (402, "plan_required")}, "Ruta con {any:[role admin, plan pro]}")
    matrix("/acc/all", {"edpro": (200, None), "ed": (402, "plan_required"), "pro": (403, "forbidden"), "admin": (403, "forbidden")}, "Ruta con {all:[role editor, plan pro]}")

    def open_info(_):
        r = raw(port, "GET", "/acc/open", {"Authorization": users["edpro"][1]}); d = json.loads(r.body)
        m = d["m"]
        ok = r.status == 200 and d["can"] is True and d["editor"] is True and m["plan"] == "pro" and m["roles"] == ["editor"] and "posts.write" in m["permissions"] and m["expired"] is False
        r2 = raw(port, "GET", "/acc/open", {"Authorization": users["pro_exp"][1]}); m2 = json.loads(r2.body)["m"]
        return ok and m2["plan"] == "free" and m2["expired"] is True, f"edpro={m['plan']}/{m['roles']}; vencido→plan {m2['plan']} expired={m2['expired']}"
    add("A", cat, "ctx.can / ctx.hasRole / ctx.membership() en una ruta sin `access`", "Reflejan rol, permisos, plan efectivo y vencimiento", "/acc/open", run=open_info)

    def cookie_path(_):
        r = raw(port, "GET", "/acc/pro", {"Cookie": L.cookie(users["pro"][1])}); r2 = raw(port, "GET", "/acc/pro", {"Cookie": L.cookie(users["free"][1])})
        return r.status == 200 and r2.status == 402, f"cookie pro→{r.status}, cookie free→{r2.status}"
    add("A", cat, "El control de acceso también se aplica con la cookie de sesión", "200 / 402", "/acc/pro", run=cookie_path)

    def live_change(_):  # el plan se lee del registro en cada petición (sin caché obsoleta)
        uid, tok = mkuser(plan="free")
        a = raw(port, "GET", "/acc/pro", {"Authorization": tok}).status
        L.api(port, "PATCH", f"/api/collections/users/records/{uid}", dict(plan="pro", plan_expires=days(5)), ctx["TOKSU"])
        b = raw(port, "GET", "/acc/pro", {"Authorization": tok}).status
        L.api(port, "PATCH", f"/api/collections/users/records/{uid}", dict(plan_expires=days(-30)), ctx["TOKSU"])
        c = raw(port, "GET", "/acc/pro", {"Authorization": tok}).status
        return (a, b, c) == (402, 200, 402), f"free→{a}, tras subir a pro→{b}, tras vencer→{c}"
    add("A", cat, "Cambiar el plan en la base surte efecto en la siguiente petición", "402 → 200 → 402 sin reiniciar ni caché", "/acc/pro", run=live_change)
    add("A", cat, "Una ruta de acceso no es cacheable ni pública", "no-store", "/acc/pro", h={"Authorization": ctx["TOKA"]}, st=402, hdr=[r"cache-control: no-store"])

    # ============================================================ C. Tareas programadas
    cat = "C · Tareas programadas (cron/)"
    def cron_flow(_):
        bad = []
        r = raw(port, "GET", "/api/crons", SU)
        jobs = {j["id"]: j["expression"] for j in json.loads(r.body)} if r.status == 200 else {}
        if jobs.get("pbmini_ticker") != "*/5 * * * *": bad.append(f"ticker no registrado ({jobs.get('pbmini_ticker')})")
        if "pbmini_sessions_gc" not in jobs: bad.append("falta pbmini_sessions_gc")
        n0 = json.loads(raw(port, "GET", "/cronstat").body)["n"]
        r1 = raw(port, "POST", "/api/crons/pbmini_ticker", SU); r2 = raw(port, "POST", "/api/crons/pbmini_ticker", SU)
        n2 = json.loads(raw(port, "GET", "/cronstat").body)["n"]
        if (r1.status, r2.status) != (204, 204) or n2 != n0 + 2: bad.append(f"ejecución manual: {r1.status}/{r2.status}, contador {n0}→{n2}")
        return not bad, "; ".join(bad) or f"ticker registrado ('*/5 * * * *') y ejecutado 2 veces ({n0}→{n2})"
    add("C", cat, "La tarea cron/ticker.js se registra y se ejecuta a demanda", "Aparece en /api/crons y su efecto es visible", run=cron_flow)

    def cron_perm(_):
        n0 = json.loads(raw(port, "GET", "/cronstat").body)["n"]
        a = raw(port, "POST", "/api/crons/pbmini_ticker").status; b = raw(port, "POST", "/api/crons/pbmini_ticker", {"Authorization": ctx["TOKA"]}).status
        n1 = json.loads(raw(port, "GET", "/cronstat").body)["n"]
        return a in (401, 403) and b in (401, 403) and n0 == n1, f"anónimo→{a}, usuario→{b}, contador {n0}→{n1}"
    add("C", cat, "Solo un superusuario puede lanzar tareas", "401/403 y la tarea no corre", run=cron_perm)

    def cron_failing(_):
        r = raw(port, "POST", "/api/crons/pbmini_failing", SU); h = raw(port, "GET", "/api/health")
        return r.status == 204 and h.status == 200, f"tarea que lanza → {r.status}; el servidor sigue vivo ({h.status})"
    add("C", cat, "Una tarea que lanza una excepción", "Se registra el error y el proceso sigue vivo", run=cron_failing)
    add("C", cat, "Las tareas no son rutas ni archivos públicos", "404", "/cron/ticker.js", st=404, hasnt=["schedule"])

    # ============================================================ M. Correo con plantillas
    cat = "M · Correo con plantillas (mails/)"
    sink = SmtpSink()
    def mail_setup(_):
        L.api(port, "PATCH", "/api/settings", {"smtp": {"enabled": True, "host": "127.0.0.1", "port": sink.port, "tls": False, "username": "", "password": ""}, "meta": {"senderAddress": "noreply@lab.test", "senderName": "Lab"}}, ctx["TOKSU"])
        return True, f"SMTP de prueba en 127.0.0.1:{sink.port}"
    add("M", cat, "Preparación: SMTP local de captura y remitente", "Listo", run=mail_setup)
    MH = {"Authorization": ctx["TOKB"], **J}

    def send(to, name="Ana", h=None):
        return raw(port, "POST", "/mailer", h or MH, json.dumps({"to": to, "name": name}))
    def wait_msgs(n, t=6):
        end = time.time() + t
        while time.time() < end and len(sink.messages) < n: time.sleep(0.1)
        return sink.messages

    def mail_ok(_):
        sink.messages.clear()
        r = send("dest1@lab.test"); msgs = wait_msgs(1)
        if r.status != 200 or not msgs: return False, f"HTTP {r.status}; mensajes={len(msgs)}"
        m = sink.parse(msgs[0])
        ok = m["to"] == "dest1@lab.test" and "noreply@lab.test" in m["from"] and m["subject"] == "Bienvenido Ana" and "<h1>Hola Ana</h1>" in m["html"]
        return ok, f"from={m['from']!r} to={m['to']!r} subject={m['subject']!r}"
    add("M", cat, "Enviar con plantilla (cuerpo + asunto con variables)", "Remitente de Ajustes, un solo destinatario, asunto y cuerpo correctos", "/mailer", run=mail_ok)

    def mail_escape(_):
        sink.messages.clear()
        r = send("dest2@lab.test", "<script>alert(1)</script>"); msgs = wait_msgs(1)
        if r.status != 200 or not msgs: return False, f"HTTP {r.status}"
        m = sink.parse(msgs[0]); d = A.html_danger(m["html"])
        return not d and "&lt;script&gt;" in m["html"] and "\n" not in m["subject"] and "\r" not in m["subject"], f"peligros en el HTML del correo={d or 'ninguno'}; asunto={m['subject']!r}"
    add("M", cat, "Dato hostil en la plantilla del correo", "Autoescape en el cuerpo; el asunto no contiene saltos de línea", "/mailer", run=mail_escape)

    def mail_hostile(_):
        sink.messages.clear(); bad = []
        cases_ = ["a@b.io,c@d.io", "a@b.io;c@d.io", "<a@b.io>", "a@b.io>", '"x y"@b.io', "a b@c.io", "a@b", "a@@b.io", "a@b..io", ".a@b.io", "a@b.io ", "a@-b.io", "x" * 280 + "@b.io", "a@b.io\r\nBcc: v@evil.io", "a@b.io%0d%0aBcc:v@evil.io", "a@b.io\nBcc: v@evil.io", "", "ñandú@b.io", "a@b.io\x00", "a@[127.0.0.1]", "a@localhost"]
        for to in cases_:
            r = send(to)
            if r.status == 200: bad.append(f"ACEPTADO {to[:30]!r}")
            if r.status >= 502: bad.append(f"{to[:20]!r}→{r.status}")
        time.sleep(0.8)
        if sink.messages: bad.append(f"se enviaron {len(sink.messages)} correos")
        return not bad, "; ".join(bad[:5]) or f"{len(cases_)} destinatarios hostiles rechazados (400/500) y 0 correos enviados"
    add("M", cat, "Destinatarios hostiles (lista, CRLF, comillas, sin dominio, IP literal...)", "Todos rechazados; nada llega al servidor SMTP", "/mailer", run=mail_hostile)

    def mail_limits(_):
        sink.messages.clear(); who = f"limit{os.getpid()}@lab.test"
        r = [send(who).status for _ in range(5)]
        up = send(who.upper()).status
        other = send(f"other{os.getpid()}@lab.test").status
        return r[:3] == [200, 200, 200] and r[3] == 429 and up == 429 and other == 200, f"5 envíos al mismo destino→{r}; en mayúsculas→{up}; otro destino→{other}"
    add("M", cat, "Límite por destinatario y por hora (anti mail-bombing)", "Los 3 primeros pasan, el resto 429 (también en mayúsculas); otro destino sigue funcionando", "/mailer", run=mail_limits)
    add("M", cat, "Enviar correo desde un GET (se dispararía con un enlace)", "Prohibido: 500", "/mailer", h={"Authorization": ctx["TOKB"]}, st=500)
    add("M", cat, "Enviar correo sin sesión", "401", "/mailer", m="POST", h=J, d='{"to":"a@b.io"}', st=401)
    add("M", cat, "Las plantillas de correo no son públicas", "404", "/mails/welcome.html", st=404, hasnt=["Hola"])

    # ============================================================ S. Sesiones revocables
    cat = "S · Sesiones revocables (módulo opcional)"
    def login(email_pw):
        return L.api(port, "POST", "/api/collections/users/auth-with-password", dict(identity=email_pw[0], password="Passw0rd!!"))["token"]
    ses = {}
    def ses_setup(_):
        email = f"sess{os.getpid()}@lab.test"
        L.api(port, "POST", "/api/collections/users/records", dict(email=email, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), ctx["TOKSU"])
        ses["email"] = (email,); ses["t1"] = login(ses["email"]); time.sleep(1.1); ses["t2"] = login(ses["email"])  # mismo segundo => mismo JWT (misma sesión)
        lst = json.loads(raw(port, "GET", "/ses/list", {"Authorization": ses["t1"]}).body)["sessions"]
        cur = [s for s in lst if s["current"]]
        ses["sid1"] = cur[0]["id"] if cur else None; ses["all"] = lst
        blob = json.dumps(lst)
        return len(lst) == 2 and len(cur) == 1 and cur[0]["ip"] == "127.0.0.1" and ses["t1"] not in blob and "hash" not in blob, f"{len(lst)} sesiones; actual={bool(cur)}; ip={cur[0]['ip'] if cur else '?'}"
    add("S", cat, "Dos inicios de sesión => dos sesiones; la lista marca la actual y no expone el token ni su hash", "2 sesiones, 1 actual, sin hash", "/ses/list", run=ses_setup)

    def ses_isolation(_):
        other = json.loads(raw(port, "GET", "/ses/list", {"Authorization": ctx["TOKB"]}).body)["sessions"]
        ids = {s["id"] for s in ses["all"]}
        rv = raw(port, "POST", "/ses/revoke", {"Authorization": ctx["TOKB"], **J}, json.dumps({"id": sorted(ids)[0]}))
        still = raw(port, "GET", "/ses/list", {"Authorization": ses["t1"]}).status
        return not (ids & {s["id"] for s in other}) and json.loads(rv.body)["revoked"] is False and still == 200, f"B ve {len(other)} sesiones suyas; revocar ajena→{rv.body.strip()}; la víctima sigue→{still}"
    add("S", cat, "Un usuario no ve ni revoca las sesiones de otro", "Aislamiento total", "/ses/revoke", run=ses_isolation)

    def ses_hostile_ids(_):
        bad = []
        for v in ("x' || 1=1 || '", "../x", "zzzzzzzzzzzzzzz", "%", "a" * 40, "{{7*7}}", " "):
            r = raw(port, "POST", "/ses/revoke", {"Authorization": ses["t1"], **J}, json.dumps({"id": v}))
            if r.status >= 500 or (r.status == 200 and json.loads(r.body).get("revoked") is not False): bad.append(f"{v[:12]!r}→{r.status} {r.body[:40]}")
        return not bad and raw(port, "GET", "/ses/list", {"Authorization": ses["t2"]}).status == 200, "; ".join(bad) or "ids hostiles: revoked=false, sin errores ni efectos"
    add("S", cat, "Identificadores de sesión hostiles", "revoked=false, sin 5xx, sin revocar nada", "/ses/revoke", run=ses_hostile_ids)

    def ses_revoke_other(_):
        other_id = [s["id"] for s in ses["all"] if s["id"] != ses["sid1"]][0]
        r = raw(port, "POST", "/ses/revoke", {"Authorization": ses["t1"], **J}, json.dumps({"id": other_id}))
        a = raw(port, "GET", "/ses/list", {"Authorization": ses["t2"]}).status; b = raw(port, "GET", "/ses/list", {"Authorization": ses["t1"]}).status
        c = raw(port, "GET", "/ses/list", {"Cookie": L.cookie(ses["t2"])}).status
        native = raw(port, "POST", "/api/collections/users/auth-refresh", {"Authorization": ses["t2"]}).status
        return json.loads(r.body)["revoked"] is True and a == 401 and c == 401 and b == 200 and native == 200, f"revocada→{a}/cookie {c}; la otra sigue→{b}; API nativa con el token revocado→{native} (límite documentado)"
    add("S", cat, "Revocar otra sesión propia", "Deja de valer en pbmini (cabecera y cookie); la actual sigue; la API nativa lo acepta hasta que expire (límite documentado)", "/ses/revoke", run=ses_revoke_other)

    def ses_refresh(_):
        time.sleep(1.1)  # dos JWT del mismo usuario emitidos en el mismo segundo son idénticos (misma credencial, misma sesión)
        r = L.api(port, "POST", "/api/collections/users/auth-refresh", None, ses["t1"]); t_new = r["token"]
        rl = raw(port, "GET", "/ses/list", {"Authorization": t_new})
        if rl.status != 200:
            nat = raw(port, "POST", "/api/collections/users/auth-refresh", {"Authorization": t_new}).status
            rows = json.loads(raw(port, "GET", "/api/collections/pbmini_sessions/records?perPage=50&sort=created", SU).body)["items"]
            mine = [(r["id"][:5], r["revoked"], len(r["olds"]), r["hash"][:6]) for r in rows if r["rid"] == rows[-1]["rid"] or True][-6:]
            import hashlib
            return False, f"nativo con el token nuevo→{nat}; hash nuevo={hashlib.sha256(t_new.encode()).hexdigest()[:6]}; filas={mine}"
        if rl.status != 200: return False, f"el token refrescado recibió {rl.status}: {rl.body[:120]} (mismo token que antes: {t_new == ses['t1']})"
        lst = json.loads(rl.body)["sessions"]
        same = [s for s in lst if s["id"] == ses["sid1"]]
        old_ok = raw(port, "GET", "/ses/list", {"Authorization": ses["t1"]}).status
        time.sleep(1.1)   # segundo refresh con el token YA rotado: debe seguir en la misma sesión (sin sesiones huérfanas)
        t_new2 = L.api(port, "POST", "/api/collections/users/auth-refresh", None, ses["t1"])["token"]
        lst2 = json.loads(raw(port, "GET", "/ses/list", {"Authorization": t_new2}).body)["sessions"]
        same_session = len(lst2) == len(lst) and len([x for x in lst2 if x["id"] == ses["sid1"]]) == 1
        rv = raw(port, "POST", "/ses/revoke", {"Authorization": t_new, **J}, json.dumps({"id": ses["sid1"]}))
        after_new = raw(port, "GET", "/ses/list", {"Authorization": t_new}).status; after_old = raw(port, "GET", "/ses/list", {"Authorization": ses["t1"]}).status
        after_new2 = raw(port, "GET", "/ses/list", {"Authorization": t_new2}).status
        return len(same) == 1 and same[0]["current"] and old_ok == 200 and same_session and after_new == 401 and after_old == 401 and after_new2 == 401, f"refresh conserva la sesión ({bool(same)}), también al reusar el token anterior ({same_session}); revocarla invalida el nuevo→{after_new}, el anterior→{after_old} y el del segundo refresh→{after_new2}"
    add("S", cat, "Refrescar el token conserva la sesión; revocarla invalida el token nuevo y los anteriores", "Sin tokens huérfanos que sobrevivan a la revocación", "/ses/list", run=ses_refresh)

    def ses_logout(_):
        time.sleep(1.1); tk = login(ses["email"])
        g = raw(port, "GET", "/ses/logout", {"Authorization": tk}); still = raw(port, "GET", "/ses/list", {"Authorization": tk}).status
        csrf = raw(port, "POST", "/ses/logout", {"Cookie": L.cookie(tk), "Sec-Fetch-Site": "cross-site", **J}); still2 = raw(port, "GET", "/ses/list", {"Authorization": tk}).status
        r = raw(port, "POST", "/ses/logout", {"Authorization": tk, **J}, "{}"); after = raw(port, "GET", "/ses/list", {"Authorization": tk}).status
        sc = r.header("set-cookie") or ""
        return (g.status, still, csrf.status, still2, r.status, after) == (500, 200, 401, 200, 200, 401) and "pb_auth=" in sc and "Max-Age=0" in sc, f"GET→{g.status}; CSRF→{csrf.status}; POST→{r.status}, después→{after}; Set-Cookie={sc[:50]!r}"
    add("S", cat, "ctx.logout(): solo por POST, con CSRF, expira la cookie y revoca la sesión", "GET→500, cross-site→401, POST→200 + Set-Cookie caducada + token inválido", "/ses/logout", run=ses_logout)

    def ses_logout_all(_):
        time.sleep(1.1); t_a = login(ses["email"]); time.sleep(1.1); t_b = login(ses["email"])
        r = raw(port, "POST", "/ses/logout-all", {"Authorization": t_a, **J}, "{}")
        a = raw(port, "GET", "/ses/list", {"Authorization": t_a}).status; b = raw(port, "GET", "/ses/list", {"Authorization": t_b}).status
        nr = raw(port, "POST", "/api/collections/users/auth-refresh", {"Authorization": t_b}); nat = nr.status
        na = raw(port, "POST", "/api/collections/users/auth-refresh", {"Authorization": t_a}).status
        if nat == 200: return False, f"nativo: t_b→200, t_a→{na}, t_a==t_b {t_a == t_b}; resp={nr.body[:100]}; logout-all={r.status} {r.body[:60]}"
        return r.status == 200 and a == 401 and b == 401 and nat in (400, 401), f"cerrar en todas partes: este→{a}, el otro→{b}, API nativa con el otro→{nat}"
    add("S", cat, "ctx.logoutEverywhere()", "Invalida TODOS los tokens, también para la API nativa", "/ses/logout-all", run=ses_logout_all)

    def ses_storage(_):
        tk = login(ses["email"]) if False else None
        uid, tok = mkuser(plan="free")
        rows = json.loads(raw(port, "GET", "/api/collections/pbmini_sessions/records?perPage=200", SU).body)["items"]
        blob = json.dumps(rows)
        pub = [raw(port, "GET", "/api/collections/pbmini_sessions/records").status, raw(port, "GET", "/api/collections/pbmini_sessions/records", {"Authorization": tok}).status]
        return tok not in blob and all(len(r["hash"]) == 64 for r in rows) and all(p in (403, 404) for p in pub), f"{len(rows)} filas, ninguna con el token en claro; acceso anónimo/usuario→{pub}"
    add("S", cat, "El token nunca se guarda; la tabla de sesiones es solo para superusuarios", "Solo sha256; 403/404 para el resto", run=ses_storage)
    add("S", cat, "La tabla interna no se puede consultar desde pbmini", "El nombre pbmini_* está vetado en consultas/mutaciones (ver arranque)", "/ses/list", h={"Authorization": ctx["TOKB"]}, st=200)

    # ============================================================ servidores adicionales: modo "role" y migración de sesiones (legacy)
    import shutil
    EXE, RUN = ctx["exe"], L.RUN

    def start_extra(tag, pages, hooks_extra, xport, env=None):
        root = os.path.join(RUN, f"x-{tag}"); pgdir = root + "-pages"
        shutil.rmtree(pgdir, ignore_errors=True); os.makedirs(pgdir)
        for rel, txt in pages.items():
            fp = os.path.join(pgdir, rel); os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
        L.build_sandbox(root, pgdir, symlinks=False, clean=True, hooks_extra=hooks_extra)
        pb = L.PB(EXE, root, xport, env={"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **(env or {})}); pb.serve()
        if not pb.wait_ready(): raise RuntimeError("servidor adicional no arrancó: " + pb.log()[-300:])
        return pb, root

    def su_login(p_): return L.api(p_, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]

    cat = "A · Acceso: roles, permisos y membresías"
    ROLE_CFG = 'module.exports = { access: { enabled: true, mode: "role", collection: "users", field: "role", roles: ["admin", "editor"] } };'
    def role_mode(_):
        pb = None; bad = []
        try:
            pb, root = start_extra("role", {"p.js": 'module.exports = { auth: "user", access: { role: "admin" }, get: (ctx) => ctx.json({ ok: true, admin: ctx.hasRole("admin") }) };'}, {"pbmini.config.js": ROLE_CFG}, 18711)
            su = su_login(18711); users_ = L.api(18711, "GET", "/api/collections/users", None, su)
            L.api(18711, "PATCH", "/api/collections/users", dict(fields=users_["fields"] + [dict(name="role", type="text")]), su)
            want = {"admin": 200, "editor": 403, "": 403, "ADMIN": 403, "admin,editor": 200, "x" * 100: 403, "<script>": 403, "../admin": 403, " admin ": 200}
            for i, (val, st_) in enumerate(want.items()):
                _, tok = mkuser(18711, su, role=val)
                got = raw(18711, "GET", "/p", {"Authorization": tok}).status
                if got != st_: bad.append(f"role={val[:12]!r}→{got} (esperado {st_})")
            if raw(18711, "GET", "/p").status != 401: bad.append("anónimo")
            if raw(18711, "GET", "/p", {"Authorization": su}).status != 200: bad.append("superusuario")
            return not bad, "; ".join(bad) or f"{len(want)} valores del campo `role` (incluidos mayúsculas, lista, espacios, traversal, XSS) con el resultado esperado"
        finally:
            if pb: pb.stop()
    add("A", cat, "Modo básico `mode: role`: un campo de la colección con el nombre del rol", "Solo los valores exactos y declarados (minúsculas) dan acceso; basura = sin acceso", run=role_mode)

    cat = "S · Sesiones revocables (módulo opcional)"
    SES_PAGES = {"ses/list.js": open(os.path.join(L.SEC, "mini", "pages", "ses", "list.js"), encoding="utf-8").read()}
    def sess_cfg(enabled, legacy="allow"):
        return "module.exports = { sessions: { enabled: %s, legacy: \"%s\" } };" % ("true" if enabled else "false", legacy)
    def legacy_flow(_):
        pb = None; bad = []; cfgp = None
        try:
            pb, root = start_extra("legacy", SES_PAGES, {"pbmini.config.js": sess_cfg(False)}, 18712)
            cfgp = os.path.join(root, "pb_hooks", "pbmini.config.js")
            su = su_login(18712); uid, t_old = mkuser(18712, su)
            if raw(18712, "GET", "/ses/list", {"Authorization": t_old}).status != 500: bad.append("con el módulo apagado ctx.sessions() debe fallar (500)")
            def restart(cfg):
                nonlocal pb
                pb.stop(); open(cfgp, "w", encoding="utf-8", newline="\n").write(cfg)
                pb = L.PB(EXE, root, 18712, env={"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn"}); pb.serve()
                if not pb.wait_ready(): raise RuntimeError("no arrancó: " + pb.log()[-200:])
            restart(sess_cfg(True, "allow"))
            a = raw(18712, "GET", "/ses/list", {"Authorization": t_old}).status
            if a != 200: bad.append(f"legacy=allow: token previo→{a}")
            time.sleep(1.1)
            su = su_login(18712)   # `superuser upsert` al reiniciar rota la clave del superusuario
            email_ = L.api(18712, "GET", f"/api/collections/users/records/{uid}", None, su)["email"]
            t_new = L.api(18712, "POST", "/api/collections/users/auth-with-password", dict(identity=email_, password="Passw0rd!!"))["token"]
            lst = json.loads(raw(18712, "GET", "/ses/list", {"Authorization": t_new}).body)["sessions"]
            if len(lst) != 1: bad.append(f"el token nuevo debe tener 1 sesión registrada (hay {len(lst)})")
            restart(sess_cfg(True, "deny"))
            d_old = raw(18712, "GET", "/ses/list", {"Authorization": t_old}).status; d_new = raw(18712, "GET", "/ses/list", {"Authorization": t_new}).status
            if (d_old, d_new) != (401, 200): bad.append(f"legacy=deny: previo→{d_old} (401), registrado→{d_new} (200)")
            rv = raw(18712, "POST", "/ses/revoke", {"Authorization": t_new, **J}, json.dumps({"id": lst[0]["id"]})) if False else None
            return not bad, "; ".join(bad) or "apagado→500; activado con legacy=allow conserva los tokens previos; legacy=deny solo acepta los registrados"
        finally:
            if pb: pb.stop()
    add("S", cat, "Activar el módulo sobre un proyecto que ya tiene usuarios con sesión", "legacy=allow no cierra sesiones; legacy=deny solo acepta tokens registrados; apagado => ctx.sessions() falla", run=legacy_flow)

    # ============================================================ X. Generador pbmini:new
    cat = "X · Generador de páginas (pbmini:new)"
    PBROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def tree(root_):
        out = {}
        for dp, dn, fn in os.walk(root_):
            for f in fn:
                p_ = os.path.join(dp, f)
                try: out[os.path.relpath(p_, root_)] = os.path.getsize(p_)
                except OSError: pass
        return out

    def gen_env():
        root = os.path.join(RUN, "gen"); pgdir = root + "-pages"
        shutil.rmtree(pgdir, ignore_errors=True); os.makedirs(pgdir)
        open(os.path.join(pgdir, "index.html"), "w", encoding="utf-8").write("<h1>x</h1>")
        L.build_sandbox(root, pgdir, symlinks=False, clean=True)
        return root

    def pbcmd(root, *args):
        env = dict(os.environ, PBMINI_PUBLIC_AUDIT="warn")
        r = subprocess.run([EXE, *args, f"--dir={root}/pb_data", f"--hooksDir={root}/pb_hooks", f"--publicDir={root}/pb_public"], capture_output=True, text=True, env=env, cwd=root, timeout=90, encoding="utf-8", errors="replace")
        return r.returncode, (r.stdout or "") + (r.stderr or "")

    def routes_of(root):
        rc, out = pbcmd(root, "pbmini:routes")
        a = out.find("PBMINI_ROUTES_JSON_BEGIN"); b = out.find("PBMINI_ROUTES_JSON_END")
        if rc != 0 or a < 0: raise RuntimeError("pbmini:routes falló tras generar: " + out[-300:])
        return {r["key"]: r for r in json.loads(out[a + len("PBMINI_ROUTES_JSON_BEGIN"):b])}

    def gen_ok(_):
        root = gen_env(); bad = []
        steps = [(("page", "blog/[slug]"), "blog/[slug]/index.js", "blog/[slug]/index.html"), (("endpoint", "users/[id]/update", "post"), "users/[id]/update.js", None),
                 (("page", "docs/"), "docs/index.js", "docs/index.html"), (("endpoint", "items", "get,post"), "items.js", None), (("page", "files/[...path]"), "files/[...path]/index.js", "files/[...path]/index.html")]
        for args, js, html in steps:
            rc, out = pbcmd(root, "pbmini:new", *args)
            hp = os.path.join(root, "pb_hooks", "pages")
            if rc != 0 or not os.path.isfile(os.path.join(hp, js)): bad.append(f"{args}→rc={rc} {out[-120:]!r}")
            if html and not os.path.isfile(os.path.join(hp, html)): bad.append(f"falta {html}")
        rc, out = pbcmd(root, "pbmini:new", "schema", "paging")
        if rc != 0 or not os.path.isfile(os.path.join(root, "pb_hooks", "pages", "_schemas", "paging.js")): bad.append("schema")
        try: t = routes_of(root)
        except Exception as e: return False, str(e)
        want = {"GET /blog/{slug}": "user", "POST /users/{id}/update": "user", "GET /docs": "user", "GET /items": "user", "POST /items": "user", "GET /files/{path...}": "user"}
        for k, au in want.items():
            if k not in t: bad.append(f"falta la ruta {k}")
            elif t[k]["auth"] != au: bad.append(f"{k} auth={t[k]['auth']}")
        if "GET /blog/{slug}" in t and t["GET /blog/{slug}"]["params"][0]["spec"]["type"] != "slug": bad.append("el parámetro slug no quedó tipado")
        if "POST /users/{id}/update" in t and t["POST /users/{id}/update"]["params"][0]["spec"]["type"] != "id": bad.append("el parámetro id no quedó tipado")
        return not bad, "; ".join(bad) or f"5 rutas + 1 esquema generados; el proyecto arranca y la tabla refleja auth:'user' y parámetros tipados ({len(t)} rutas)"
    add("X", cat, "Generar páginas, endpoints y un esquema", "Archivos creados en la ubicación correcta; el proyecto sigue arrancando; por defecto auth:'user' y params tipados", run=gen_ok)

    def gen_noclobber(_):
        root = gen_env(); pages_ = os.path.join(root, "pb_hooks", "pages")
        pbcmd(root, "pbmini:new", "page", "blog/[slug]"); before = tree(pages_)
        bad = []
        for args in (("page", "blog/[slug]"), ("endpoint", "blog/[slug]"), ("page", "blog/"), ("page", "/"), ("page", ""), ("endpoint", "blog/[slug]/index"), ("page", "blog"), ("schema", "paging"), ("schema", "paging")):
            if args == ("schema", "paging") and not os.path.isfile(os.path.join(pages_, "_schemas", "paging.js")): pbcmd(root, "pbmini:new", *args); before = tree(pages_); continue
            rc, out = pbcmd(root, "pbmini:new", *args)
            # "page blog/" (index de la carpeta) y "page blog" (blog.js) coexisten solo si no chocan; el resto debe negarse sin tocar nada
            if args in (("page", "blog/"), ("page", "blog")) : continue
            if rc == 0: bad.append(f"{args} se aceptó")
        mid = tree(pages_)
        changed = [k for k in before if mid.get(k) != before[k]]
        return not bad and not changed, "; ".join(bad) or f"nada se sobrescribió (archivos modificados: {changed or 'ninguno'})"
    add("X", cat, "No sobrescribe archivos existentes ni crea rutas duplicadas", "Segundo intento = error y los archivos quedan idénticos", run=gen_noclobber)

    def gen_hostile(_):
        root = gen_env(); snap = tree(root); bad = []
        hostile = ["../x", "..\\x", "a/../b", "a//b", ".hidden", "Bad", "a b", "ñandú", "a/[...b]/c", "[a]/[a]", "a" * 70, "/".join(["d"] * 9), "x" * 300, ".env", "%2e%2e/x", "a:b", "a*b", "a|b", "[x y]", "[]", "[...]", "[1x]", "[a-b]", "con\\..\\x", "a/./b", "..", ".", "a/..", "~root", "$HOME", "`id`", "a;b", "{x}", "‮", "a​b", "ａｂｃ"]
        for h in hostile:
            for kind in ("page", "endpoint"):
                try: rc, out = pbcmd(root, "pbmini:new", kind, h)
                except Exception as e: bad.append(f"{kind} {h[:15]!r}: {type(e).__name__}"); continue
                if rc == 0: bad.append(f"{kind} {h[:20]!r} ACEPTADO")
        for m in ("get,get", "hack", "", "get;post", "GET,post,PUT,patch,delete,get", "get post"):
            rc, out = pbcmd(root, "pbmini:new", "endpoint", "ok", m)
            if rc == 0 and m not in ("",): bad.append(f"métodos {m!r} aceptados")
        for nm in ("../a", "A", "a b", "", "a/b", "x" * 100):
            rc, _o = pbcmd(root, "pbmini:new", "schema", nm)
            if rc == 0: bad.append(f"schema {nm[:12]!r} aceptado")
        after = tree(root); new = sorted(set(after) - set(snap))
        stray = [f for f in new if not f.replace("\\", "/").startswith(("pb_hooks/pages/", "pb_data/"))]  # pb_data/ lo crea PocketBase al arrancar el comando
        return not bad and not stray, "; ".join(bad[:4]) or f"{len(hostile) * 2 + 12} entradas hostiles rechazadas; archivos nuevos fuera de pages/: {stray or 'ninguno'}"
    add("X", cat, "Rutas y nombres hostiles (traversal, \\, NUL, Unicode, comodines, longitudes...)", "Todas rechazadas; nunca se escribe fuera de pb_hooks/pages", run=gen_hostile)

    # ============================================================ D. Tipos TypeScript (deriva y comprobación)
    cat = "D · Tipos (types/pbmini.d.ts)"
    dts = open(os.path.join(PBROOT, "pb_hooks", "types", "pbmini.d.ts"), encoding="utf-8").read()
    def iface(name):
        m = re.search(r"export interface %s(?:<[^>]*>)? \{\n(.*?)\n\}" % name, dts, re.S)
        return set(re.findall(r"^  (\w+)\??[(<:]", m.group(1), re.M)) if m else set()
    def drift_ctx(_):
        keys = set(json.loads(raw(port, "GET", "/probe").body)); d = iface("Ctx")
        return keys == d, f"sobran en el código: {sorted(keys - d)}; sobran en los tipos: {sorted(d - keys)}" if keys != d else f"{len(keys)} miembros de ctx declarados en los tipos"
    add("D", cat, "ctx real vs interface Ctx", "Mismos miembros (si alguien añade ctx.x sin tipos, falla)", "/probe", run=drift_ctx)
    def drift_route(_):
        src = open(os.path.join(PBROOT, "pb_hooks", "lib", "pages.js"), encoding="utf-8").read()
        rk = set(re.findall(r'"(\w+)"', re.search(r"const ROUTE_KEYS = \[(.*?)\];", src, re.S).group(1)))
        mk = rk | set(re.findall(r'"(\w+)"', re.search(r"const MOD_KEYS = ROUTE_KEYS\.concat\(\[(.*?)\]\);", src, re.S).group(1)))
        d = iface("Route")
        return mk == d, f"código-tipos={sorted(mk - d)}; tipos-código={sorted(d - mk)}" if mk != d else f"{len(mk)} claves de ruta declaradas"
    add("D", cat, "Claves de un archivo de página vs interface Route", "Mismas claves que MOD_KEYS de pages.js", run=drift_route)
    def drift_tx(_):
        src = open(os.path.join(PBROOT, "pb_hooks", "lib", "mini.js"), encoding="utf-8").read()
        blk = re.search(r"out = fn\(\{(.*?)\n\s*\}\);", src, re.S).group(1)
        keys = set(re.findall(r"^\s{14}(\w+):", blk, re.M)); d = iface("TxCtx")
        return keys == d, f"código={sorted(keys)} tipos={sorted(d)}"
    add("D", cat, "Operaciones de ctx.tx vs interface TxCtx", "Mismas operaciones", run=drift_tx)
    def drift_cfg(_):
        src = open(os.path.join(PBROOT, "pb_hooks", "lib", "config.js"), encoding="utf-8").read()
        top = set(re.findall(r'"(\w+)"', re.search(r'only\(raw, \[(.*?)\], "pbmini\.config\.js"\)', src).group(1)))
        d = iface("Config")
        sub = {}
        for sec, fn in (("access", "normalizeAccess"), ("sessions", "normalizeSessions"), ("mail", "normalizeMail")):
            m = re.search(r"function %s\(.*?only\([a-z], \[(.*?)\], \"%s\"\)" % (fn, sec), src, re.S); sub[sec] = set(re.findall(r'"(\w+)"', m.group(1)))
        tsub = {}
        for sec in sub:
            m = re.search(r"  %s\?: \{(.*?)\};\n" % sec, dts, re.S); body = m.group(1)
            # propiedades de primer nivel del objeto: nombre seguido de ?: o :, ignorando las anidadas entre llaves
            depth, names_, cur = 0, set(), ""
            for ch in body:
                if ch == "{": depth += 1
                elif ch == "}": depth -= 1
                elif depth == 0: cur += ch
            tsub[sec] = set(re.findall(r"(\w+)\??:", cur))
        bad = [f"{s}: código={sorted(sub[s] - tsub[s])} tipos={sorted(tsub[s] - sub[s])}" for s in sub if sub[s] != tsub[s]]
        return top == d and not bad, "; ".join(bad) or f"secciones {sorted(top)} y sus opciones declaradas"
    add("D", cat, "pbmini.config.js: opciones reales vs interface Config", "Mismas secciones y opciones", run=drift_cfg)

    def tsc_check(_):
        npx = shutil.which("npx") or shutil.which("npx.cmd")
        if not npx: return None, "OMITIDO: no hay npx/Node en este sistema"
        root = gen_env(); pbcmd(root, "pbmini:new", "page", "blog/[slug]"); pbcmd(root, "pbmini:new", "endpoint", "users/[id]/update", "post")
        hooks = os.path.join(root, "pb_hooks"); os.makedirs(os.path.join(hooks, "types"), exist_ok=True)
        shutil.copy(os.path.join(PBROOT, "pb_hooks", "types", "pbmini.d.ts"), os.path.join(hooks, "types")); shutil.copy(os.path.join(PBROOT, "pb_hooks", "jsconfig.json"), os.path.join(hooks, "tsconfig.json"))
        try: r = subprocess.run([npx, "--yes", "-p", "typescript@5.6.3", "tsc", "-p", hooks], capture_output=True, text=True, timeout=240, cwd=hooks, encoding="utf-8", errors="replace")
        except Exception as e: return None, f"OMITIDO: no se pudo ejecutar tsc ({type(e).__name__})"
        out = (r.stdout + r.stderr)
        if r.returncode != 0 and ("WSL 1" in out or "Could not determine Node.js" in out): return None, "OMITIDO: el npx visible es el de Windows vía WSL1 (instala Node dentro de Linux o usa WSL2)"
        if r.returncode != 0 and ("ENOTFOUND" in out or "EAI_AGAIN" in out or "network" in out.lower() or "ECONNREFUSED" in out): return None, "OMITIDO: sin red para descargar typescript"
        # un tipo mal usado debe fallar: añade un error evidente y comprueba que tsc lo detecta
        bad_file = os.path.join(hooks, "pages", "typo.js")
        open(bad_file, "w", encoding="utf-8").write('/** @type {import("../types/pbmini").Route} */\nmodule.exports = { auth: "admin", nope: 1, get: (ctx) => ctx.jsno({}) };\n')
        r2 = subprocess.run([npx, "--yes", "-p", "typescript@5.6.3", "tsc", "-p", hooks], capture_output=True, text=True, timeout=240, cwd=hooks, encoding="utf-8", errors="replace")
        caught = r2.returncode != 0 and "typo.js" in (r2.stdout + r2.stderr)
        return r.returncode == 0 and caught, f"páginas generadas: tsc rc={r.returncode} {out[:160]!r}; un archivo con auth/clave/método mal escritos {'SÍ' if caught else 'NO'} se detecta"
    add("D", cat, "tsc --noEmit sobre páginas generadas (si hay Node y red)", "Las plantillas del generador pasan el chequeo de tipos y un error de tipeo se detecta", run=tsc_check)

    return cases
