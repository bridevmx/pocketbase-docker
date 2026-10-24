"""Ronda 13: plugin opcional `ai` (consultas rápidas de una vuelta a Google AI Studio). Sección VAI. Todo contra un Google FALSO en 127.0.0.1 (nunca se contacta con generativelanguage.googleapis.com)."""
import json, os, re, time, shutil, threading, subprocess
from fake_google import FakeGoogle

PORT, BADPORT = 18770, 18771
KEY = "AIzaLabKey_labKey_labKey_labKey_labKey_12345"
ENV = {"GOOGLE_AI_API_KEY": KEY, "GOOGLE_AI_MODEL": "gemini-lab", "GOOGLE_AI_FALLBACK_MODEL": "gemma-lab"}
CFG = 'module.exports = { ai: %s };'
LIVE_CFG = 'module.exports = { access: { enabled: true, mode: "membership", collection: "users", roles: ["admin"], rolesField: "roles", statusField: "status" }, ai: %s };'
PAGES = {
    "ai/ask.js": 'module.exports = { auth: "user", body: { instruction: { type: "string", max: 5000, required: true }, text: { type: "string", max: 30000 }, image: { type: "string", max: 100000 }, mime: { type: "string", max: 20 } }, post: (ctx) => ctx.json(ctx.ai.ask(Object.assign({ instruction: ctx.body.instruction }, ctx.body.text ? { text: ctx.body.text } : {}, ctx.body.image ? { image: { mime: ctx.body.mime, base64: ctx.body.image } } : {}))), get: (ctx) => ctx.json(ctx.ai.ask({ instruction: "x" })) };',
    "ai/extract.js": 'module.exports = { auth: "user", body: { payload: { type: "string", max: 30000, required: true } }, post: (ctx) => ctx.json(ctx.ai.extract(JSON.parse(ctx.body.payload))) };',
    "ai/pub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.ai.ask({ instruction: "x" })) };',
}
FIELDS = {"total": {"type": "number", "desc": "importe total", "min": 0, "max": 1000000}, "tipo": {"type": "enum", "desc": "clase", "values": ["a", "b"]}, "nota": {"type": "string", "desc": "comentario", "max": 20}}


def cfgs():
    on = "{ enabled: true }"; c = lambda body: "{ enabled: true, %s }" % body
    drop = lambda k: {a: b for a, b in ENV.items() if a != k}
    E = lambda **k: {**ENV, **k}
    return [
        ("sin GOOGLE_AI_API_KEY", drop("GOOGLE_AI_API_KEY"), on), ("GOOGLE_AI_API_KEY demasiado corta", E(GOOGLE_AI_API_KEY="corta"), on), ("GOOGLE_AI_API_KEY con espacios", E(GOOGLE_AI_API_KEY="a" * 25 + " " + "b" * 5), on),
        ("sin GOOGLE_AI_MODEL", drop("GOOGLE_AI_MODEL"), on), ("GOOGLE_AI_MODEL con prefijo models/", E(GOOGLE_AI_MODEL="models/gemini-lab"), on), ("GOOGLE_AI_MODEL con mayúsculas", E(GOOGLE_AI_MODEL="Gemini-Lab"), on),
        ("GOOGLE_AI_MODEL con ruta", E(GOOGLE_AI_MODEL="a/../b"), on), ("GOOGLE_AI_FALLBACK_MODEL igual al principal", E(GOOGLE_AI_FALLBACK_MODEL="gemini-lab"), on), ("GOOGLE_AI_FALLBACK_MODEL inválido", E(GOOGLE_AI_FALLBACK_MODEL="a b"), on),
        ("GOOGLE_AI_API_URL hacia un host externo", E(GOOGLE_AI_API_URL="https://evil.example.com"), on), ("GOOGLE_AI_API_URL http no local", E(GOOGLE_AI_API_URL="http://generativelanguage.googleapis.com"), on), ("GOOGLE_AI_API_URL con ruta", E(GOOGLE_AI_API_URL="https://generativelanguage.googleapis.com/v1beta"), on),
        ("clave desconocida en ai", ENV, c("model: 1")), ("enabled no booleano", ENV, '{ enabled: "yes" }'), ("ai no es un objeto", ENV, "5"),
        ("timeoutSeconds cero", ENV, c("timeoutSeconds: 0")), ("timeoutSeconds excesivo", ENV, c("timeoutSeconds: 121")), ("perMinute cero", ENV, c("perMinute: 0")), ("perUserPerMin como texto", ENV, c('perUserPerMin: "5"')),
        ("maxOutputTokens muy bajo", ENV, c("maxOutputTokens: 10")), ("maxInputChars decimal", ENV, c("maxInputChars: 5.5")), ("maxImageKB excesivo", ENV, c("maxImageKB: 99999")),
    ]


def build(L, ctx, A):
    Case, raw = L.Case, L.raw
    cases, cnt = [], [0]
    J = {"Content-Type": "application/json"}
    EXE, RUN = ctx["exe"], L.RUN
    cat = "I · Plugin ai: consultas rápidas a Google AI (módulo opcional)"
    S = {"pb": None, "root": None, "fake": None, "su": None}
    LP = PORT + 10

    def add(obj, meta, run):
        cnt[0] += 1; cases.append(Case(f"VAI{cnt[0]:03d}", cat, obj, meta, run=run))

    def sandbox(tag, env, cfgtxt, pages=None):
        root = os.path.join(RUN, f"x-{tag}"); pgdir = root + "-pages"
        shutil.rmtree(pgdir, ignore_errors=True); os.makedirs(pgdir)
        for rel, txt in (pages or {"ok.js": 'module.exports = { auth: "public", get: (ctx) => ctx.json({ ok: 1 }) };'}).items():
            fp = os.path.join(pgdir, rel); os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
        L.build_sandbox(root, pgdir, symlinks=False, clean=True, hooks_extra={"pbmini.config.js": cfgtxt})
        return root, {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}

    def su_login(port): return L.api(port, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]
    def livecfg(inner="timeoutSeconds: 5, perMinute: 600, perUserPerMin: 100"): return LIVE_CFG % ("{ enabled: true, %s }" % inner)
    def live_boot(cfgtxt=None):
        env = {**ENV, "GOOGLE_AI_API_URL": f"http://127.0.0.1:{S['fake'].port}"}
        if S["root"] is None: root, full = sandbox("aiv", env, cfgtxt or livecfg(), PAGES); S["root"] = root
        else:
            root = S["root"]; full = {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}
            open(os.path.join(root, "pb_hooks", "pbmini.config.js"), "w", encoding="utf-8", newline="\n").write(cfgtxt or livecfg())
        pb = L.PB(EXE, root, LP, env=full); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): raise RuntimeError("servidor de ai no arrancó: " + pb.log()[-400:])
        S["su"] = su_login(LP)
    def live_restart(cfgtxt=None): S["pb"].stop(); live_boot(cfgtxt)
    seq = [0]
    def mkuser(**fields):
        seq[0] += 1; em = f"a{seq[0]}_{os.getpid()}@lab.test"
        S["lastid"] = L.api(LP, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True, **fields), S["su"])["id"]
        return L.api(LP, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"], em
    def jbody(r):
        try: return json.loads(r.body)
        except Exception: return {}
    def ask(tok, **b): return raw(LP, "POST", "/ai/ask", {"Authorization": tok, **J} if tok else {**J}, json.dumps({"instruction": "Resume el texto.", **b}), timeout=40)
    def extract(tok, payload): return raw(LP, "POST", "/ai/extract", {"Authorization": tok, **J} if tok else {**J}, json.dumps({"payload": json.dumps(payload)}))
    def g(): return S["fake"]
    IMG = "iVBORw0KGgo" + "A" * 201
    OKP = {"instruction": "Extrae los datos.", "fields": FIELDS, "text": "Total: 12.5"}

    def setup(_):
        S["fake"] = FakeGoogle(KEY); live_boot()
        users = L.api(LP, "GET", "/api/collections/users", None, S["su"])
        L.api(LP, "PATCH", "/api/collections/users", dict(fields=users["fields"] + [dict(name="roles", type="select", values=["admin"], maxSelect=1), dict(name="status", type="text")]), S["su"])
        return True, f"servidor con Google AI falso en 127.0.0.1:{S['fake'].port} (la API real nunca se contacta)"
    add("Preparación: servidor con el Google AI falso", "Listo", setup)

    def shape(_):
        bad = []; f = g(); f.clear(); f.content = {"*": "texto resumido"}; tok, _e = mkuser(); r = ask(tok, text="Un texto largo."); j = jbody(r)
        if r.status != 200 or j.get("text") != "texto resumido" or j.get("model") != "gemini-lab": return False, f"HTTP {r.status} {r.body[:160]}"
        if len(f.calls) != 1: bad.append(f"llamadas: {len(f.calls)}")
        else:
            c = f.calls[0]; b = c["body"]
            if c["path"] != "/v1beta/models/gemini-lab:generateContent": bad.append(f"ruta {c['path']}")
            if c["key"] != KEY: bad.append("la clave debe ir en la cabecera x-goog-api-key")
            if "key=" in c["path"] or KEY in c["path"]: bad.append("la clave NO debe ir en la URL")
            if "systemInstruction" in b or "system_instruction" in b: bad.append("no debe usar systemInstruction (Gemma no lo admite)")
            t = b["contents"][0]["parts"][0]["text"]
            if "Resume el texto." not in t or "Un texto largo." not in t: bad.append("la instrucción y el texto van en el mensaje")
            gc = b["generationConfig"]
            if gc.get("temperature") != 0 or gc.get("maxOutputTokens") != 2048: bad.append(f"generationConfig {gc}")
            if len(b["contents"]) != 1 or b["contents"][0]["role"] != "user": bad.append("una sola vuelta, sin historial")
        if set(j) != {"text", "model"}: bad.append(f"campos devueltos {sorted(j)}")
        if KEY in S["pb"].log(): bad.append("la clave aparece en el log")
        return not bad, "; ".join(bad) or "una sola llamada: clave en la cabecera (nunca en la URL), instrucción y texto en el mensaje, sin systemInstruction ni historial, temperatura 0"
    add("ask: forma de la llamada (una vuelta, clave en cabecera, sin systemInstruction)", "Compatible con Gemma y Gemini", shape)

    def extracting(_):
        bad = []; f = g(); f.clear(); tok, _e = mkuser()
        f.content = {"*": json.dumps({"total": 12.5, "tipo": "a", "nota": "ok", "status": "paid", "evil": "x"})}
        j = jbody(extract(tok, OKP))
        if j.get("values") != {"total": 12.5, "tipo": "a", "nota": "ok"}: bad.append(f"valores: {j}")
        if set(j) != {"values", "model"}: bad.append(f"campos {sorted(j)}")
        b = f.calls[0]["body"]["contents"][0]["parts"][0]["text"]
        if "DATO NO CONFIABLE" not in b or "importe total" not in b or "uno de: a | b" not in b: bad.append("el prompt debe describir los campos y avisar que el contenido no es confiable")
        for label, content, want in (("```json", "```json\n" + json.dumps({"total": 1, "tipo": "b"}) + "\n```", {"total": 1, "tipo": "b", "nota": None}), ("tipos incorrectos", json.dumps({"total": "12", "tipo": "z", "nota": "x" * 21}), {"total": None, "tipo": None, "nota": None}),
                                     ("fuera de rango", json.dumps({"total": -5, "tipo": 1}), {"total": None, "tipo": None, "nota": None}), ("texto libre", "Aquí tienes el resultado", {"total": None, "tipo": None, "nota": None}), ("JSON roto", "{no", {"total": None, "tipo": None, "nota": None}),
                                     ("hostil", json.dumps({"total": 1e12, "tipo": "<script>", "nota": "<img src=x onerror=alert(1)>" + "x" * 30}), {"total": None, "tipo": None, "nota": None})):
            f.content = {"*": content}; j = jbody(extract(tok, OKP))
            if j.get("values") != want: bad.append(f"«{label}»: {j.get('values')}")
        f.plan["gemini-lab"] = ["thought"]; f.content = {"*": json.dumps({"total": 2, "tipo": "a"})}
        if jbody(extract(tok, OKP)).get("values", {}).get("total") != 2: bad.append("las partes de razonamiento deben ignorarse")
        return not bad, "; ".join(bad) or "extract: valida tipos, rangos y enums, descarta claves no declaradas (status, evil), tolera ```json y razonamiento y trata texto libre, JSON roto y contenido hostil como nulos"
    add("extract: valores validados por tipo y salidas hostiles", "El modelo solo propone", extracting)

    def fallback(_):
        bad = []; f = g(); tok, _e = mkuser()
        for act in ("500", "429", "maxtokens", "empty", "blocked", "garbage", "nocand"):
            f.clear(); f.plan["gemini-lab"] = [act]; f.content = {"*": "respaldo"}; r = ask(tok); j = jbody(r)
            if r.status != 200 or j.get("model") != "gemma-lab" or j.get("text") != "respaldo" or [c["model"] for c in f.calls] != ["gemini-lab", "gemma-lab"]: bad.append(f"principal «{act}»: HTTP {r.status} {j.get('model')} {[c['model'] for c in f.calls]}")
        f.clear(); f.delay = 7.0; t0 = time.time(); r = ask(tok)   # con timeoutSeconds 5 ambos modelos agotan el tiempo
        if r.status != 502: bad.append(f"ambos lentos => 502: {r.status}")
        f.clear(); f.plan["gemini-lab"] = ["500"]; f.plan["gemma-lab"] = ["500"]; r = ask(tok)
        if r.status != 502 or KEY in r.body or "gemini-lab" in r.body or "Internal" in r.body: bad.append(f"ambos caídos => 502 sin detalles: {r.status} {r.body[:100]}")
        f.clear(); f.content = {"*": "ya volvió"}; r = ask(tok)
        if r.status != 200 or jbody(r).get("model") != "gemini-lab": bad.append("debe volver al principal cuando se recupera")
        if KEY in S["pb"].log(): bad.append("la clave aparece en el log")
        return not bad, "; ".join(bad) or "ante 500, 429, respuesta cortada, vacía, bloqueada, basura o sin candidatos pasa al modelo de respaldo; si ambos fallan o tardan: 502 sin detalles ni clave; vuelve al principal al recuperarse"
    add("Respaldo: el principal falla y responde el segundo modelo", "502 sin detalles si fallan ambos", fallback)

    def validation(_):
        bad = []; f = g(); f.clear(); tok, _e = mkuser(); bigf = {f"f{i}": {"type": "string", "desc": "d"} for i in range(21)}
        asks = [("instrucción vacía", dict(instruction="")), ("instrucción de 4001", dict(instruction="x" * 4001)), ("texto de 6001", dict(instruction="i", text="x" * 6001)),
                ("imagen con tipo inválido", dict(instruction="i", image=IMG, mime="image/gif")), ("imagen sin tipo", dict(instruction="i", image=IMG, mime="")), ("imagen no base64", dict(instruction="i", image="@@@@" + "A" * 100, mime="image/png"))]
        for label, b in asks:
            r = ask(tok, **{k: v for k, v in b.items()})
            if r.status != 400: bad.append(f"ask «{label}» → {r.status}")
        ex = [("sin campos", {**OKP, "fields": {}}), ("campo con tipo desconocido", {**OKP, "fields": {"a": {"type": "date", "desc": "d"}}}), ("campo sin descripción", {**OKP, "fields": {"a": {"type": "string"}}}), ("21 campos", {**OKP, "fields": bigf}),
              ("nombre inválido", {**OKP, "fields": {"A b": {"type": "string", "desc": "d"}}}), ("enum sin valores", {**OKP, "fields": {"a": {"type": "enum", "desc": "d"}}}), ("opción desconocida en un campo", {**OKP, "fields": {"a": {"type": "string", "desc": "d", "regex": "x"}}}),
              ("instrucción ausente", {"fields": FIELDS}), ("opciones no son un objeto", [1]), ("imagen inválida", {**OKP, "image": {"mime": "image/png", "base64": "no es base64!"}}), ("imagen con tipo inválido", {**OKP, "image": {"mime": "text/html", "base64": IMG}})]
        for label, p in ex:
            r = extract(tok, p)
            if r.status != 400: bad.append(f"extract «{label}» → {r.status}")
        if f.calls: bad.append(f"se llamó a Google {len(f.calls)} veces con peticiones inválidas")
        f.content = {"*": json.dumps({"total": 1})}
        if extract(tok, {**OKP, "image": {"mime": "image/png", "base64": IMG}}).status != 200: bad.append("extract con una imagen válida debe pasar")
        if f.calls and "inline_data" not in json.dumps(f.calls[0]["body"]): bad.append("la imagen debe ir como inline_data")
        return not bad, "; ".join(bad) or "instrucción, texto, imagen y la declaración de campos se validan antes de llamar a Google (cuesta cuota); una imagen válida va como inline_data"
    add("Validación estricta de lo que se le pide al modelo", "400 sin llamar a Google", validation)

    def auth_rules(_):
        bad = []; f = g(); f.clear(); f.content = {"*": "x"}; tok, _e = mkuser()
        if ask(None).status != 401: bad.append("anónimo debe recibir 401")
        if raw(LP, "GET", "/ai/ask", {"Authorization": tok}).status != 500: bad.append("ctx.ai desde GET debe ser error de programación (500)")
        if raw(LP, "POST", "/ai/pub", {**J}, "{}").status != 500: bad.append("ctx.ai en ruta pública debe ser error de programación (500)")
        bt, _e2 = mkuser(); L.api(LP, "PATCH", f"/api/collections/users/records/{S['lastid']}", {"status": "suspended"}, S["su"])
        if ask(bt).status not in (401, 403): bad.append("cuenta bloqueada debe ser rechazada")
        if f.calls: bad.append(f"se llamó a Google en peticiones no autorizadas: {len(f.calls)}")
        return not bad, "; ".join(bad) or "anónimo 401; GET y ruta pública son error de programación; cuenta bloqueada rechazada; nunca se llama a Google"
    add("Quién puede usar ctx.ai: usuario autenticado, no GET, no público, no bloqueado", "Sin llamar a Google", auth_rules)

    def limits(_):
        bad = []
        try:
            live_restart(livecfg("timeoutSeconds: 5, perMinute: 600, perUserPerMin: 2")); f = g(); f.clear(); f.content = {"*": "x"}; tok, _e = mkuser(); tok2, _e2 = mkuser()
            r = [ask(tok).status for _i in range(4)]
            if r != [200, 200, 429, 429]: bad.append(f"tope por usuario: {r}")
            if ask(tok2).status != 200: bad.append("el tope de un usuario no debe afectar a otro")
            live_restart(livecfg("timeoutSeconds: 5, perMinute: 3, perUserPerMin: 100")); f.clear(); f.content = {"*": "x"}; tok, _e = mkuser(); tok2, _e2 = mkuser()
            r = [ask(tok).status for _i in range(2)] + [ask(tok2).status for _i in range(3)]
            if r != [200, 200, 200, 429, 429]: bad.append(f"tope global por minuto: {r}")
        finally:
            live_restart(livecfg())
        return not bad, "; ".join(bad) or "tope por usuario (429, sin afectar a otros) y tope global por minuto (429)"
    add("Límites por usuario y globales", "429 al excederlos", limits)

    NODE = {"res": None}
    def unit():
        if NODE["res"] is None:
            node = shutil.which("node")
            if not node: NODE["res"] = ("skip", "no hay Node en este sistema")
            else:
                r = subprocess.run([node, os.path.join(L.HERE, "unit_ai.js"), os.path.join(L.ROOT, "pb_hooks")], capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
                try: NODE["res"] = ("ok", json.loads(r.stdout.strip().splitlines()[-1]))
                except Exception: NODE["res"] = ("err", (r.stdout + r.stderr)[-400:])
        return NODE["res"]
    def unit_case(group, obj, meta):
        def run(_):
            kind, res = unit()
            if kind == "skip": return None, "OMITIDO: " + res
            if kind == "err": return False, "no se pudo ejecutar unit_ai.js: " + res
            gr = res["groups"].get(group)
            if gr is None: return False, f"el grupo «{group}» no existe en unit_ai.js"
            return not gr["fail"], ("; ".join(gr["fail"][:6]) + (f" (+{len(gr['fail']) - 6})" if len(gr["fail"]) > 6 else "")) or f"{gr['pass']} comprobaciones"
        add(obj, meta, run)
    unit_case("json del modelo", "JSON del modelo: con o sin ```json; todo lo demás es nulo", "Texto libre, roto, arreglo, enorme o no texto => null")
    unit_case("campos declarados", "Declaración de campos: tipos, enums, nombres y descripciones estrictos", "Cualquier defecto lanza; máximo 20 campos")
    unit_case("validación de la salida", "Validación de la salida: tipos, rangos, enums y claves no declaradas", "Lo inválido es null; nada fuera de lo declarado sale")
    unit_case("prompt y respuesta de Google", "Prompt de extracción y lectura de la respuesta de Google", "Solo respuestas completas con texto; cortadas, bloqueadas o vacías => reintento con otro modelo")

    def bad_boot_case(label, env, aicfg):
        def run(_):
            root, full = sandbox("aibad", env, CFG % aicfg); full = {**full, "PBMINI_ON_ERROR": ""}
            pb = L.PB(EXE, root, BADPORT, env=full); pb.serve(); died, end = False, time.time() + 14
            while time.time() < end:
                if pb.proc.poll() is not None: died = True; break
                time.sleep(0.25)
            log = pb.log(); pb.stop(); leaked = [n for n, v in (("la clave de Google", KEY),) if v in log]
            return died and ("pbmini" in log) and not leaked, ("abortó el arranque (fail-closed)" if died else "ARRANCÓ con configuración inválida") + (f"; el log contiene {leaked}" if leaked else "")
        add(f"Fail-closed: {label}", "El servidor NO arranca; el mensaje nombra la opción, no el valor", run)
    for lab_, env_, cfg_ in cfgs(): bad_boot_case(lab_, env_, cfg_)

    def teardown(_):
        try:
            if S["pb"]: S["pb"].stop()
        finally:
            if S["fake"]: S["fake"].stop()
        return True, "servidor y Google falso detenidos"
    add("Limpieza: se detienen el servidor y el Google falso", "Listo", teardown)
    return cases
