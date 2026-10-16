"""Ronda 9: pruebas de las funcionalidades nuevas (esquemas reutilizables, paginación/filtros, transacciones, caché con etiquetas,
layouts y errores, i18n, cron, correo, acceso/membresías, sesiones, generador, tipos). Cada sección declara objetivo + meta.
`build(L, ctx, A)` devuelve los casos en vivo; `bad_pages()` los archivos que deben impedir el arranque (fail-closed)."""
import json, os, re, subprocess, urllib.parse

urllib_quote = lambda v: urllib.parse.quote(v, safe="")

ok_page = 'module.exports = { auth: "public", get: (ctx) => ({}) };'
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
    r = subprocess.run([exe, "pbmini:routes", f"--dir={root}/pb_data", f"--hooksDir={root}/pb_hooks", f"--publicDir={root}/pb_public"],
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
                return r.status == 200 and not d and "{{" not in r.body.replace("{{7*7}}", "") and "49" not in r.body.replace("1.49", ""), f"HTTP {r.status}; peligros={d or 'ninguno'}"
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

    return cases
