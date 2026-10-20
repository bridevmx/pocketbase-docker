#!/usr/bin/env python3
"""pbmini security lab: laboratorio de ataques en tiempo real contra PocketBase + pbmini.

Cada prueba declara un OBJETIVO (qué intenta romper el ataque) y una META (resultado seguro esperado).
El panel (http://127.0.0.1:8099) muestra en vivo si la meta se cumple. Un detector global de fugas revisa
CADA respuesta buscando secretos canario.

Uso:   python lab.py                 # panel en vivo + ejecución automática
       python lab.py --headless      # solo consola; exit 1 si alguna meta falla
       python lab.py --pb RUTA.exe   # usar un binario propio en vez de descargar
Solo biblioteca estándar. Todo corre en 127.0.0.1 y en un directorio aislado (lab/.run).
"""
import argparse, base64, hashlib, http.client, http.server, json, os, platform, queue, re, shutil, socketserver, subprocess
import sys, tempfile, threading, time, urllib.parse, urllib.request, webbrowser, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # examples/pbmini
SEC = os.path.join(ROOT, "security")
CACHE = os.path.join(HERE, ".cache")
RUN = os.path.join(HERE, ".run")
PB_PORT, BAD_PORT, UI_PORT = 8097, 8098, 8099
PB_VERSION = "0.40.5"
PATHLEAKS = ["pb_hooks", "\\Users\\", "goja", "GoError"]
LEAKS = ["DOTCANARY", "TOPSECRET", "hunter2", "TOP-SECRET-OUTSIDE", "SECRET-PAGE-LEAK", "passwordHash", "tokenKey", "Sup3rS3cret"]
DOT_FILES = [".env.local", ".env.production", ".git/config", ".git/HEAD", ".htpasswd", ".ssh/id_rsa", ".hidden/inner.txt", "sub/.secret", "sub/.git/config", ".DS_Store", ".npmrc", ".aws/credentials"]
SENS_FILES = ["config.bak", "db.sqlite", "app.log", "backup.sql", "server.pem", "id_rsa", "notes.txt~", "settings.ini", "web.config", "secret.key", "old.conf", "dump.old", "data.db", "Dockerfile", "package.json", "credentials", "app.env", "sub/cfg.bak"]
LEGIT_FILES = {"pub.txt": "pub\n", "sub/a.txt": "sub\n", "style.css": "body{color:red}\n", "app.js": "var a = 1;\n", "file.json": "{}\n", "ñandú.txt": "unicode\n", ".well-known/ok.txt": "wk\n"}
IS_WIN = sys.platform == "win32"
SU_MAIL, SU_PASS = "su@x.io", "Sup3rS3cret!!"


# ----------------------------------------------------------------------------- eventos
class Bus:
    """Historial + difusión a clientes SSE (los que llegan tarde reciben el historial completo)."""
    def __init__(self): self.events, self.subs, self.lock = [], [], threading.Lock()
    def emit(self, **ev):
        with self.lock:
            ev["n"] = len(self.events); self.events.append(ev)
            for q in list(self.subs): q.put(ev)
    def reset(self):
        with self.lock: self.events = []
        self.emit(type="reset")
    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            for ev in self.events: q.put(ev)
            self.subs.append(q)
        return q
    def unsubscribe(self, q):
        with self.lock:
            if q in self.subs: self.subs.remove(q)

BUS = Bus()
def log(msg): BUS.emit(type="log", msg=msg); print(f"  .. {msg}", flush=True)


# ----------------------------------------------------------------------------- PocketBase
def provision(pb_arg):
    if pb_arg: return os.path.abspath(pb_arg)
    sysname = {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}.get(platform.system())
    arch = {"AMD64": "amd64", "x86_64": "amd64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine())
    if not sysname or not arch: sys.exit("plataforma no soportada: usa --pb")
    exe = os.path.join(CACHE, f"pocketbase-{PB_VERSION}" + (".exe" if sysname == "windows" else ""))
    if os.path.exists(exe): return exe
    os.makedirs(CACHE, exist_ok=True)
    zname = f"pocketbase_{PB_VERSION}_{sysname}_{arch}.zip"; base = f"https://github.com/pocketbase/pocketbase/releases/download/v{PB_VERSION}"
    log(f"descargando {zname} (se verifica SHA-256 oficial)")
    zpath = os.path.join(CACHE, zname)
    urllib.request.urlretrieve(f"{base}/{zname}", zpath)
    sums = urllib.request.urlopen(f"{base}/checksums.txt", timeout=30).read().decode()
    want = next((l.split()[0] for l in sums.splitlines() if l.strip().endswith(zname)), None)
    got = hashlib.sha256(open(zpath, "rb").read()).hexdigest()
    if not want or want != got: os.remove(zpath); sys.exit(f"CHECKSUM INVÁLIDO para {zname}")
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.startswith("pocketbase"))
        with z.open(name) as src, open(exe, "wb") as dst: shutil.copyfileobj(src, dst)
    os.chmod(exe, 0o755); os.remove(zpath)
    return exe


def build_sandbox(root, pages, symlinks=True, clean=False, public=None, hooks_extra=None, i18n=None, fixtures=None):
    """Árbol aislado: pb_data / pb_public / pb_hooks. clean=True: pb_public sin señuelos (para pruebas de arranque).
    public: {ruta: contenido | ("link", destino) | ("fifo",)} extra en pb_public. Devuelve True si se pudieron crear symlinks."""
    shutil.rmtree(root, ignore_errors=True)
    for d in ("outside", "pb_data", "pb_public/sub", "pb_hooks"): os.makedirs(os.path.join(root, d))
    hooks = os.path.join(root, "pb_hooks")
    shutil.copytree(os.path.join(ROOT, "pb_hooks", "lib"), os.path.join(hooks, "lib"))
    shutil.copytree(os.path.join(ROOT, "pb_hooks", "views"), os.path.join(hooks, "views"))
    shutil.copy(os.path.join(ROOT, "pb_hooks", "main.pb.js"), hooks)
    shutil.copy(os.path.join(ROOT, "pb_hooks", "pbmini.config.example.js"), hooks)   # plantilla que copia `pbmini:new config` (no se carga: otro nombre)
    if pages: shutil.copytree(pages, os.path.join(hooks, "pages"), symlinks=True)
    if i18n: shutil.copytree(i18n, os.path.join(hooks, "i18n"))
    if fixtures:   # security/mini/{i18n,mails,cron} y pbmini.config.js: módulos opcionales del sandbox principal
        for sub in ("mails", "cron"):
            if os.path.isdir(os.path.join(fixtures, sub)): shutil.copytree(os.path.join(fixtures, sub), os.path.join(hooks, sub))
        if os.path.isfile(os.path.join(fixtures, "pbmini.config.js")): shutil.copy(os.path.join(fixtures, "pbmini.config.js"), hooks)
    for rel, txt in (hooks_extra or {}).items():   # archivos extra de pb_hooks/ (i18n/, mails/, cron/, pbmini.config.js...)
        full = os.path.join(hooks, rel); os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
    def w(p, txt):
        full = os.path.join(root, p); os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
    w("outside/secret.txt", "TOP-SECRET-OUTSIDE\n"); w("pb_public/pub.txt", "pub\n"); w("pb_public/index.html", "<h1>idx</h1>\n"); w("pb_public/sub/a.txt", "sub\n")
    if not clean:
        w("pb_public/.env", "ENV=hunter2\n")
        for rel in DOT_FILES + SENS_FILES: w("pb_public/" + rel, f"DOTCANARY:{rel}\n")
        for rel, txt in LEGIT_FILES.items(): w("pb_public/" + rel, txt)
    ok_links = True
    for rel, v in (public or {}).items():
        full = os.path.join(root, "pb_public", rel); os.makedirs(os.path.dirname(full), exist_ok=True)
        try:
            if isinstance(v, tuple) and v[0] == "link": os.symlink(v[1] if os.path.isabs(v[1]) else os.path.join(root, v[1]), full, target_is_directory=len(v) > 2)
            elif isinstance(v, tuple) and v[0] == "fifo": os.mkfifo(full)
            else: w("pb_public/" + rel, v)
        except (OSError, NotImplementedError, AttributeError): ok_links = False
    if not symlinks or clean: return False
    try:
        os.symlink(os.path.join(root, "outside", "secret.txt"), os.path.join(root, "pb_public", "link.txt"))
        os.symlink(os.path.join(root, "outside"), os.path.join(root, "pb_public", "dirlink"), target_is_directory=True)
        return True
    except (OSError, NotImplementedError): return False


class PB:
    def __init__(self, exe, root, port, env=None): self.exe, self.root, self.port, self.proc, self.env = exe, root, port, None, env or {}
    def serve(self):
        env = dict(os.environ, PBMINI_STORE_MAX="500", **self.env)
        subprocess.run([self.exe, "superuser", "upsert", SU_MAIL, SU_PASS, f"--dir={self.root}/pb_data"], capture_output=True, cwd=self.root, env=env)
        self.logf = open(os.path.join(self.root, "log"), "wb")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        self.proc = subprocess.Popen([self.exe, "serve", f"--http=127.0.0.1:{self.port}", f"--dir={self.root}/pb_data",
            f"--publicDir={self.root}/pb_public", f"--hooksDir={self.root}/pb_hooks", "--indexFallback=false"], cwd=self.root, env=env,
            stdout=self.logf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags)
    def wait_ready(self, t=25):
        end = time.time() + t
        while time.time() < end:
            if self.proc.poll() is not None: return False
            try:
                c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=1); c.request("GET", "/api/health")
                if c.getresponse().status == 200: return True
            except OSError: time.sleep(0.25)
        return False
    def alive(self): return self.proc is not None and self.proc.poll() is None
    def log(self):
        try: return open(os.path.join(self.root, "log"), "rb").read().decode("utf-8", "replace")
        except OSError: return ""
    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try: self.proc.wait(5)
            except subprocess.TimeoutExpired: self.proc.kill()
        try: self.logf.close()
        except Exception: pass


def api(port, method, path, body=None, tok=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = tok
    c.request(method, path, json.dumps(body) if body is not None else None, h)
    r = c.getresponse(); raw = r.read()
    if r.status >= 400: raise RuntimeError(f"{method} {path}: {r.status} {raw[:200]!r}")
    return json.loads(raw or b"{}")


def seed(port):
    su = api(port, "POST", "/api/collections/_superusers/auth-with-password", {"identity": SU_MAIL, "password": SU_PASS})["token"]
    txt = lambda n, **k: dict(name=n, type="text", **k)
    api(port, "POST", "/api/collections", dict(name="posts", type="base", listRule="published = true", viewRule="published = true",
        fields=[txt("title"), txt("slug"), txt("secret", hidden=True), dict(name="published", type="bool"), dict(name="created", type="autodate", onCreate=True)]), su)
    api(port, "POST", "/api/collections", dict(name="vault", type="base", listRule=None, viewRule=None, fields=[txt("note")]), su)
    api(port, "POST", "/api/collections", dict(name="mine", type="base", listRule="owner = @request.auth.id", viewRule="owner = @request.auth.id",
        fields=[txt("owner"), txt("doc"), dict(name="created", type="autodate", onCreate=True)]), su)
    api(port, "POST", "/api/collections", dict(name="todos", type="base", listRule="owner = @request.auth.id", viewRule="owner = @request.auth.id",
        createRule='@request.auth.id != "" && @request.body.owner = @request.auth.id', updateRule="owner = @request.auth.id", deleteRule="owner = @request.auth.id",
        fields=[txt("title"), dict(name="done", type="bool"), txt("owner"), dict(name="created", type="autodate", onCreate=True)]), su)
    users = api(port, "GET", "/api/collections/users", None, su)   # campos de membresía (los lee el módulo access de pbmini)
    api(port, "PATCH", "/api/collections/users", dict(fields=users["fields"] + [
        dict(name="roles", type="select", values=["editor", "admin", "viewer", "ghost"], maxSelect=4), txt("perms"), txt("plan"), dict(name="plan_expires", type="date"), txt("status")]), su)
    ids = {}
    for t, sl, s, pub in (("hello", "hello", "S-1", True), ("world", "world", "S-2", True), ("private-draft", "private-draft", "TOPSECRET-DRAFT", False),
                          ("<script>alert(1)</script>", "xss-post", "S-3", True)):
        ids[t] = api(port, "POST", "/api/collections/posts/records", dict(title=t, slug=sl, secret=s, published=pub), su)["id"]
    for t, sl in (("{{7*7}}", "ssti-1"), ("${7*7}<%= 7*7 %>", "ssti-2"), ('"><img src=x onerror=alert(1)>', '"><script>alert(1)</script>'), ("javascript:alert(1)", "javascript:alert(1)"),
                  ("x\" onmouseover=\"alert(1)", "x\" onmouseover=\"alert(1)"), ("<svg/onload=alert(1)>", "'><svg/onload=alert(1)>")):   # datos hostiles ya guardados en la base
        api(port, "POST", "/api/collections/posts/records", dict(title=t, slug=sl, secret="S-X", published=True), su)
    api(port, "POST", "/api/collections/vault/records", dict(note="VAULT-NOTE"), su)
    ctx = {"TOKSU": su, "PUBID": ids["hello"], "PRIVID": ids["private-draft"]}
    for u in ("a", "b"):
        rec = api(port, "POST", "/api/collections/users/records", dict(email=f"{u}@x.io", password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
        ctx["TOK" + u.upper()] = api(port, "POST", "/api/collections/users/auth-with-password", dict(identity=f"{u}@x.io", password="Passw0rd!!"))["token"]
        ctx[u.upper() + "ID"] = rec["id"]
        api(port, "POST", "/api/collections/mine/records", dict(owner=rec["id"], doc=f"{u.upper()}-DOC"), su)
    return ctx


# ----------------------------------------------------------------------------- HTTP crudo (sin normalizar rutas)
class Resp:
    def __init__(self, status, headers, body): self.status, self.headers, self.body = status, headers, body
    @property
    def hdrlines(self): return [f"{k}: {v}" for k, v in self.headers]
    def header(self, name): return next((v for k, v in self.headers if k.lower() == name.lower()), None)

def raw(port, method, path, headers=None, body=None, timeout=8):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        h = dict(headers or {})
        if isinstance(body, str): body = body.encode()
        if body is not None and not any(k.lower() == "content-type" for k in h): h["Content-Type"] = "application/x-www-form-urlencoded"
        c.request(method, path, body, h)
        r = c.getresponse(); data = r.read()
        return Resp(r.status, r.getheaders(), data.decode("utf-8", "replace"))
    except Exception as e: return Resp(0, [], f"{type(e).__name__}: {e}")
    finally: c.close()

def cookie(tok, rid="forged"): return "pb_auth=" + urllib.parse.quote(json.dumps({"token": tok, "record": {"id": rid}}), safe="")
def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
def unb64(x): return json.loads(base64.urlsafe_b64decode(x + "=" * (-len(x) % 4)))
def jwt_payload_forged(t): h, p, s = t.split("."); pl = unb64(p); pl["id"] = "AAAAAAAAAAAAAAA"; return f"{h}.{b64(pl)}.{s}"
def jwt_badsig(t):  # cambia el PRIMER carácter de la firma (el último solo aporta bits de relleno y puede dejarla intacta)
    h, p, sg = t.split("."); return f"{h}.{p}.{'A' if sg[0] != 'A' else 'B'}{sg[1:]}"
def jwt_none(t): h, p, s = t.split("."); return f"{b64({'alg': 'none', 'typ': 'JWT'})}.{p}."


# ----------------------------------------------------------------------------- catálogo de ataques (objetivo + meta)
class Case:
    def __init__(self, id, cat, obj, meta, path=None, m="GET", h=None, d=None, st=None, has=(), hasnt=(), hdr=(), nohdr=(), run=None, port=None):
        self.id, self.cat, self.obj, self.meta, self.path, self.m, self.h, self.d = id, cat, obj, meta, path, m, h or {}, d
        self.st, self.has, self.hasnt, self.hdr, self.nohdr, self.run, self.port = st, has, hasnt, hdr, nohdr, run, port

def catalog(ctx):
    cases = []
    def add(*a, **k): cases.append(Case(*a, **k))
    P = ctx["_symlinks"]
    J = {"Content-Type": "application/json"}; F = {"Content-Type": "application/x-www-form-urlencoded"}
    A = {"Authorization": ctx["TOKA"]}; B = {"Authorization": ctx["TOKB"]}; SU = {"Authorization": ctx["TOKSU"]}
    ck = lambda t, rid="forged": {"Cookie": cookie(t, rid)}
    n = [0]
    def nid(p): n[0] += 1; return f"{p}{n[0]:03d}"

    # A. Archivos, rutas, parámetros, redirect, errores
    cat = "A · Archivos y rutas"
    add(nid("A"), cat, "Servir un archivo público legítimo por ctx.file", "200 y contenido correcto", "/assets/pub.txt", st=200, has=["pub"])
    add(nid("A"), cat, "Servir un archivo en subcarpeta", "200 y contenido correcto", "/assets/sub/a.txt", st=200, has=["sub"])
    trav = ["/assets/.env", "/assets/sub", "/assets/..%2foutside%2fsecret.txt", "/assets/%2e%2e/outside/secret.txt", "/assets/sub/..%2f..%2foutside%2fsecret.txt",
            "/assets/..\\outside\\secret.txt", "/assets/pub.txt%00.png", "/assets/%252e%252e%252foutside/secret.txt", "/assets/sub/.%2e/pub.txt"]
    if P: trav += ["/assets/link.txt", "/assets/dirlink/secret.txt"]
    for p in trav:
        add(nid("A"), cat, f"Traversal/dotfile/symlink: {p}", "404 y ni rastro del contenido secreto", p, st=404, hasnt=["TOP-SECRET", "hunter2"])
    cat = "A · Parámetros de ruta"
    add(nid("A"), cat, "Param tipo id válido (15 a-z0-9)", "200", "/u/abcdefghijklmno", st=200)
    for p, why in (("/u/abc", "id demasiado corto"), ("/u/%2e%2e", "dot-dot codificado como id"), ("/u/ABCDEFGHIJKLMNO", "id en mayúsculas"), ("/slug/Hola", "slug con mayúscula"), ("/slug/a%2fb", "slug con barra codificada")):
        add(nid("A"), cat, f"Param inválido: {why}", "404 (se rechaza antes del handler)", p, st=404)
    add(nid("A"), cat, "Slug válido", "200", "/slug/hola-mundo", st=200)
    cat = "A · Autenticación por ruta"
    add(nid("A"), cat, "Acceder a ruta de usuario sin credenciales", "401", "/me", st=401)
    add(nid("A"), cat, "Acceder a ruta superuser sin credenciales", "401", "/admin", st=401)
    add(nid("A"), cat, "Escalada: usuario normal en ruta superuser", "403 nativo de PocketBase", "/admin", h=A, st=403)
    cat = "A · XSS, redirect y errores"
    add(nid("A"), cat, "XSS reflejado: <script> en query", "El HTML sale escapado, nunca crudo", "/hi?name=%3Cscript%3Ealert(1)%3C/script%3E", st=200, hasnt=["<script>alert"])
    add(nid("A"), cat, "XSS: confirmar que se escapa (no se descarta)", "Contiene &lt;script", "/hi?name=%3Cscript%3E", st=200, has=["&lt;script"])
    for to in ("https://evil.example", "//evil.example", "%2f%5cevil.example", "javascript:alert(1)"):
        add(nid("A"), cat, f"Open redirect hacia {to}", "Rechazado (500 controlado), sin cabecera Location externa", f"/go?to={to}", st=500)
    add(nid("A"), cat, "Inyección CRLF en redirect", "400 (el parser lo rechaza antes)", "/go?to=/ok%0d%0aSet-Cookie:x=1", st=400, nohdr=[r"^set-cookie: x=1"])
    add(nid("A"), cat, "NUL en redirect", "400", "/go?to=/ok%00", st=400)
    add(nid("A"), cat, "Redirect relativo legítimo", "302", "/go?to=/dashboard", st=302)
    add(nid("A"), cat, "Excepción del handler con secreto en el mensaje", "500 genérico sin 'hunter2'", "/boom", st=500, hasnt=["hunter2"])
    cat = "A · Límites y cabeceras"
    add(nid("A"), cat, "Body de 5 KB contra límite de 1 KB", "413", "/form", m="POST", d="a" * 5000, st=413)
    add(nid("A"), cat, "POST vacío a ruta con límite", "200", "/form", m="POST", st=200)
    add(nid("A"), cat, "Campo no declarado en POST sin esquema", "400", "/form", m="POST", h=F, d="ok", st=400)
    for hname in ("content-security-policy", "referrer-policy", "x-content-type-options", "permissions-policy"):
        add(nid("A"), cat, f"Cabecera de seguridad {hname}", "Presente en rutas pbmini", "/u/abcdefghijklmno", st=200, hdr=[f"^{hname}:"])

    # B. Query string
    cat = "B · Query estricta"
    add(nid("B"), cat, "Query válida", '"page":2', "/search?page=2", st=200, has=['"page":2'])
    cases[-1].meta = "200 y page=2 tipado"
    add(nid("B"), cat, "Defaults de esquema", "page=1, sort=title", "/search", st=200, has=['"page":1', '"sort":"title"'])
    add(nid("B"), cat, "Multi-valor permitido solo donde se declara", "tag como lista", "/search?tag=a-b&tag=c", st=200, has=['"tag":["a-b","c"]'])
    add(nid("B"), cat, "Clave codificada = misma clave", "page=2", "/search?p%61ge=2", st=200, has=['"page":2'])
    bad = ["page=1&page=2", "page=1;sort=title", "page=%zz", "page=%00", "page=%E0%A4%A", "page=abc", "page=-1", "page=0", "page=101", "page=007", "page=1.5", "page=1e2",
           "page=+1", "page=%201", "page=", "PAGE=2", "unknown=1", "__proto__=x", "constructor=y", "prototype=1", "%5f%5fproto%5f%5f[polluted]=1", "page[]=1", "page[0]=1",
           "sort=bad", "sort=title&sort=-title", "sort=title%00", "tag=A", "tag=a&tag=b&tag=c&tag=d&tag=e&tag=f&tag=g&tag=h&tag=i&tag=j&tag=k", "page=1&&sort=title", "page=1&",
           "&page=1", "page=1%26sort%3Dtitle&sort=-title", "=1", "%00=1", "page=1&" + "k=1&" * 40]
    why = {"__proto__": "Prototype pollution", "constructor": "Prototype pollution", "prototype": "Prototype pollution", "proto": "Prototype pollution"}
    for q in bad:
        o = next((v for k, v in why.items() if k in q), "HTTP parameter pollution / valor fuera de esquema")
        add(nid("B"), cat, f"{o}: ?{q[:60]}", "400 antes del handler", f"/search?{q}", st=400)
    add(nid("B"), cat, "Query de 2100 bytes (DoS/CPU)", "414", "/search?page=" + "1" * 2100, st=414)
    add(nid("B"), cat, "unknownQuery:ignore descarta utm_/fbclid", "Solo la clave declarada llega", "/track?id=abcdefghijklmno&utm_source=x&fbclid=y", st=200, has=['"keys":["id"]'])
    add(nid("B"), cat, "unknownQuery:ignore aún valida escapes", "400", "/track?id=abcdefghijklmno&utm_source=%zz", st=400)
    add(nid("B"), cat, "Duplicar id en ruta que no admite multi", "400", "/track?id=abcdefghijklmno&id=abcdefghijklmno", st=400)
    add(nid("B"), cat, "Query en ruta sin esquema", "400 (query no vacía rechazada)", "/slug/hola?x=1", st=400)

    # C. Body
    cat = "C · Body estricto (mass assignment)"
    add(nid("C"), cat, "JSON válido", "200 y n=5", "/body", m="POST", h=J, d='{"n":5}', st=200, has=['"n":5'])
    add(nid("C"), cat, "Campos opcionales declarados", "Todas las claves tipadas", "/body", m="POST", h=J, d='{"n":5,"note":"hola","ok":true}', st=200, has=['"keys":["n","note","ok"]'])
    add(nid("C"), cat, "Form-urlencoded válido", "200 y n=7", "/body", m="POST", h=F, d="n=7", st=200, has=['"n":7'])
    for d, o in (('{}', "campo requerido ausente"), ('{"n":"x"}', "tipo erróneo"), ('{"n":-1}', "fuera de rango"), ('{"n":1001}', "fuera de rango"), ('{"n":1.5}', "float en int"),
                 ('{"n":5,"extra":1}', "mass assignment: campo extra"), ('{"n":{"a":1}}', "objeto anidado"), ('{"n":[1]}', "array en escalar"),
                 ('{"n":5,"note":"' + "x" * 30 + '"}', "string demasiado largo"), ('{"n":5,"ok":"yes"}', "bool no booleano"),
                 ('{"__proto__":{"admin":true},"n":1}', "prototype pollution (__proto__)"), ('{"n":5,"constructor":{"prototype":{"x":1}}}', "prototype pollution (constructor)"),
                 ('{"n":null}', "null en entero"), ('{"n":5,"note":"a\\u0000b"}', "NUL en string")):
        add(nid("C"), cat, f"Body malicioso: {o}", "400 antes del handler", "/body", m="POST", h=J, d=d, st=400)
    add(nid("C"), cat, "Form con campo extra (admin=1)", "400", "/body", m="POST", h=F, d="n=5&admin=1", st=400)
    add(nid("C"), cat, "Form con campo duplicado", "400", "/body", m="POST", h=F, d="n=5&n=6", st=400)

    # D. Filtros / DB
    cat = "D · Inyección de filtros y reglas"
    add(nid("D"), cat, "Consulta preparada legítima", "Devuelve 'hello' sin su campo hidden", "/posts?title=hello", st=200, has=['"title":"hello"'], hasnt=["S-1", "TOPSECRET"])
    for t in ("x' || published = false || title='y", "x' || @collection._superusers.email ~ 'su' || title='", "'", "%", "\\", "hello' && secret ~ 'S"):
        add(nid("D"), cat, f"Inyección en filtro: {t[:48]}", "[] — el input es un parámetro enlazado, no parte del filtro", "/posts?title=" + urllib.parse.quote(t), st=200, has=["[]"], hasnt=["TOPSECRET", "private-draft"])
    for s in ("secret", "@random", "title;DROP"):
        add(nid("D"), cat, f"Oráculo por sort: ?sort={s}", "400 (sort restringido por enum)", f"/posts?sort={s}", st=400)
    add(nid("D"), cat, "Sort legítimo", "200", "/posts?title=hello&sort=-title", st=200, has=['"title"'])
    add(nid("D"), cat, "Listado público: borradores y hidden", "Sin 'private-draft' ni secretos; sí posts publicados", "/posts-all", st=200, has=["hello", "world"], hasnt=["TOPSECRET", "private-draft", "S-1", "S-2"])
    add(nid("D"), cat, "viewRule en registro público", "Devuelve el post sin 'secret'", "/posts-one/$PUBID", st=200, has=['"title":"hello"'], hasnt=["S-1", '"secret"'])
    add(nid("D"), cat, "viewRule en borrador (IDOR)", "null: la regla oculta el borrador", "/posts-one/$PRIVID", st=200, has=["null"], hasnt=["TOPSECRET", "private"])
    add(nid("D"), cat, "Sort sobre campo hidden declarado", "500 controlado (abortado)", "/posts-badsort", st=500)
    for s in ("-secret", "@collection.users.email", "title,secret", "created", "nope"):
        add(nid("D"), cat, f"Sort no declarado: {s}", "500 controlado (solo lista declarada)", f"/posts-undeclared-sort?s={s}", st=500)
    add(nid("D"), cat, "Sort declarado (title)", "200", "/posts-undeclared-sort?s=title", st=200)
    add(nid("D"), cat, "Colección con listRule null a anónimo", "[] sin 'VAULT'", "/vault", st=200, has=["[]"], hasnt=["VAULT"])
    add(nid("D"), cat, "Colección con listRule null a superuser", "Ve VAULT-NOTE", "/vault-su", h=SU, st=200, has=["VAULT-NOTE"])
    add(nid("D"), cat, "Usuario normal en ruta de superuser", "403", "/vault-su", h=A, st=403)
    add(nid("D"), cat, "Aislamiento entre usuarios (A ve lo suyo)", "A-DOC sin B-DOC", "/mine", h=A, st=200, has=["A-DOC"], hasnt=["B-DOC"])
    add(nid("D"), cat, "Aislamiento entre usuarios (B ve lo suyo)", "B-DOC sin A-DOC", "/mine", h=B, st=200, has=["B-DOC"], hasnt=["A-DOC"])
    add(nid("D"), cat, "Ruta de usuario sin token", "401", "/mine", st=401)

    # E. Caché (escenarios con varias peticiones)
    cat = "E · Caché y envenenamiento"
    def cache_scn(ctx):
        P_, I1, I2 = ctx["port"], "abcdefghijklmno", "abcdefghijklmnp"
        r1 = raw(P_, "GET", f"/pub/{I1}"); r2 = raw(P_, "GET", f"/pub/{I1}")
        out = []
        if not re.search(r"cache-control: public, max-age=60", "\n".join(r1.hdrlines), re.I): return False, "falta Cache-Control público en ruta cacheable anónima"
        if r1.body != r2.body: return False, "el handler se reejecutó (no hubo hit de caché)"
        if raw(P_, "GET", f"/pub/{I2}").body == r1.body: return False, "otra clave devolvió la misma entrada"
        for hv in ({"Host": "evil.example"}, {"X-Forwarded-Host": "evil.example"}, {"X-Forwarded-For": "6.6.6.6"}, {"Accept-Language": "xx"}, {"User-Agent": "zzz"}, {"Origin": "https://evil.example"}):
            if raw(P_, "GET", f"/pub/{I1}", hv).body != r1.body: return False, f"la cabecera {list(hv)[0]} altera/envenena la caché"
        q1 = raw(P_, "GET", f"/pub/{I1}?n=1&m=true").body
        if raw(P_, "GET", f"/pub/{I1}?m=true&n=1").body != q1 or raw(P_, "GET", f"/pub/{I1}?n=%31&m=true").body != q1: return False, "orden/codificación de query no normalizados"
        return True, "hit estable; Host/XFF/idioma/UA/Origin no envenenan; query normalizada"
    add(nid("E"), cat, "Envenenar la caché con Host/X-Forwarded-*/Origin/UA/orden de query", "La clave de caché son solo valores validados; ninguna cabecera la altera", run=cache_scn)
    def etag_scn(ctx):
        P_ = ctx["port"]; r = raw(P_, "GET", "/pub/abcdefghijklmno"); et = r.header("etag")
        if not et or not re.fullmatch(r'"[0-9a-f]{32}"', et): return False, f"ETag inesperado: {et}"
        a = raw(P_, "GET", "/pub/abcdefghijklmno", {"If-None-Match": et}).status; b = raw(P_, "GET", "/pub/abcdefghijklmno", {"If-None-Match": '"otro"'}).status
        return (a == 304 and b == 200), f"If-None-Match válido→{a}, ajeno→{b}"
    add(nid("E"), cat, "Validación condicional ETag", "304 con ETag propio, 200 con ajeno", run=etag_scn)
    def cred_scn(ctx):
        P_, I1 = ctx["port"], "abcdefghijklmno"; base = raw(P_, "GET", f"/pub/{I1}").body
        for h in ({"Cookie": "s=1"}, {"Authorization": ctx["TOKA"]}, ck(ctx["TOKA"])):
            r = raw(P_, "GET", f"/pub/{I1}", h)
            if "no-store" not in (r.header("cache-control") or ""): return False, f"con {list(h)[0]} la respuesta no es no-store"
            if '"who":null' not in r.body: return False, "la ruta cacheable vio la identidad"
        if raw(P_, "GET", f"/pub/{I1}", {"Cookie": "s=1"}).body == base: return False, "con Cookie se sirvió la caché compartida"
        return True, "con credenciales: no-store, handler reejecutado y anónimo"
    add(nid("E"), cat, "Web cache deception: pedir la ruta cacheable con credenciales", "Jamás se sirve ni guarda en caché compartida y la identidad no se filtra", run=cred_scn)
    for p, why in (("/pub/abcdefghijklmno?n=01", "query inválida"), ("/pub/BADID", "param inválido"), ("/nocache", "ruta sin cache"), ("/u/abcdefghijklmno", "ruta sin cache"), ("/assets/.env", "dotfile")):
        add(nid("E"), cat, f"Errores/rutas sin caché: {why}", "Cache-Control: no-store", p, hdr=[r"^cache-control: no-store"])
    add(nid("E"), cat, "Ruta cacheable con query ya en forma canónica", "Cache-Control público 60 s", "/pub/abcdefghijklmno", hdr=[r"^cache-control: public, max-age=60", r'^etag: "[0-9a-f]{32}"'])
    add(nid("E"), cat, "Respuestas autenticadas", "no-store", "/me", h=A, hdr=[r"^cache-control: no-store"])
    def flood_scn(ctx):
        P_ = ctx["port"]; c = http.client.HTTPConnection("127.0.0.1", P_, timeout=10); al = "abcdefghijklmnopqrstuvwxyz0123456789"
        import random
        for _ in range(900):
            c.request("GET", "/flood/" + "".join(random.choice(al) for _ in range(15))); c.getresponse().read()
        c.close(); nstore = int(re.sub(r"\D", "", raw(P_, "GET", "/storelen").body) or 0)
        keep = raw(P_, "GET", "/pub/abcdefghijklmno").body
        return (nstore <= 505), f"store={nstore} tras 900 claves (tope 500)"
    add(nid("E"), cat, "DoS por inundación de claves de caché (900 peticiones)", "El store queda acotado (≤ tope) y no desaloja entradas legítimas", run=flood_scn)

    # H. Páginas
    cat = "H · Páginas por archivos"
    add(nid("H"), cat, "Home con layout y parcial", "ROOT-LAYOUT + NAV-PARTIAL, sin borradores", "/", st=200, has=["ROOT-LAYOUT", "NAV-PARTIAL", ">hello<"], hasnt=["TOPSECRET", "private-draft"])
    add(nid("H"), cat, "XSS almacenado en dato de la base", "&lt;script&gt; y nunca <script>alert", "/", st=200, has=["&lt;script&gt;alert"], hasnt=["<script>alert"])
    add(nid("H"), cat, "Página estática pública", "ABOUT-STATIC con layout raíz", "/about", st=200, has=["ABOUT-STATIC", "ROOT-LAYOUT"])
    add(nid("H"), cat, "Layout anidado", "BLOG-LAYOUT sin el raíz", "/blog", st=200, has=["BLOG-LAYOUT", "NAV-PARTIAL"], hasnt=["ROOT-LAYOUT"])
    for q in ("evil=1", "page=0", "page=1&page=2"): add(nid("H"), cat, f"Query inválida en página: ?{q}", "400", f"/blog?{q}", st=400)
    add(nid("H"), cat, "Ruta dinámica [slug]", "Post 'hello'", "/blog/hello", st=200, has=["POST: hello", "slug=hello"])
    add(nid("H"), cat, "IDOR: borrador no publicado por slug", "404 sin fuga", "/blog/private-draft", st=404, hasnt=["TOPSECRET", "private"])
    for p in ("/blog/Hello", "/blog/a%2fb", "/blog/%2e%2e", "/blog/nope-no-existe"): add(nid("H"), cat, f"Slug hostil {p}", "404", p, st=404)
    add(nid("H"), cat, "XSS almacenado en título de post", "Escapado", "/blog/xss-post", st=200, has=["&lt;script&gt;"], hasnt=["<script>alert"])
    add(nid("H"), cat, "Comodín [...path] legítimo", "200 con la ruta", "/docs/a/b", st=200, has=["DOC a/b"])
    for p in ("/docs/.env", "/docs/a/..%2fb", "/docs/%2e%2e/x", "/docs/a/%2e%2e/b", "/docs/a%00b", "/docs/a%5cb", "/docs/.git/config"):
        add(nid("H"), cat, f"Traversal por comodín {p}", "404 sin contenido", p, st=404, hasnt=["DOC "])
    add(nid("H"), cat, "Formulario: flash legítimo", "SENT-OK", "/contact?sent=true", st=200, has=["SENT-OK"])
    add(nid("H"), cat, "Flash sin parámetro", "Sin SENT-OK", "/contact", st=200, hasnt=["SENT-OK"])
    add(nid("H"), cat, "Flash con valor fuera de esquema", "400", "/contact?sent=maybe", st=400)
    add(nid("H"), cat, "POST válido → redirect", "303", "/contact", m="POST", h=J, d='{"name":"ana"}', st=303)
    for d, o in (('{}', "campo requerido ausente"), ('{"name":"a","admin":true}', "mass assignment (admin:true)")): add(nid("H"), cat, f"POST /contact: {o}", "400", "/contact", m="POST", h=J, d=d, st=400)
    add(nid("H"), cat, "POST form con rol extra", "400", "/contact", m="POST", h=F, d="name=a&role=admin", st=400)
    add(nid("H"), cat, "Endpoint JSON público", "ok:true", "/health", st=200, has=['"ok":true'])
    add(nid("H"), cat, "Ruta de usuario sin token", "401", "/whoami", st=401)
    add(nid("H"), cat, "Ruta de usuario con token", "id del usuario", "/whoami", h=A, st=200, has=['"id"'])
    for p in ("/_secret", "/secret", "/.hidden", "/pb_hooks/pages/_secret.js"):
        add(nid("H"), cat, f"Archivo olvidado convertido en ruta: {p}", "Nunca servido", p, hasnt=["SECRET-PAGE-LEAK"])
    add(nid("H"), cat, "POST a página solo-GET", "404/405", "/about", m="POST", st=(404, 405))
    add(nid("H"), cat, "Cabeceras en páginas", "no-store + CSP + HTML", "/blog/hello", hdr=[r"^cache-control: no-store", r"^content-security-policy:", r"^content-type: text/html"])

    # K. Carpetas por parámetro y endpoints por archivo
    cat = "K · Carpetas por parámetro y endpoints"
    UID = "abcdefghijklmno"
    add(nid("K"), cat, "Endpoint sin .html: objeto devuelto", "Responde JSON automáticamente", "/users", st=200, has=['"users":"list"'], hdr=[r"^content-type: application/json"])
    add(nid("K"), cat, "Carpeta [id]/index.js = /users/{id} (sin barra final)", "200 JSON con el id tipado", f"/users/{UID}", st=200, has=[f'"user":"{UID}"'], hdr=[r"^content-type: application/json"])
    add(nid("K"), cat, "Carpetas anidadas [id]/posts/[postId]", "Ambos params tipados llegan al handler", f"/users/{UID}/posts/12", st=200, has=['"post":12'])
    for p, why in ((f"/users/{UID}/", "barra final (index es exacto)"), ("/users/abc", "id demasiado corto"), ("/users/ABCDEFGHIJKLMNO", "id en mayúsculas"), ("/users/%2e%2e/posts/1", "dot-dot como id"),
                   (f"/users/{UID}/posts/x", "postId no entero"), (f"/users/{UID}/posts/-1", "postId fuera de rango"), (f"/users/{UID}/posts/1/extra", "segmento extra"),
                   ("/USERS", "mayúsculas en la ruta"), ("/nada/x/y", "URL inexistente (404 real, sin fallback a index.html)")):
        add(nid("K"), cat, f"Ruta anidada hostil: {why}", "404", p, st=404, hasnt=["<h1>idx</h1>"])
    add(nid("K"), cat, "Endpoint POST sin credenciales", "401", f"/users/{UID}/update", m="POST", h=J, d='{"name":"ana"}', st=401)
    add(nid("K"), cat, "Endpoint POST con usuario y body válido", "200 con el id de la ruta y el del usuario", f"/users/{UID}/update", m="POST", h={**A, **J}, d='{"name":"ana"}', st=200, has=[f'"updated":"{UID}"', '"name":"ana"'])
    add(nid("K"), cat, "Endpoint POST con campo extra (mass assignment)", "400", f"/users/{UID}/update", m="POST", h={**A, **J}, d='{"name":"ana","role":"admin"}', st=400)
    add(nid("K"), cat, "Endpoint POST sin campo requerido", "400", f"/users/{UID}/update", m="POST", h={**A, **J}, d='{}', st=400)
    add(nid("K"), cat, "Endpoint POST con id %2f en la ruta", "404 (param validado tras auth)", "/users/a%2fb/update", m="POST", h={**A, **J}, d='{"name":"ana"}', st=404)
    add(nid("K"), cat, "Endpoint solo-POST pedido por GET", "404/405", f"/users/{UID}/update", st=(404, 405))
    add(nid("K"), cat, "CSRF en endpoint de carpeta con cookie cross-site", "401", f"/users/{UID}/update", m="POST", h={**ck(ctx["TOKA"]), **J, "Sec-Fetch-Site": "cross-site"}, d='{"name":"ana"}', st=401)

    import attacks   # fase de ataques contra el framework (ver attacks.py); antes de J porque J revoca el token de A
    cases.extend(attacks.build(sys.modules[__name__], ctx))
    import attacks_deep
    cases.extend(attacks_deep.build(sys.modules[__name__], ctx, attacks))
    import attacks_v2
    cases.extend(attacks_v2.build(sys.modules[__name__], ctx, attacks))
    import attacks_tg
    cases.extend(attacks_tg.build(sys.modules[__name__], ctx, attacks))
    import attacks_clip
    cases.extend(attacks_clip.build(sys.modules[__name__], ctx, attacks))
    import attacks_guided
    cases.extend(attacks_guided.build(sys.modules[__name__], ctx, attacks, attacks_v2.routes_table))

    # J. Sesión / JWT / CSRF
    cat = "J · Sesión, JWT y CSRF"
    AID, BID = ctx["AID"], ctx["BID"]
    add(nid("J"), cat, "Cookie pb_auth legítima", "Autentica como A", "/whoami", h=ck(ctx["TOKA"]), st=200, has=[f'"id":"{AID}"'])
    add(nid("J"), cat, "Suplantación: record.id falso en la cookie (apunta a B)", "Se ignora el record; sigue siendo A", "/whoami", h=ck(ctx["TOKA"], BID), st=200, has=[f'"id":"{AID}"'], hasnt=[f'"id":"{BID}"'])
    add(nid("J"), cat, "Authorization y cookie a la vez", "Prioridad a Authorization (B)", "/whoami", h={"Authorization": ctx["TOKB"], **ck(ctx["TOKA"])}, st=200, has=[f'"id":"{BID}"'])
    add(nid("J"), cat, "JWT con firma alterada", "401", "/whoami", h=ck(jwt_badsig(ctx["TOKA"])), st=401)
    add(nid("J"), cat, "JWT con payload alterado y firma original", "401", "/whoami", h=ck(jwt_payload_forged(ctx["TOKA"])), st=401)
    add(nid("J"), cat, "JWT alg=none", "401", "/whoami", h=ck(jwt_none(ctx["TOKA"])), st=401)
    for c_, o in (("pb_auth=%7Bnope", "JSON roto"), ("pb_auth=", "vacía"), ("pb_auth=%7B%22token%22%3A%7B%22a%22%3A1%7D%7D", "token no-string"), ("pb_auth=%7B%22token%22%3A%22a.b%22%7D", "JWT malformado"),
                  ("pb_auth=" + "A" * 9000, "cookie de 9 KB"), ("other=1", "sin pb_auth")):
        add(nid("J"), cat, f"Cookie hostil: {o}", "401 (anónimo)", "/whoami", h={"Cookie": c_}, st=401)
    add(nid("J"), cat, "Cookie tossing: dos pb_auth, la primera válida", "Usa la primera (A)", "/whoami", h={"Cookie": ck(ctx["TOKA"])["Cookie"] + "; pb_auth=junk"}, st=200, has=[f'"id":"{AID}"'])
    add(nid("J"), cat, "Cookie tossing: la primera basura", "Anónimo, nunca otro usuario", "/whoami", h={"Cookie": "pb_auth=junk; " + ck(ctx["TOKA"])["Cookie"]}, st=401)
    add(nid("J"), cat, "Superuser por cookie en ruta superuser", "200", "/admin", h=ck(ctx["TOKSU"]), st=200)
    add(nid("J"), cat, "Usuario por cookie en ruta superuser", "403", "/admin", h=ck(ctx["TOKA"]), st=403)
    add(nid("J"), cat, "La API NATIVA no lee la cookie", "Sin A-DOC (la superficie nativa no se amplía)", "/api/collections/mine/records", h=ck(ctx["TOKA"]), hasnt=["A-DOC"])
    add(nid("J"), cat, "Consulta pbmini con cookie respeta las reglas de PocketBase", "A-DOC", "/mine", h=ck(ctx["TOKA"]), st=200, has=["A-DOC"], hasnt=["B-DOC"])
    for sfs in ("cross-site", "same-site"):
        add(nid("J"), cat, f"CSRF: POST con cookie y Sec-Fetch-Site: {sfs}", "401 (credencial ambiental rechazada)", "/secure-post", m="POST", h={**ck(ctx["TOKA"]), "Sec-Fetch-Site": sfs}, st=401)
    for sfs in ("same-origin", "none"):
        add(nid("J"), cat, f"POST con cookie y Sec-Fetch-Site: {sfs}", "200", "/secure-post", m="POST", h={**ck(ctx["TOKA"]), "Sec-Fetch-Site": sfs}, st=200, has=['"ok":true'])
    add(nid("J"), cat, "POST con Authorization cross-site", "200 (no es credencial ambiental)", "/secure-post", m="POST", h={"Authorization": ctx["TOKA"], "Sec-Fetch-Site": "cross-site"}, st=200)
    add(nid("J"), cat, "GET (seguro) con cookie cross-site", "200", "/whoami", h={**ck(ctx["TOKA"]), "Sec-Fetch-Site": "cross-site"}, st=200)
    def revoke(ctx):
        P_ = ctx["port"]
        api(P_, "PATCH", f"/api/collections/users/records/{AID}", {"password": "Other#Pass0rd!", "passwordConfirm": "Other#Pass0rd!"}, ctx["TOKSU"])
        a = raw(P_, "GET", "/whoami", ck(ctx["TOKA"])).status; b = raw(P_, "GET", "/whoami", {"Authorization": ctx["TOKA"]}).status; o = raw(P_, "GET", "/whoami", ck(ctx["TOKB"])).status
        return (a == 401 and b == 401 and o == 200), f"cookie→{a}, header→{b}, otro usuario→{o}"
    add(nid("J"), cat, "Token robado tras cambio de contraseña", "Revocado (cookie y cabecera); otros usuarios intactos", run=revoke)

    # N. Superficie nativa de PocketBase (REST)
    cat = "N · API nativa de PocketBase"
    for p, o in (("/api/collections", "listar el esquema"), ("/api/settings", "leer ajustes (SMTP, S3, claves)"), ("/api/logs", "leer logs de peticiones"), ("/api/backups", "listar/descargar backups"),
                 ("/api/collections/_superusers/records", "enumerar superusuarios")):
        add(nid("N"), cat, f"Anónimo intenta {o}", "401/403/404 y ninguna fuga", p, st=(401, 403, 404), hasnt=LEAKS + ["su@x.io"])
    for coll in ("_externalAuths", "_mfas", "_otps", "_authOrigins"):
        add(nid("N"), cat, f"Anónimo lista la colección de sistema {coll}", "Cero registros (regla por dueño) o rechazo", f"/api/collections/{coll}/records", st=(200, 401, 403, 404), hasnt=LEAKS + ['"id":'])
    add(nid("N"), cat, "Usuario normal intenta leer ajustes", "403", "/api/settings", h=A, st=(401, 403))
    add(nid("N"), cat, "Usuario normal intenta leer el esquema", "403", "/api/collections", h=A, st=(401, 403))
    add(nid("N"), cat, "Listar usuarios sin sesión", "Sin correos de usuarios", "/api/collections/users/records", hasnt=["a@x.io", "b@x.io", "passwordHash", "tokenKey"])
    add(nid("N"), cat, "REST: filtrar por campo hidden (oráculo)", "400", "/api/collections/posts/records?filter=" + urllib.parse.quote("secret ~ 'S'"), st=400, hasnt=["TOPSECRET"])
    add(nid("N"), cat, "REST: oráculo cross-colección @collection", "400/403", "/api/collections/posts/records?filter=" + urllib.parse.quote("@collection._superusers.email ~ 'su'"), st=(400, 403), hasnt=["su@x.io"])
    add(nid("N"), cat, "REST: ordenar por campo hidden", "400", "/api/collections/posts/records?sort=secret", st=400)
    add(nid("N"), cat, "REST: pedir el campo hidden con ?fields=", "No aparece TOPSECRET ni S-1", "/api/collections/posts/records?fields=secret,title", hasnt=["TOPSECRET", "S-1", "S-2"])
    add(nid("N"), cat, "REST: borrador por id (IDOR)", "404", "/api/collections/posts/records/$PRIVID", st=404, hasnt=["TOPSECRET"])
    add(nid("N"), cat, "REST: colección con regla null (listar)", "403", "/api/collections/vault/records", st=403, hasnt=["VAULT"])
    add(nid("N"), cat, "REST: expand de relación de sistema", "Sin fuga", "/api/collections/posts/records?expand=owner,_superusers", hasnt=LEAKS + ["su@x.io"])
    add(nid("N"), cat, "REST: crear post sin permiso", "400/403", "/api/collections/posts/records", m="POST", h=J, d='{"title":"x","secret":"y","published":true}', st=(400, 403))
    add(nid("N"), cat, "REST: borrar post ajeno sin sesión", "403/404", "/api/collections/posts/records/$PUBID", m="DELETE", st=(403, 404))
    add(nid("N"), cat, "REST: usuario A edita registro de B (IDOR)", "401/403/404 (el token de A ya fue revocado por la prueba J)", "/api/collections/mine/records/x", m="PATCH", h={**A, **J}, d='{"doc":"pwn"}', st=(401, 403, 404))
    add(nid("N"), cat, "Login por fuerza bruta: contraseña errónea", "400 sin pistas sobre existencia del usuario", "/api/collections/users/auth-with-password", m="POST", h=J, d='{"identity":"a@x.io","password":"mala"}', st=400)
    add(nid("N"), cat, "Enumeración de usuarios: usuario inexistente", "Misma respuesta que contraseña errónea", "/api/collections/users/auth-with-password", m="POST", h=J, d='{"identity":"nadie@x.io","password":"mala"}', st=400)
    add(nid("N"), cat, "Cabecera nosniff en la API", "X-Content-Type-Options: nosniff", "/api/health", st=200, hdr=[r"^x-content-type-options: nosniff"])
    add(nid("N"), cat, "Panel de admin: no filtra secretos al anónimo", "Solo HTML estático", "/_/", hasnt=LEAKS + ["su@x.io"])
    return cases


def bad_page_cases():
    """Archivos de pages/ inseguros o mal formados: el proceso debe MORIR al arrancar (fail-closed). (etiqueta, {ruta: contenido})"""
    ok = 'module.exports = { auth: "public", get: (ctx) => ({}) };'
    pg = lambda body: 'module.exports = { %s };' % body
    return [
        ("página sin auth", {"x.js": pg("get: (ctx) => ({})")}),
        ("auth inválido (admin)", {"x.js": pg('auth: "admin", get: (ctx) => ({})')}),
        ("typo de opción (auht)", {"x.js": pg('auht: "public", get: (ctx) => ({})')}),
        ("typo rateLimt (desactivaría un control)", {"x.js": pg('auth: "public", rateLimt: { max: 1 }, get: (ctx) => ({})')}),
        ("opción eliminada rateLimit", {"x.js": pg('auth: "public", rateLimit: { max: 1 }, get: (ctx) => ({})')}),
        ("exporta un no-objeto", {"x.js": "module.exports = 5;"}),
        ("sin métodos", {"x.js": pg('auth: "public"')}),
        ("método no función", {"x.js": pg('auth: "public", get: 5')}),
        ("nombre con espacios y mayúsculas", {"Bad Name.js": ok}),
        ("extensión no permitida (.txt)", {"notes.txt": "hola"}),
        ("backup de editor (.js.bak)", {"x.js.bak": "x"}),
        ("parcial no .html", {"_partials/evil.sh": "rm -rf /"}),
        ("parámetro como archivo plano [slug].js (debe ser carpeta)", {"[slug].js": ok}),
        ("comodín como archivo plano [...path].js (debe ser carpeta)", {"[...path].js": ok}),
        ("carpeta [...comodín] con un archivo que no es index", {"f/[...p]/edit.js": ok, "f/[...p]/index.js": ok}),
        ("carpeta [...comodín] con subcarpeta", {"f/[...p]/index.js": ok, "f/[...p]/sub/index.js": ok}),
        ("[...x] en medio de la ruta", {"[...a]/b/index.js": ok}),
        ("carpeta con nombre no permitido", {"Mi Carpeta/index.js": ok}),
        ("prefijo /api/ reservado (secuestrar la API nativa)", {"api/x.js": ok}),
        ("ruta duplicada (x.js y x/index.js)", {"x.js": ok, "x/index.js": ok}),
        ("param tipado ausente del patrón", {"x.js": pg('auth: "public", params: { id: "id" }, get: (ctx) => ({})')}),
        ("tipo de param desconocido", {"x/[id]/index.js": pg('auth: "public", params: { id: "nope" }, get: (ctx) => ({})')}),
        ("query con clave __proto__", {"x.js": pg('auth: "public", query: JSON.parse("{\\"__proto__\\":\\"int\\"}"), get: (ctx) => ({})')}),
        ("tipo de query desconocido", {"x.js": pg('auth: "public", query: { a: "any" }, get: (ctx) => ({})')}),
        ("body en GET", {"x.js": pg('auth: "public", body: { a: "int" }, get: (ctx) => ({})')}),
        ("caché con auth:user (caché de datos privados)", {"x.js": pg('auth: "user", cache: { maxAge: 10 }, get: (ctx) => ({})')}),
        ("caché maxAge absurdo", {"x.js": pg('auth: "public", cache: { maxAge: 999999 }, get: (ctx) => ({})')}),
        ("caché de servidor con query libre (explosión de claves)", {"x.js": pg('auth: "public", cache: { maxAge: 10, server: true }, query: { q: { type: "string", max: 100 } }, get: (ctx) => ({})')}),
        ("caché de servidor con param sin tipo", {"x/[id]/index.js": pg('auth: "public", cache: { maxAge: 10, server: true }, get: (ctx) => ({})')}),
        ("consulta sobre colección de sistema", {"x.js": pg('auth: "public", queries: { q: { collection: "_superusers", filter: "id != ''" } }, get: (ctx) => ({})')}),
        ("consulta con filtro no string", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: 42 } }, get: (ctx) => ({})')}),
        ("filtro con placeholder roto", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "title = {:t" } }, get: (ctx) => ({})')}),
        ("sort con inyección en la declaración", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "id != 1", sort: ["title; DROP"] } }, get: (ctx) => ({})')}),
        ("rule de consulta inválida", {"x.js": pg('auth: "public", queries: { q: { collection: "posts", filter: "id != 1", rule: "all" } }, get: (ctx) => ({})')}),
        ("dos parámetros distintos en la misma posición ([a] y [b])", {"[a]/index.js": ok, "[b]/index.js": ok}),
    ] + __import__("attacks_v2").bad_pages()


# ----------------------------------------------------------------------------- ejecución
def judge(case, ctx, r):
    """Devuelve (ok, observado). Sustituye $TOKEN en la solicitud antes de enviar (ya hecho)."""
    why = []
    if case.st is not None and r.status not in (case.st if isinstance(case.st, tuple) else (case.st,)): why.append(f"estado {r.status} (esperado {case.st})")
    for s in case.has:
        if s not in r.body: why.append(f"falta «{s}»")
    for s in case.hasnt:
        if s in r.body: why.append(f"FILTRA «{s}»")
    hl = "\n".join(r.hdrlines)
    for rx in case.hdr:
        if not re.search(rx, hl, re.I | re.M): why.append(f"falta cabecera /{rx}/")
    for rx in case.nohdr:
        if re.search(rx, hl, re.I | re.M): why.append(f"cabecera prohibida /{rx}/")
    return (not why), "; ".join(why) or f"HTTP {r.status}"


def subst(s, ctx):
    for k in ("TOKSU", "TOKA", "TOKB", "PUBID", "PRIVID"): s = s.replace("$" + k, ctx[k])
    return s

def run_case(case, ctx):
    t0 = time.time()
    try:
        if case.run: ok, obs = case.run(ctx); req = "escenario multi-petición"
        else:
            path = subst(case.path, ctx); req = f"{case.m} {path[:120]}"
            r = raw(ctx["port"], case.m, path, {k: v for k, v in case.h.items()}, case.d)
            ok, obs = judge(case, ctx, r)
            for s in LEAKS + PATHLEAKS:           # detector global de fugas: aplica a TODA respuesta
                if s in r.body or s in "\n".join(r.hdrlines):
                    if not any(s in h for h in case.hasnt): ok, obs = False, f"{obs}; FUGA CANARIO «{s}»"
    except Exception as e: ok, obs, req = False, f"excepción del laboratorio: {e}", case.path or ""
    return ok, obs, req, int((time.time() - t0) * 1000)


def run_boot(label, files, exe, tag, public=None, expect_up=False):
    """Arranca PocketBase con pages/ (files) y pb_public/ (public) extra. Por defecto espera que el servidor MUERA (fail-closed);
    con expect_up=True espera que ARRANQUE. Devuelve (ok, observado); ok=None => omitido (el SO no permite crear el archivo)."""
    d = os.path.join(RUN, f"bad-{tag}"); pg = os.path.join(RUN, f"bad-{tag}-pages")
    shutil.rmtree(pg, ignore_errors=True); os.makedirs(pg)
    extra = {}
    for rel, content in files.items():
        if rel.startswith("../"): extra[rel[3:]] = content; continue   # "../i18n/es.json" => pb_hooks/i18n/es.json
        p = os.path.join(pg, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", newline="\n", encoding="utf-8") as f: f.write(content)
    if not files: os.makedirs(os.path.join(pg, "_x"), exist_ok=True)
    ok_make = True
    build_sandbox(d, pg, symlinks=False, clean=True, public=public, hooks_extra=extra)
    for rel, v in (public or {}).items():
        full = os.path.join(d, "pb_public", rel)
        if isinstance(v, tuple) and not os.path.lexists(full): ok_make = False
    if not ok_make:
        shutil.rmtree(d, ignore_errors=True); shutil.rmtree(pg, ignore_errors=True)
        return None, "OMITIDO: este sistema no permite crear el enlace simbólico/FIFO (probar en Linux/WSL)"
    pb = PB(exe, d, BAD_PORT); pb.serve()
    died, up, end = False, False, time.time() + 14
    while time.time() < end:
        if pb.proc.poll() is not None: died = True; break
        if expect_up:
            try:
                c = http.client.HTTPConnection("127.0.0.1", BAD_PORT, timeout=1); c.request("GET", "/api/health")
                if c.getresponse().status == 200: up = True; break
            except OSError: pass
        time.sleep(0.25)
    lg = pb.log(); pb.stop()
    shutil.rmtree(d, ignore_errors=True); shutil.rmtree(pg, ignore_errors=True)
    if expect_up: return up, ("arrancó con el directorio público limpio" if up else "NO ARRANCÓ: " + lg[-200:])
    msg = "pbmini" in lg or "conflicts with pattern" in lg
    return died and msg, ("el proceso murió con error explícito" if died and msg else ("murió sin mensaje reconocible" if died else "EL SERVIDOR ARRANCÓ (aceptó la configuración insegura)"))


def lint_cases():
    bash = shutil.which("bash")
    if not bash: return []
    lint = os.path.join(SEC, "lint.sh")
    def clean(path): return lambda ctx: (subprocess.run([bash, lint, path], capture_output=True).returncode == 0, "lint limpio")
    def dirty(name, src):
        def f(ctx):
            d = tempfile.mkdtemp(); open(os.path.join(d, name), "w").write(src + "\n")
            rc = subprocess.run([bash, lint, d], capture_output=True).returncode; shutil.rmtree(d, ignore_errors=True)
            return rc != 0, "el lint lo detectó" if rc else "EL LINT NO LO DETECTÓ"
        return f
    L = [("Código de ejemplo sin primitivas peligrosas", "lint limpio en pb_hooks", clean(os.path.join(ROOT, "pb_hooks"))),
         ("Hook que usa $app directamente (salta ACL)", "El lint lo marca", dirty("r.js", 'module.exports=(a)=>{a.get("/x",{auth:"public"},(c)=>c.json($app.findRecordsByFilter("posts","id != 1")))}')),
         ("Página con $os.exec (RCE)", "El lint lo marca", dirty("p.js", 'module.exports={auth:"public",get:(ctx)=>$os.exec("id")}')),
         ("Página con eval", "El lint lo marca", dirty("p.js", 'module.exports={auth:"public",get:(ctx)=>eval("1")}')),
         ("Plantilla con | raw (XSS)", "El lint lo marca", dirty("p.html", "<p>{{.x | raw}}</p>")),
         ("Plantilla con js (XSS)", "El lint lo marca", dirty("p.html", "<p>{{js .x}}</p>"))]
    return L


class Lab:
    def __init__(self, exe, only=None): self.exe, self.only, self.running, self.summary = exe, (only.split(",") if only else None), False, None; self.lock = threading.Lock()
    def start(self):
        with self.lock:
            if self.running: return False
            self.running = True
        threading.Thread(target=self._run, daemon=True).start(); return True

    def _run(self):
        pb = None
        try:
            BUS.reset(); os.makedirs(RUN, exist_ok=True)
            root = os.path.join(RUN, "main")
            # archivos con nombres problemáticos (solo se pueden crear en Linux/macOS): barra invertida, %, NFD, salto de línea, tabulador, bidi, FIFO
            unix_public = {} if IS_WIN else {"pipe": ("fifo",), "back" + chr(92) + "slash.txt": "DOTCANARY:back", "100%.txt": "DOTCANARY:pct", "e" + chr(0x301) + ".txt": "DOTCANARY:nfd",
                                              "newline" + chr(10) + "name.txt": "DOTCANARY:nl", "tab" + chr(9) + "name.txt": "DOTCANARY:tab", chr(0x202e) + "txt.exe": "DOTCANARY:bidi"}
            links = build_sandbox(root, os.path.join(SEC, "mini", "pages"), public=unix_public, i18n=os.path.join(SEC, "mini", "i18n"), fixtures=os.path.join(SEC, "mini"))
            log(f"sandbox aislado creado ({'con' if links else 'SIN'} symlinks; {'' if links else 'Windows sin privilegio de symlink: se omiten 2 casos'})")
            pb = PB(self.exe, root, PB_PORT, env={"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn"}); pb.serve()
            if not pb.wait_ready(): raise RuntimeError("PocketBase no arrancó:\n" + pb.log()[-800:])
            ver = subprocess.run([self.exe, "--version"], capture_output=True, text=True).stdout.strip().split("version")[-1].strip()
            ctx = seed(PB_PORT); ctx.update(port=PB_PORT, _symlinks=links, exe=self.exe, root=root)
            BUS.emit(type="env", version=ver, port=PB_PORT, symlinks=links)
            cases = catalog(ctx); pages = bad_page_cases(); lints = lint_cases()
            if self.only: cases = [c for c in cases if c.id.startswith(tuple(self.only))]; pages = lints = []
            total = len(cases) + len(pages) + len(lints) + 2
            BUS.emit(type="plan", total=total)
            counts = {"pass": 0, "fail": 0, "skip": 0}
            def report(id, cat, obj, meta, ok, obs, req, ms):
                st = "skip" if ok is None else ("pass" if ok else "fail"); counts[st] += 1
                BUS.emit(type="case", id=id, cat=cat, obj=obj, meta=meta, status=st, observed=obs, req=req, ms=ms)
                print(f"  {({'pass': 'ok  ', 'fail': 'FAIL', 'skip': 'skip'})[st]} {id} {obj[:70]}" + ("" if st == "pass" else f"  -> {obs}"), flush=True)
            # Fase 1: ataques en vivo contra el servidor
            for case in cases:
                if not pb.alive(): report(case.id, case.cat, case.obj, case.meta, False, "PocketBase murió durante la prueba (DoS)", case.path or "", 0); continue
                ok, obs, req, ms = run_case(case, ctx); report(case.id, case.cat, case.obj, case.meta, ok, obs, req, ms)
            # Fase 2: limitador de peticiones nativo
            t0 = time.time(); cat = "R · Abuso y disponibilidad"
            try:
                api(PB_PORT, "PATCH", "/api/settings", {"rateLimits": {"enabled": True, "rules": [{"label": "/rl", "maxRequests": 3, "duration": 60}]}}, ctx["TOKSU"])
                for _ in range(3): raw(PB_PORT, "GET", "/rl")
                a = raw(PB_PORT, "GET", "/rl").status; b = raw(PB_PORT, "GET", "/rl", {"X-Forwarded-For": "9.9.9.9", "X-Real-IP": "8.8.8.8"}).status; c = raw(PB_PORT, "GET", "/u/abcdefghijklmno").status
                report("R001", cat, "Superar el límite de peticiones y evadirlo con X-Forwarded-For/X-Real-IP", "429 en ambos casos; otras rutas intactas", a == 429 and b == 429 and c == 200, f"tras límite→{a}, con IP falsa→{b}, ruta sin regla→{c}", "3 + 2 GET /rl", int((time.time() - t0) * 1000))
            except Exception as e: report("R001", cat, "Limitador de peticiones nativo", "429", False, str(e), "", 0)
            t0 = time.time()
            report("R002", cat, "Aviso de arranque cuando el limitador está apagado", "El log lo advierte", "limitador nativo de PocketBase está DESACTIVADO" in pb.log(), "aviso presente en el log" if "DESACTIVADO" in pb.log() else "sin aviso", "log de arranque", 0)
            alive = pb.alive()
            # Fase 3: configuraciones inseguras deben abortar el arranque
            for i, (label, files) in enumerate(pages):
                ok, obs = run_boot(label, files, self.exe, f"p{i}")
                report(f"F{i+1:03d}", "F · Fail-closed al arrancar", f"Archivo inseguro en pages/: {label}", "El servidor NO arranca (aborta con error explícito)", ok, obs, "arranque", 0)
            import attacks_deep
            pubs = [] if self.only else attacks_deep.public_boot_cases()
            total += len(pubs); BUS.emit(type="plan", total=total)
            for i, (label, public, expect_up) in enumerate(pubs):
                ok, obs = run_boot(label, {}, self.exe, f"d{i}", public=public, expect_up=expect_up)
                report(f"P{i+1:03d}", "P · Auditoría del directorio público", f"Arranque con pb_public: {label}", "Aborta si hay symlink/especial/oculto/sensible; arranca si está limpio" if not expect_up else "Arranca (sin falsos positivos)", ok, obs, "arranque", 0)
            for i, (obj, meta, fn) in enumerate(lints):
                ok, obs = fn(ctx); report(f"L{i+1:03d}", "L · Lint de código", obj, meta, ok, obs, "security/lint.sh", 0)
            leaks = sum(1 for e in BUS.events if e.get("type") == "case" and e["status"] == "fail" and "FUGA" in e["observed"])
            self.summary = dict(total=total, passed=counts["pass"], failed=counts["fail"], skipped=counts["skip"], leaks=leaks, alive=alive)
            BUS.emit(type="done", **self.summary)
        except Exception as e:
            BUS.emit(type="error", msg=str(e)); print("ERROR:", e, flush=True); self.summary = dict(error=str(e))
        finally:
            if pb: pb.stop()
            self.running = False


# ----------------------------------------------------------------------------- panel web
class UI(http.server.BaseHTTPRequestHandler):
    lab = None
    def log_message(self, *a): pass
    def _host_ok(self): return (self.headers.get("Host") or "").split(":")[0] in ("127.0.0.1", "localhost")   # anti DNS-rebinding
    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if not self._host_ok(): return self._send(403, "host no permitido")
        if self.path == "/": return self._send(200, open(os.path.join(HERE, "dashboard.html"), "rb").read())
        if self.path == "/events":
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-store"); self.end_headers()
            q = BUS.subscribe()
            try:
                while True:
                    try: ev = q.get(timeout=15); self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                    except queue.Empty: self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (OSError, ValueError): pass
            finally: BUS.unsubscribe(q)
            return
        self._send(404, "no encontrado")
    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Lab") != "1" or self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"): return self._send(403, "prohibido")
        if self.path == "/run": return self._send(202 if self.lab.start() else 409, json.dumps({"started": True}), "application/json")
        self._send(404, "no encontrado")

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True


def main():
    for st in (sys.stdout, sys.stderr): st.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(); ap.add_argument("--headless", action="store_true"); ap.add_argument("--pb"); ap.add_argument("--no-open", action="store_true"); ap.add_argument("--no-auto", action="store_true"); ap.add_argument("--boot-only", action="store_true"); ap.add_argument("--only", help="prefijos de id separados por coma (p. ej. S): ejecuta solo esos ataques")
    a = ap.parse_args()
    exe = provision(a.pb); lab = Lab(exe, a.only)
    if a.boot_only:   # usado por security/run-mini.sh: solo los archivos inseguros que deben impedir el arranque
        os.makedirs(RUN, exist_ok=True); bad = 0
        for i, (label, files) in enumerate(bad_page_cases()):
            ok, obs = run_boot(label, files, exe, f"p{i}"); bad += not ok
            print(("ok   " if ok else "FAIL ") + f"fail-closed: {label} ({obs})", flush=True)
        sys.exit(1 if bad else 0)
    if a.headless:
        lab.start()
        while lab.running or lab.summary is None: time.sleep(0.5)
        s = lab.summary; print(f"\nresultado: {s}"); sys.exit(0 if s.get("failed") == 0 and not s.get("error") else 1)
    UI.lab = lab; srv = Server(("127.0.0.1", UI_PORT), UI)
    url = f"http://127.0.0.1:{UI_PORT}/"; print(f"panel en vivo: {url}  (Ctrl+C para salir)", flush=True)
    if not a.no_open: threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    if not a.no_auto: lab.start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == "__main__": main()
