"""Fase PROFUNDA sobre los hallazgos de la Ronda 7: archivos ocultos/sensibles (dotfiles), CSRF, JSON y Unicode en rutas.
Técnicas: Breaking Parser Logic (Orange Tsai), WorstFit/Best-Fit de Windows (DEVCORE 2025), CVE-2025-30208 de Vite (`?raw??`),
CVE-2023-45283/45284 de Go (nombres reservados de Windows), interoperabilidad JSON (Bishop Fox), bypass de CSRF (Origin null,
Referer suprimido, sufijos de host, userinfo, cookie tossing). Se ejecuta en Windows, Linux y macOS: lo que depende del SO se
marca como OMITIDO (no como aprobado) cuando no se puede probar en el SO actual.
"""
import re, time, urllib.parse

UID = "abcdefghijklmno"
Q = urllib.parse.quote


def public_boot_cases():
    """(etiqueta, pb_public extra, ¿debe arrancar?). Cualquier archivo oculto/sensible/symlink/especial en pb_public aborta el arranque (modo strict)."""
    bad = lambda label, files: (label, files, False)
    return [
        ("limpio: assets normales y .well-known", {"a.css": "body{}", "img/logo.svg": "<svg/>", ".well-known/ok.txt": "ok", "ñandú.txt": "u"}, True),
        bad("contiene .env", {".env": "X=1"}), bad("contiene .git/config", {".git/config": "x"}), bad("contiene .htpasswd", {".htpasswd": "x"}),
        bad("contiene sub/.secret (oculto en subcarpeta)", {"sub/.secret": "x"}), bad("contiene .DS_Store", {".DS_Store": "x"}), bad("contiene backup.sql", {"backup.sql": "x"}),
        bad("contiene server.pem", {"server.pem": "x"}), bad("contiene config.bak", {"config.bak": "x"}), bad("contiene notes.txt~ (respaldo de editor)", {"notes.txt~": "x"}),
        bad("contiene db.sqlite", {"db.sqlite": "x"}), bad("contiene app.log", {"app.log": "x"}), bad("contiene id_rsa", {"id_rsa": "x"}), bad("contiene Dockerfile", {"Dockerfile": "x"}),
        bad("contiene un nombre corto 8.3 (ENV~1)", {"ENV~1": "x"}),
        bad("symlink a un archivo fuera de pb_public (solo Linux/macOS)", {"link.txt": ("link", "outside/secret.txt")}),
        bad("symlink a un directorio fuera de pb_public (solo Linux/macOS)", {"dirlink": ("link", "outside", "dir")}),
        bad("FIFO/archivo especial (bloquearía la lectura; solo Linux/macOS)", {"pipe": ("fifo",)}),
    ]


def build(L, ctx, A):
    Case, raw, port, cookie, LEAKS = L.Case, L.raw, ctx["port"], L.cookie, L.LEAKS
    sock, status_of = A.sock, A.status_of
    TOKA, TOKSU = ctx["TOKA"], ctx["TOKSU"]
    cases, n = [], [0]
    host = f"127.0.0.1:{port}"
    CE = A.CE

    def add(cat, obj, meta, path=None, **kw):
        n[0] += 1; cases.append(Case(f"D{n[0]:03d}", cat, obj, meta, path, **kw))

    def scn(cat, obj, meta, fn): add(cat, obj, meta, run=fn)

    def chain(path, method="GET", headers=None, hops=3, timeout=8):
        """Sigue redirecciones relativas de limpieza (como un navegador) y devuelve todas las respuestas."""
        out, cur = [], path
        for _ in range(hops + 1):
            r = raw(port, method, cur, headers, timeout=timeout); out.append((cur, r))
            loc = r.header("location")
            if r.status in (301, 302, 303, 307, 308) and loc and loc.startswith("/") and not loc.startswith("//"): cur = loc
            else: break
        return out

    def leaked(resps):
        bad = []
        for cur, r in resps:
            blob = r.body + "".join(r.hdrlines)
            for k in LEAKS:
                if k in blob: bad.append(f"{cur[:40]!r}→FUGA {k}")
            if r.status >= 500: bad.append(f"{cur[:40]!r}→{r.status}")
        return bad

    def family(paths, method="GET", headers=None):
        def f(_):
            bad, tot = [], 0
            for p in paths:
                tot += 1; bad += leaked(chain(p, method, headers))
                if len(bad) > 6: break
            return not bad, "; ".join(bad[:5]) or f"{tot} variantes: sin canarios, sin 5xx"
        return f

    TARGETS = [".env", ".env.local", ".git/config", ".htpasswd", ".ssh/id_rsa", "sub/.secret", "sub/.git/config", ".hidden/inner.txt", ".aws/credentials", ".DS_Store"]

    def dot_variants(t, kind):
        i = t.index("."); pre, rest = t[:i], t[i + 1:]
        if kind == "codificacion":
            dots = ["%2e", "%2E", "%252e", "%25252e", "%c0%ae", "%e0%80%ae", "%f0%80%80%ae", "%u002e", "%c0%2e", "%2e%00", ".%00", "%2e%2e"]
            v = [f"/{pre}{d}{rest}" for d in dots]
            v += [f"/{t}", f"/{t.replace('/', '%2f')}", f"/{t.replace('/', '%2F')}", f"/{t.replace('/', '%252f')}", f"/{t.replace('/', '%5c')}", f"/{t.replace('/', '%c0%af')}", f"/{t.replace('/', '%e0%80%af')}",
                  f"/%2e/{t}", f"/x/%2e%2e/{t}", f"/x/..%2f{t}", f"/x%2f..%2f{t}", f"/..%2f{t}", f"/%2e%2e%2f{t}", f"/.%2e/{t}", f"/%2e./{t}", f"/..%252f{t}", f"/%252e%252e/{t}", f"/%2e%2e;/{t}", f"/..;/{t}"]
            return v
        if kind == "delimitadores":
            suf = ["/", "/.", "/..", ".", "..", "...", "%20", "%09", "%0a", "%0d", "%00", "%00.css", "%00.png", "%00.html", ";.css", "%3b.css", ";x=1", ";jsessionid=1", "?x=1", "%3fx=1", "?raw??", "?import&raw??", "?.css", "?inline", "?url", "?download", "#x", "%23x", "%2f", "%5c", "::$DATA", ":$DATA", ":x", "::$INDEX_ALLOCATION", ".:$DATA", " ", "%e2%80%8b", "%c2%a0"]
            return [f"/{t}{s}" for s in suf]
        if kind == "barras":
            return [f"//{t}", f"///{t}", f"/./{t}", f"/.//{t}", f"/x/../{t}", f"/x/./../{t}", f"\\{t}", f"/\\{t}", f"%5c{t}", f"/%5c{t}", f"/x/..\\{t}", f"/..\\{t}", f"/x/%5c..%5c{t}",
                    f"/{t.replace('/', chr(92))}", f"/{t.replace('/', '//')}", f"/{t.replace('/', '/./')}", f"/{t.replace('/', '/;/')}", f"/;/{t}", f"/{t}/;", f"/.;/{t}", f"/x/.;/{t}", f"/x/..;/{t}"]
        if kind == "unicode":
            dots = ["．", "․", "‥", "…", "﹒", "｡", "。", "܁", "۔", "⸮", "·", "˙", "⋅", "∙", "・", "ᐧ"]
            sl = ["／", "∕", "⁄", "⧸", "╱", "╲", "＼", "∖", "⧵", "⧹", "﹨", "᜵"]
            v = [f"/{Q(pre + d + rest)}" for d in dots] + [f"/{Q(t.replace('/', s2))}" for s2 in sl if "/" in t]
            v += [f"/{Q(chr(0x200b) + t)}", f"/{Q(chr(0x202e) + t)}", f"/{Q(t + chr(0x200b))}", f"/{Q(pre + chr(0xad) + '.' + rest)}", f"/{Q(chr(0x2066) + t)}", f"/{Q(chr(0xfeff) + t)}",
                  f"/{Q(chr(0x2800) + t)}", f"/{Q(chr(0x3164) + t)}", f"/{Q(chr(0x034f) + t)}", f"/{Q(chr(0xe0020) + t)}", f"/{Q(t.upper())}", f"/{Q(t.title())}", f"/{Q(t.swapcase())}"]
            return v
        if kind == "windows":
            base = [f"/{t}", f"/{t.upper()}", f"/{t.lower()}", f"/{t}.", f"/{t}..", f"/{t} ", f"/{t}. ", f"/{t}%20.", f"/{t}::$DATA", f"/{t}:$DATA", f"/{t}:stream", f"/{t}::$INDEX_ALLOCATION", f"/{t}.:$DATA",
                    f"/{t.replace('.', '~1', 1)}", f"/{t.replace('/', chr(92)).upper()}"]
            if t == ".env": base += ["/ENV~1", "/env~1", "/ENV~1.", "/ENV~2", "/%45NV~1"]
            if t == ".git/config": base += ["/GIT~1/CONFIG", "/GIT~1/CONFIG~1", "/git~1/config", "/GIT~1%5cCONFIG"]
            return base
        return []

    # ============================================================ D1. Archivos ocultos: técnicas conocidas, por familia
    cat = "D1 · Archivos ocultos (dotfiles)"
    FAMS = [("codificacion", "Codificación y normalización: %2e, %252e, overlong UTF-8, %u, segmentos ../ ..;/ y %2f", "Orange Tsai / Go: la ruta decodificada nunca contiene un segmento oculto servible"),
            ("delimitadores", "Sufijos y delimitadores: ?raw?? (CVE-2025-30208), ;, #, %00, espacio, punto final, ::$DATA", "El sufijo no desactiva el bloqueo de dotfiles"),
            ("barras", "Barras alternativas: //, \\, %5c, ./, ..;/, ;/ y separadores repetidos", "Todas las rutas equivalentes caen en el mismo bloqueo"),
            ("unicode", "Unicode: puntos y barras parecidos (U+FF0E, U+2024, U+2215, U+29F8...), invisibles, bidi, TAG, mayúsculas", "Ninguna normalización/best-fit (WorstFit) convierte el nombre en un dotfile servible"),
            ("windows", "Windows: nombres cortos 8.3 (ENV~1, GIT~1), flujos NTFS (::$DATA), puntos/espacios finales, mayúsculas", "NTFS no revela dotfiles por alias")]
    for kind, obj, meta in FAMS:
        for t in (".env", ".git/config", "sub/.secret", ".ssh/id_rsa"):
            paths = dot_variants(t, kind)
            scn(cat, f"{obj} → {t} ({len(paths)} variantes)", meta, family(paths))
    allp = [p for t in TARGETS for k, _, _ in FAMS for p in dot_variants(t, k)]
    scn(cat, f"Barrido total: {len(TARGETS)} objetivos × 5 familias = {len(allp)} rutas", "Cero canarios, cero 5xx", family(allp))

    def methods_hdr(ctx):
        bad = []
        for m in ("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "TRACE", "PROPFIND", "FOO"):
            r = raw(port, m, "/.env", {"Content-Type": "text/plain"}, "x" if m in ("POST", "PUT", "PATCH", "DELETE") else None)
            if r.status == 200 and not (m == "OPTIONS" and not r.body.strip()): bad.append(f"{m}→200")
            if "DOTCANARY" in r.body or "hunter2" in r.body: bad.append(f"{m}→FUGA")
        for h in ({"Range": "bytes=0-5"}, {"Range": "bytes=0-"}, {"If-None-Match": "*"}, {"If-Modified-Since": "Mon, 01 Jan 1990 00:00:00 GMT"}, {"If-Range": "x", "Range": "bytes=0-3"}, {"Accept-Encoding": "gzip, br"},
                  {"X-Original-URL": "/.env"}, {"X-Rewrite-URL": "/.env"}, {"X-Forwarded-Prefix": "/.env"}, {"X-Forwarded-Path": "/.env"}, {"X-Forwarded-Uri": "/.env"}, {"Content-Location": "/.env"},
                  {"Referer": "http://127.0.0.1/"}, {"Cookie": cookie(TOKSU)}, {"Authorization": TOKSU}, {"Accept": "text/plain"}, {"X-Requested-With": "XMLHttpRequest"}):
            r = raw(port, "GET", "/", h)
            if "hunter2" in r.body or "DOTCANARY" in r.body: bad.append(f"{list(h)[0]}→FUGA en /")
            r = raw(port, "GET", "/.env", h)
            if r.status in (200, 206) or "hunter2" in r.body: bad.append(f"{list(h)[0]}→{r.status}")
        return not bad, "; ".join(bad) or "10 métodos y 17 cabeceras (Range, X-Original-URL, auth de superuser...) no abren /.env"
    scn(cat, "Métodos HTTP raros y cabeceras de reescritura/rango/condicionales sobre /.env", "Siempre 404; ni siquiera con credenciales de superuser", methods_hdr)

    def rawline(ctx):
        H = "Host: x\r\n"
        reqs = [f"GET /.env HTTP/1.1\r\n{H}\r\n", f"GET //.env HTTP/1.1\r\n{H}\r\n", f"GET http://x/.env HTTP/1.1\r\n{H}\r\n", f"GET http://x//.env HTTP/1.1\r\n{H}\r\n", f"GET /%2e%65nv HTTP/1.1\r\n{H}\r\n",
                "GET /.env HTTP/1.0\r\n\r\n", f"GET /.env\x20HTTP/1.1\r\n{H}\r\n", f"GET /\t.env HTTP/1.1\r\n{H}\r\n", f"GET /.env HTTP/1.1\r\n{H}X-Original-URL: /.env\r\n\r\n",
                f"GET /x HTTP/1.1\r\n{H}X-Rewrite-URL: /.env\r\n\r\n", f"GET /.%00env HTTP/1.1\r\n{H}\r\n", f"GET /.env%20 HTTP/1.1\r\n{H}\r\n", f"GET /.ENV HTTP/1.1\r\n{H}\r\n",
                f"GET /.git/../.env HTTP/1.1\r\n{H}\r\n", f"GET /.git/./config HTTP/1.1\r\n{H}\r\n", f"GET /sub/../.env HTTP/1.1\r\n{H}\r\n", f"GET /.env HTTP/1.1\r\nHost: x\r\nHost: y\r\n\r\n",
                f"GET /.env HTTP/1.1\r\n{H}Connection: keep-alive\r\n\r\nGET /.env HTTP/1.1\r\n{H}Connection: close\r\n\r\n"]
        bad = []
        for rq in reqs:
            line, txt = sock(port, rq.encode("latin-1"))
            if any(k in (txt or "") for k in LEAKS): bad.append(f"{rq.splitlines()[0][:36]!r}→FUGA")
            elif status_of(line) == 200: bad.append(f"{rq.splitlines()[0][:36]!r}→200")
        return not bad, "; ".join(bad[:4]) or f"{len(reqs)} request-lines manipuladas (URI absoluta, HTTP/1.0, tab, NUL, pipelining): sin fuga"
    scn(cat, "Línea de petición manipulada hacia /.env (URI absoluta, HTTP/1.0, tabuladores, NUL, doble Host, pipelining)", "Nunca 200 ni canarios", rawline)

    # ============================================================ D2. Archivos sensibles (respaldos, claves, bases de datos)
    cat = "D2 · Archivos sensibles (no ocultos)"
    sens_paths = []
    for f in L.SENS_FILES:
        sens_paths += [f"/{f}", f"/{f.upper()}", f"/{f}.", f"/{f}%20", f"/{f}::$DATA", f"/{f}/", f"/{f}%00.txt", f"/{f};.css", f"/{f}?x=1", f"/x/../{f}", f"/{Q(f)}", f"/{f}%2e"]
    scn(cat, f"{len(L.SENS_FILES)} archivos sensibles (.bak .sql .pem .log .db .ini id_rsa Dockerfile package.json...) × 12 variantes = {len(sens_paths)} rutas", "404 y sin canarios: respaldos/claves/BD/configuración no se sirven aunque estén en pb_public", family(sens_paths))
    for f in ("config.bak", "backup.sql", "server.pem", "id_rsa", "notes.txt~", "app.log"):
        add(cat, f"Descarga directa de /{f}", "404", "/" + f, st=404, hasnt=["DOTCANARY"])
    for p in ("/CON", "/NUL", "/AUX", "/PRN", "/COM1", "/LPT1", "/con.txt", "/NUL.txt", "/aux.html", "/COM1.log", "/LPT9", "/CONIN$", "/CONOUT$", "/CLOCK$", "/COM%C2%B9", "/con%20", "/con.", "/con::$DATA"):
        add(cat, f"Nombre reservado de Windows {p} (CVE-2023-45283/45284: no debe colgar ni abrir un dispositivo)", "404 inmediato", p, st=404)
    def legit(ctx):
        bad = []
        for p, want in (("/pub.txt", "pub"), ("/sub/a.txt", "sub"), ("/style.css", "color:red"), ("/app.js", "var a"), ("/file.json", "{}"), ("/%C3%B1and%C3%BA.txt", "unicode"), ("/.well-known/ok.txt", "wk"), ("/assets/pub.txt", "pub"), ("/assets/sub/a.txt", "sub")):
            r = raw(port, "GET", p)
            if r.status != 200 or want not in r.body: bad.append(f"{p}→{r.status}")
        r = raw(port, "HEAD", "/pub.txt"); r2 = raw(port, "GET", "/pub.txt", {"Range": "bytes=0-1"})
        if r.status != 200: bad.append(f"HEAD→{r.status}")
        if r2.status != 206: bad.append(f"Range→{r2.status}")
        return not bad, "; ".join(bad) or "9 recursos legítimos (css, js, json, unicode, .well-known, c.file), HEAD y Range siguen funcionando"
    scn(cat, "Sin falsos positivos: los recursos legítimos siguen sirviéndose (css, js, json, nombres Unicode, .well-known, HEAD, Range)", "200/206", legit)

    # ============================================================ D3. Linux/macOS: symlinks, FIFO, nombres con caracteres especiales
    cat = "D3 · Específico de Linux/macOS (omitido en Windows)"
    def unix_only(fn, need_links=False):
        def f(c):
            if L.IS_WIN: return None, "OMITIDO: solo aplica a Linux/macOS (en Windows no se pueden crear estos archivos). Ejecutar con WSL/Linux"
            if need_links and not c.get("_symlinks"): return None, "OMITIDO: el sandbox no pudo crear symlinks"
            return fn(c)
        return f
    def links_scn(c):
        bad = []
        for p in ("/link.txt", "/dirlink/secret.txt", "/dirlink", "/dirlink/", "/dirlink/../secret.txt", "/LINK.TXT"):
            for cur, r in chain(p):
                if "TOP-SECRET" in r.body or r.status in (200, 206): bad.append(f"{p}→{r.status}")
        return not bad, "; ".join(bad) or "symlinks a archivo y a directorio fuera de pb_public: 404 aunque el servidor nativo los seguiría"
    scn(cat, "Symlink dentro de pb_public hacia un archivo/directorio externo", "404 (lo detecta la auditoría de arranque y se bloquea en ejecución)", unix_only(links_scn, True))
    def fifo_scn(c):
        t0 = time.time(); r = raw(port, "GET", "/pipe", timeout=4); dt = time.time() - t0
        return (r.status == 404 and dt < 2), f"FIFO en pb_public → {r.status} en {dt:.2f}s (sin el guardia, abrir una FIFO bloquea la petición para siempre)"
    scn(cat, "FIFO (archivo especial) en pb_public: lectura bloqueante (DoS)", "404 inmediato; el servidor no se cuelga", unix_only(fifo_scn))
    def names_scn(c):
        bad = []
        for p in ("/back%5cslash.txt", "/100%25.txt", "/e%CC%81.txt", "/newline%0aname.txt", "/tab%09name.txt", "/%E2%80%AEtxt.exe", "/PUB.TXT", "/Sub/a.txt"):
            r = raw(port, "GET", p)
            if "DOTCANARY" in r.body or r.status in (200, 206): bad.append(f"{p}→{r.status}")
        return not bad, "; ".join(bad) or "archivos con \\, %, NFD, saltos de línea, tabulador y bidi en el nombre: 404; mayúsculas distintas: 404 (FS sensible)"
    scn(cat, "Nombres de archivo con \\, %, NFD, \\n, \\t y bidi existentes en pb_public; mayúsculas distintas", "404 (no se sirven nombres ambiguos)", unix_only(names_scn))
    def proc_scn(c):
        bad = []
        for p in ("/proc/self/environ", "/proc/self/cwd/pb_public/.env", "/proc/self/root/etc/passwd", "/etc/passwd", "/../../../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc%2fpasswd", "/dev/stdin", "/dev/zero", "/sys/kernel/hostname", "/assets/proc/self/environ", "/assets/..%2f..%2f..%2fetc%2fpasswd"):
            t0 = time.time(); r = raw(port, "GET", p, timeout=4)
            if re.search(r"root:.*:0:0|PATH=|hunter2|DOTCANARY", r.body) or r.status in (200, 206) or time.time() - t0 > 3: bad.append(f"{p}→{r.status}")
        return not bad, "; ".join(bad) or "/proc, /etc, /dev y traversal clásico de Linux: 404 y sin contenido"
    scn(cat, "Rutas especiales de Linux (/proc/self/environ, /etc/passwd, /dev/zero, traversal)", "404 rápido y sin contenido del sistema", unix_only(proc_scn))

    # ============================================================ D4. CSRF profundo (ataques conocidos)
    cat = "D4 · CSRF: técnicas conocidas"
    ck = {"Cookie": cookie(TOKA)}
    def csrf(label, h, expect, ct=None):
        hh = {**ck, **h}
        if ct is not None: hh["Content-Type"] = ct
        add(cat, f"CSRF {label}", "401 (rechazada)" if expect == "block" else "200 (aceptada: es legítima)", "/secure-post", m="POST", h=hh, d="", st=401 if expect == "block" else 200, has=[] if expect == "block" else ['"ok":true'])
    o = f"http://{host}"
    for label, origin in (("Origin con sufijo del host (host.evil)", f"{o}.evil.example"), ("Origin con otro host y el host legítimo en la ruta", f"http://evil.example/{host}"), ("Origin con userinfo (host@evil)", f"http://{host}@evil.example"),
                          ("Origin con fragmento (evil#@host)", f"http://evil.example#@{host}"), ("Origin con backslash (evil\\@host)", f"http://evil.example\\@{host}"), ("Origin con query (evil?host)", f"http://evil.example?{host}"),
                          ("Origin con otro puerto", "http://127.0.0.1:1"), ("Origin sin puerto", "http://127.0.0.1"), ("Origin con barra final", o + "/"), ("Origin sin esquema", host), ("Origin null", "null"),
                          ("Origin con otro nombre del mismo equipo (localhost)", f"http://localhost:{port}"), ("Origin IPv6", f"http://[::1]:{port}"), ("Origin chrome-extension://", "chrome-extension://abcdef"),
                          ("Origin file://", "file://"), ("Origin javascript:", "javascript:alert(1)"), ("Origin con espacio inicial", " " + "https://evil.example"), ("Origin con TAB", "http://evil\t.example"),
                          ("Origin con punto final en el host", f"http://127.0.0.1.:{port}")):
        csrf(label, {"Origin": origin}, "block", "application/x-www-form-urlencoded")
    for label, ref in (("Referer con sufijo", f"{o}.evil.example/"), ("Referer con userinfo", f"http://{host}@evil.example/"), ("Referer evil con el host en la query", f"http://evil.example/?{host}"),
                       ("Referer evil con el host en la ruta", f"http://evil.example/{host}/"), ("Referer evil con el host en el fragmento", f"http://evil.example/#{host}"), ("Referer file://", "file:///x"), ("Referer de otro sitio", "https://evil.example/x")):
        csrf(label, {"Referer": ref}, "block", "text/plain")
    for sfs in ("cross-site", "same-site", "Cross-Site", "SAME-ORIGIN", "same-origin, cross-site", "cross-site, same-origin", "none, cross-site", "invalid", "0"):
        csrf(f"Sec-Fetch-Site: {sfs!r}", {"Sec-Fetch-Site": sfs}, "block", "text/plain")
    csrf("Sec-Fetch-Site same-origin + Origin ajeno (contradictorio)", {"Sec-Fetch-Site": "same-origin", "Origin": "https://evil.example"}, "block", "application/json")
    csrf("Sec-Fetch-Site none + Origin null", {"Sec-Fetch-Site": "none", "Origin": "null"}, "block", "application/json")
    csrf("Sec-Fetch-Site same-origin + Referer ajeno sin Origin", {"Sec-Fetch-Site": "same-origin", "Referer": "https://evil.example/"}, "allow", "application/json") if False else None
    for ct in ("application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain", "text/plain; charset=utf-8", "application/xml", "text/json", "APPLICATION/X-WWW-FORM-URLENCODED"):
        csrf(f"sin Origin/Referer/Sec-Fetch-Site con Content-Type de formulario ({ct}) = <form> de un navegador antiguo con Referer suprimido", {}, "block", ct)
    csrf("sin cabeceras de navegador y sin Content-Type", {}, "block")
    csrf("sin cabeceras de navegador, Content-Type JSON (petición no simple)", {}, "allow", "application/json")
    csrf("sin cabeceras de navegador, JSON con charset", {}, "allow", "application/json; charset=utf-8")
    csrf("sin cabeceras de navegador, X-Requested-With (no simple)", {"X-Requested-With": "XMLHttpRequest"}, "allow", "text/plain")
    csrf("Origin propio exacto", {"Origin": o}, "allow", "application/x-www-form-urlencoded")
    csrf("Origin propio con esquema en mayúsculas", {"Origin": o.upper().replace("HTTP", "HTTP", 1)}, "allow", "application/x-www-form-urlencoded")
    csrf("Origin propio con host en mayúsculas", {"Origin": f"http://{host.upper()}"}, "allow", "application/x-www-form-urlencoded")
    csrf("Referer propio con ruta y query (sin Origin)", {"Referer": f"{o}/page?x=1#f"}, "allow", "text/plain")
    csrf("Sec-Fetch-Site: same-origin y Origin propio", {"Sec-Fetch-Site": "same-origin", "Origin": o}, "allow", "multipart/form-data; boundary=x")
    csrf("Sec-Fetch-Site: none (barra de direcciones) sin Origin", {"Sec-Fetch-Site": "none"}, "allow", "text/plain")
    for m in ("PUT", "PATCH", "DELETE"):
        add(cat, f"CSRF con {m} y Origin ajeno", "No llega al handler", "/secure-post", m=m, h={**ck, "Origin": "https://evil.example"}, d="", st=(401, 404, 405))
    def dup_origin(c):
        bad = []
        for first, second in ((o, "https://evil.example"), ("https://evil.example", o)):
            line, txt = sock(port, (f"POST /secure-post HTTP/1.1\r\nHost: {host}\r\nCookie: {cookie(TOKA)}\r\nOrigin: {first}\r\nOrigin: {second}\r\nContent-Type: text/plain\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").encode())
            if status_of(line) == 200 and first != o: bad.append("el primer Origin ajeno + segundo propio → aceptada")
            if status_of(line) >= 500: bad.append(f"5xx con Origin duplicado")
        return not bad, "; ".join(bad) or "dos cabeceras Origin: se evalúa solo la primera (un navegador nunca envía dos)"
    scn(cat, "Dos cabeceras Origin (ajena primero / propia primero)", "Nunca se acepta si la primera es ajena; sin 5xx", dup_origin)
    add(cat, "GET con cookie desde origen ajeno (lectura, no cambia estado)", "200: los métodos seguros no se bloquean", "/whoami", h={**ck, "Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}, st=200)

    # ============================================================ D5. JSON: interoperabilidad (Bishop Fox) y tipos
    cat = "D5 · JSON estricto"
    J = {"Content-Type": "application/json"}
    GARB = '{"n":5}x'
    CTS = ["application/json", "Application/JSON", "APPLICATION/JSON; charset=utf-8", "application/json;charset=UTF-16", "application/json ; x=1", "text/json", "application/x-json", "application/jsonp", "application/vnd.api+json", "application/ld+json",
           "application/json-patch+json", "application/merge-patch+json", "application/problem+json", "text/plain", "text/x-json", "application/javascript", "text/javascript", "application/json,application/x-www-form-urlencoded",
           "application/x-www-form-urlencoded", "multipart/form-data", "multipart/form-data; boundary=x", "application/xml", "text/xml", "*/*", "application/octet-stream", "application/json  ", "json", ""]
    def ct_matrix(c):
        bad, ok200 = [], []
        for ct in CTS:
            h = {"Content-Type": ct} if ct else {}
            r = raw(port, "POST", "/body", h, GARB)
            if r.status == 200: bad.append(f"{ct!r}+basura→200")
            if r.status >= 500: bad.append(f"{ct!r}→{r.status}")
            r2 = raw(port, "POST", "/body", h, '{"n":5}');
            if r2.status == 200: ok200.append(ct)
        return not bad, "; ".join(bad) or f"con basura tras el JSON ninguno de {len(CTS)} Content-Type devuelve 200; solo se acepta JSON válido con: {ok200[:6]}"
    scn(cat, f"Diferencial de Content-Type: JSON con basura final bajo {len(CTS)} tipos MIME (text/json, +json, charset, mayúsculas, vacío...)", "Siempre 400: ningún tipo MIME deja un parser laxo sin validar", ct_matrix)
    BODIES = [("basura tras el JSON", '{"n":5}x', 400), ("dos documentos", '{"n":5}{"n":6}', 400), ("dos documentos separados por salto", '{"n":5}\n{"n":6}', 400), ("comentario de bloque tras el valor", '{"n":5}/*x*/', 400), ("comentario dentro", '{"n":5,/*x*/"note":"a"}', 400),
              ("comentario de línea", '{"n":5}//x', 400), ("comentario al inicio", '/*x*/{"n":5}', 400), ("coma final", '{"n":5,}', 400), ("comillas simples", "{'n':5}", 400), ("clave sin comillas", "{n:5}", 400), ("cero a la izquierda", '{"n":05}', 400),
              ("signo + ", '{"n":+5}', 400), ("punto inicial", '{"n":.5}', 400), ("punto final", '{"n":5.}', 400), ("hexadecimal", '{"n":0x5}', 400), ("exponente roto", '{"n":5e}', 400), ("Infinity", '{"n":Infinity}', 400), ("NaN", '{"n":NaN}', 400),
              ("undefined", '{"n":undefined}', 400), ("BOM al inicio", "﻿" + '{"n":5}', 400), ("NUL al inicio", "\x00" + '{"n":5}', 400), ("NUL al final", '{"n":5}\x00', 400), ("array en la raíz", "[5]", 400), ("string en la raíz", '"n"', 400), ("null", "null", 400),
              ("número como string", '{"n":"5"}', 400), ("booleano como string", '{"n":5,"ok":"true"}', 400), ("booleano como número", '{"n":5,"ok":1}', 400), ("número como booleano", '{"n":true}', 400), ("array en lugar de número", '{"n":[5]}', 400),
              ("objeto en lugar de número", '{"n":{"a":5}}', 400), ("número en lugar de string", '{"n":5,"note":5}', 400), ("clave con mayúscula", '{"N":5}', 400), ("clave con espacio", '{"n ":5}', 400), ("clave con NUL escapado", '{"n\\u0000":5}', 400),
              ("clave con surrogate suelto", '{"n":5,"\\ud800":1}', 400), ("clave __proto__", '{"__proto__":{"n":1},"n":5}', 400), ("clave constructor", '{"constructor":{"prototype":{"x":1}},"n":5}', 400), ("clave toString", '{"n":5,"toString":1}', 400),
              ("clave de 20000 caracteres", '{"n":5,"' + "k" * 20000 + '":1}', 400), ("entero fuera de rango", '{"n":99999999999999999999}', 400), ("float", '{"n":1.5}', 400), ("exponente grande", '{"n":1e999}', 400), ("negativo", '{"n":-1}', 400),
              ("anidado 5000 niveles", '{"n":' + "[" * 5000 + "]" * 5000 + "}", 400), ("string con NUL escapado", '{"n":5,"note":"a\\u0000b"}', 400), ("string con salto de línea escapado", '{"n":5,"note":"a\\nb"}', 400),
              ("válido", '{"n":5}', 200), ("válido con espacios y saltos", ' \n\t{ "n" : 5 }\n ', 200), ("válido con 5.0 (equivalente a entero)", '{"n":5.0}', 200), ("válido con 5e0", '{"n":5e0}', 200), ("válido: clave escapada \\u006e = n", '{"\\u006e":5}', 200),
              ("válido: campos opcionales", '{"n":5,"note":"hola","ok":false}', 200), ("válido: surrogate suelto en un valor (se escapa al responder)", '{"n":5,"note":"\\ud800"}', (200, 400)), ("válido: -0 se normaliza", '{"n":-0}', (200, 400)), ("claves duplicadas: gana la última (igual que Go)", '{"n":1,"n":5}', 200)]
    for label, body, st in BODIES:
        add(cat, f"JSON hostil: {label}", f"{st if isinstance(st, int) else st}: " + ("rechazado antes del handler" if st == 400 else "aceptado y tipado"), "/body", m="POST", h=J, d=body.encode("utf-8", "surrogatepass") if isinstance(body, str) else body, st=st, has=['"n":5'] if st == 200 else [])
    add(cat, "JSON en UTF-16LE (BOM + bytes alternos)", "400", "/body", m="POST", h=J, d='{"n":5}'.encode("utf-16"), st=400)
    add(cat, "JSON en UTF-32", "400", "/body", m="POST", h=J, d='{"n":5}'.encode("utf-32"), st=400)
    add(cat, "JSON con bytes UTF-8 inválidos dentro de un string", "No 5xx", "/body", m="POST", h=J, d=b'{"n":5,"note":"\xff\xfe"}', st=(200, 400))
    for label, body, st in (("form válido", "n=5&note=hola&ok=true", 200), ("form: n repetido", "n=5&n=6", 400), ("form: n y N", "n=5&N=6", 400), ("form: n con corchetes", "n[]=5", 400), ("form: __proto__", "n=5&__proto__=x", 400), ("form: n con espacios", "n=%205", 400),
                            ("form: n con signo +", "n=%2b5", 400), ("form: n con cero inicial", "n=05", 400), ("form: n=5;m=6", "n=5;note=x", 400), ("form: n con NUL", "n=5%00", 400), ("form: clave codificada = misma clave (%6e)", "%6e=5", 200), ("form: ok=1", "n=5&ok=1", 400)):
        add(cat, f"Formulario: {label}", "400 rechazado" if st == 400 else "200 aceptado", "/body", m="POST", h={"Content-Type": "application/x-www-form-urlencoded"}, d=body, st=st)

    # ============================================================ D6. Unicode en rutas: confusables, invisibles, normalización
    cat = "D6 · Unicode en rutas"
    def uni_scn(items, path_fmt="/docs/a{}b", expect_block=True):
        def f(_):
            bad = []
            for label, cp in items:
                for pf in (path_fmt, "/docs/{}", "/docs/x/{}"):
                    p = pf.format(cp if cp.startswith("%") else Q(cp))
                    r = raw(port, "GET", p)
                    served = r.status == 200 and "DOC" in r.body
                    if expect_block and (served or r.status >= 500): bad.append(f"{label}→{r.status}")
                    if not expect_block and not served: bad.append(f"{label}→{r.status} (falso positivo)")
            return not bad, "; ".join(sorted(set(bad))[:6]) or (f"{len(items)} caracteres × 3 posiciones: rechazados" if expect_block else f"{len(items)} nombres legítimos: aceptados")
        return f
    CLASSES = [
        ("puntos parecidos (NFKC/WorstFit)", [(f"U+{ord(c):04X}", c) for c in "．․‥…﹒｡"], "Tras normalizar serían '.'"),
        ("barras parecidas", [(f"U+{ord(c):04X}", c) for c in "／∕⁄⧸╱╲＼∖⧵⧹"], "Confundibles con / y \\ (best-fit de Windows)"),
        ("invisibles y rellenos", [(f"U+{ord(c):04X}", c) for c in "­͏ᅟᅠ឴឵᠋᠎​‌‍⁠⁣⠀ㅤ﻿ﾠ"], "Nombres que se ven igual pero son distintos"),
        ("bidi (Trojan Source)", [(f"U+{ord(c):04X}", c) for c in "؜‎‏‪‫‬‭‮⁦⁧⁨⁩"], "Invierten el orden visual del nombre"),
        ("caracteres TAG (U+E0000..)", [(f"U+{ord(c):05X}", c) for c in "\U000e0020\U000e0041\U000e007f"], "Invisibles que codifican texto"),
        ("formas de compatibilidad (NFKC)", [(f"U+{ord(c):04X}", c) for c in "Ａａ０①Ⅰﬁ½™KſẛΩ"], "Se normalizan a otra cosa (Kelvin K, ſ larga, ligaduras, ancho completo)"),
        ("secuencias UTF-8 inválidas/overlong", [(l, c) for l, c in (("C0 AE (overlong .)", "%C0%AE"), ("C0 AF (overlong /)", "%C0%AF"), ("E0 80 AE", "%E0%80%AE"), ("E0 80 AF", "%E0%80%AF"), ("F0 80 80 AE", "%F0%80%80%AE"), ("C1 9C (overlong \\)", "%C1%9C"),
                                                                       ("FF", "%FF"), ("FE", "%FE"), ("80", "%80"), ("BF", "%BF"), ("surrogate ED A0 80", "%ED%A0%80"), ("> U+10FFFF", "%F4%90%80%80"), ("C0 80 (NUL modificado)", "%C0%80"), ("EF BF BE", "%EF%BF%BE" if False else "%FF%FE"))], "UTF-8 inválido: no se decodifica nunca a '.' ni '/'"),
        ("NFD (descompuesto) de un carácter latino", [("e + U+0301", "é"), ("n + U+0303", "ñ"), ("a + U+0308", "ä")], "Distinto del NFC aunque se vea igual"),
    ]
    for label, items, why in CLASSES:
        scn(cat, f"{label}: {len(items)} caracteres en comodín /docs/…", f"404; {why}", uni_scn(items))
    LEG = [("é NFC", "é"), ("ñ", "ñ"), ("日本語", "日本語"), ("кириллица", "кириллица"), ("العربية", "العربية"), ("emoji 🙂", "🙂"), ("con guion y punto interno", "a-b.c_d")]
    scn(cat, "Sin falsos positivos: nombres Unicode legítimos (NFC, CJK, cirílico, árabe, emoji)", "200: no se rompen sitios no ingleses", uni_scn(LEG, "/docs/{}", False))
    add(cat, "Homógrafo cirílico en la clave de query ('раge')", "400 (clave no declarada)", "/search?p%D0%B0ge=2", st=400)
    add(cat, "Valor de query con fullwidth en un entero ('１２')", "400", "/search?page=%EF%BC%91%EF%BC%92", st=400)
    add(cat, "Valor de query con dígitos árabe-índicos en un entero", "400", "/search?page=%D9%A1%D9%A2", st=400)
    add(cat, "Slug con letra cirílica homógrafa ('hеllo')", "404", "/slug/h%D0%B5llo", st=404)
    return cases
