"""Ronda 11: módulo opcional de pagos con Clip (links de pago). Sección VP. Todo contra un Clip FALSO en 127.0.0.1 (nunca se contacta con api.payclip.com).
`build(L, ctx, A)` devuelve los casos en vivo. Fase 1: entorno y configuración (fail-closed), colección interna y reglas."""
import json, os, re, time, shutil, base64, urllib.parse, threading, subprocess, hmac, hashlib
from fake_clip import FakeClip

CLIP_TOKEN = "Basic " + base64.b64encode(b"11111111-2222-3333-4444-555555555555:66666666-7777-8888-9999-000000000000").decode()
WH_TOKEN = "labWebhookToken_labWebhookToken_labWebhook"       # 43 caracteres
PUBLIC = "https://pay.lab.example.test"
PORT, BADPORT = 18740, 18741
BASE_ENV = {"CLIP_API_TOKEN": CLIP_TOKEN, "CLIP_WEBHOOK_TOKEN": WH_TOKEN, "CLIP_PUBLIC_URL": PUBLIC}
CFG = 'module.exports = { clip: %s };'
LIVE_CFG = 'module.exports = { access: { enabled: true, mode: "membership", collection: "users", roles: ["admin"], rolesField: "roles", statusField: "status" }, clip: %s };'
PAGES = {
    "clip/raw.js": 'module.exports = { auth: "user", body: { opts: { type: "string", max: 5000, required: true } }, post: (ctx) => ctx.json(ctx.clip.createPayment(JSON.parse(ctx.body.opts))), get: (ctx) => ctx.json(ctx.clip.createPayment({})) };',
    "clip/pub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.clip.createPayment({})) };',
    "clip/verify.js": 'module.exports = { auth: "user", body: { id: { type: "string", max: 64, required: true } }, query: { id: { type: "string", max: 64 } }, post: (ctx) => ctx.json(ctx.clip.verify(ctx.body.id)), get: (ctx) => ctx.json(ctx.clip.verify(ctx.query.id)) };',
    "clip/get.js": 'module.exports = { auth: "user", query: { id: { type: "string", max: 64, required: true } }, get: (ctx) => ctx.json(ctx.clip.get(ctx.query.id)) };',
    "clip/list.js": 'module.exports = { auth: "user", query: { kind: { type: "string", max: 64, required: true }, sid: { type: "string", max: 80, required: true } }, get: (ctx) => ctx.json({ items: ctx.clip.list({ subjectKind: ctx.query.kind, subjectId: ctx.query.sid }) }) };',
    "clip/vsu.js": 'module.exports = { auth: "superuser", query: { id: { type: "string", max: 64, required: true } }, get: (ctx) => ctx.json(ctx.clip.verify(ctx.query.id)) };',
    "clip/vpub.js": 'module.exports = { auth: "public", get: (ctx) => ctx.json(ctx.clip.verify("x")) };',
    "clip/rc.js": 'module.exports = { auth: "superuser", post: (ctx) => ctx.json(require(`${__hooks}/lib/clip.js`).reconcile($app)) };',
    "clip/op.js": 'module.exports = { auth: "superuser", body: { op: { type: "string", max: 20, required: true }, id: { type: "string", max: 40, required: true }, to: { type: "string", max: 10 }, receipt: { type: "string", max: 80 } }, post: (ctx) => { const T = require(`${__hooks}/lib/clip.js`), b = ctx.body; '
                 'if (b.op === "refund") return ctx.json(ctx.clip.refund(b.id)); if (b.op === "refund_mod") return ctx.json(T.refund($app, b.id, "lab")); if (b.op === "refunded") return ctx.json(T.markRefunded($app, b.id, "lab")); '
                 'if (b.op === "review") return ctx.json(T.reviewResolve($app, b.id, b.to, "lab", b.receipt)); if (b.op === "claim") return ctx.json({ ok: T.claimActivation($app, b.id) }); if (b.op === "activated") return ctx.json({ ok: T.markActivated($app, b.id) }); '
                 'if (b.op === "purge") return ctx.json(T.purge($app, { dryRun: b.to === "dry" })); throw new Error("op"); } };',
    "clip/refget.js": 'module.exports = { auth: "superuser", get: (ctx) => ctx.json(ctx.clip.refund("aaaaaaaaaaaaaaa")) };',
    "clip/refuser.js": 'module.exports = { auth: "user", post: (ctx) => ctx.json(ctx.clip.refund("aaaaaaaaaaaaaaa")) };',
    "clip/su.js": 'module.exports = { auth: "superuser", post: (ctx) => ctx.json(ctx.clip.createPayment({})) };',
}
ENTREGA_HOOK = """/// <reference path="../pb_data/types.d.ts" />
onRecordAfterUpdateSuccess((e) => {
  try {
    if (e.record.original().getString("status") !== "paid" && e.record.getString("status") === "paid") {
      const r = new Record($app.findCollectionByNameOrId("entregas")); r.set("pago", e.record.id); $app.save(r);
    }
  } catch (err) { $app.logger().error("entrega no registrada", "error", String(err)); }
  e.next();
}, "pbmini_clip_payments");
"""
ENTREGAS = dict(name="entregas", type="base", fields=[dict(name="pago", type="text")])
GOOD = {"amount": 12345, "description": "Pedido 1042", "subject": {"kind": "order", "id": "abc123"}, "urls": {"success": "/pedido/abc123", "error": "/pedido/abc123?pago=error", "default": "/"}}
def sig(token, pid): return hmac.new(token.encode(), ("payref:v1:" + pid).encode(), hashlib.sha256).hexdigest()[:8]


def cfgs():
    """(etiqueta, env, bloque clip, archivos extra) que deben impedir el arranque (fail-closed)."""
    on = "{ enabled: true }"
    c = lambda body: "{ enabled: true, %s }" % body
    E = lambda **k: {**BASE_ENV, **k}
    drop = lambda k: {a: b for a, b in BASE_ENV.items() if a != k}
    out = [
        ("sin CLIP_API_TOKEN", drop("CLIP_API_TOKEN"), on),
        ("CLIP_API_TOKEN sin el prefijo Basic", E(CLIP_API_TOKEN=CLIP_TOKEN[6:]), on),
        ("CLIP_API_TOKEN con esquema Bearer", E(CLIP_API_TOKEN="Bearer " + CLIP_TOKEN[6:]), on),
        ("CLIP_API_TOKEN demasiado corto", E(CLIP_API_TOKEN="Basic abc"), on),
        ("CLIP_API_TOKEN con espacios o caracteres raros", E(CLIP_API_TOKEN="Basic aaaa bbbb cccc"), on),
        ("sin CLIP_WEBHOOK_TOKEN", drop("CLIP_WEBHOOK_TOKEN"), on),
        ("CLIP_WEBHOOK_TOKEN corto", E(CLIP_WEBHOOK_TOKEN="corto"), on),
        ("CLIP_WEBHOOK_TOKEN con caracteres no permitidos", E(CLIP_WEBHOOK_TOKEN="a" * 31 + "?"), on),
        ("CLIP_WEBHOOK_TOKEN_PREV igual al actual", E(CLIP_WEBHOOK_TOKEN_PREV=WH_TOKEN), on),
        ("CLIP_WEBHOOK_TOKEN_PREV inválido", E(CLIP_WEBHOOK_TOKEN_PREV="x y"), on),
        ("CLIP_API_URL hacia un host externo (https)", E(CLIP_API_URL="https://api.evil.example.com"), on),
        ("CLIP_API_URL http no local", E(CLIP_API_URL="http://api.payclip.com"), on),
        ("CLIP_API_URL con ruta", E(CLIP_API_URL="https://api.payclip.com/v2"), on),
        ("sin URL pública (ni variable ni config)", drop("CLIP_PUBLIC_URL"), on),
        ("URL pública http no local", E(CLIP_PUBLIC_URL="http://pay.example.com"), on),
        ("URL pública con ruta", E(CLIP_PUBLIC_URL="https://pay.example.com/tienda"), on),
        ("URL pública con credenciales", E(CLIP_PUBLIC_URL="https://user:pass@pay.example.com"), on),
        ("URL pública con parámetros", E(CLIP_PUBLIC_URL="https://pay.example.com?x=1"), on),
        ("clave desconocida en clip", BASE_ENV, c("minAmunt: 1")),
        ("enabled no booleano", BASE_ENV, "{ enabled: \"yes\" }"),
        ("clip no es un objeto", BASE_ENV, "5"),
        ("collection de sistema", BASE_ENV, c('collection: "_superusers"')),
        ("collection con formato inválido", BASE_ENV, c('collection: "mi coleccion"')),
        ("referencePrefix en minúsculas", BASE_ENV, c('referencePrefix: "pbm"')),
        ("referencePrefix demasiado largo", BASE_ENV, c('referencePrefix: "ABCDEFG"')),
        ("referencePrefix con dígitos", BASE_ENV, c('referencePrefix: "P8M"')),
        ("methods vacío", BASE_ENV, c("methods: []")),
        ("methods con un valor desconocido", BASE_ENV, c('methods: ["bitcoin"]')),
        ("methods repetidos", BASE_ENV, c('methods: ["credit", "credit"]')),
        ("methods no es una lista", BASE_ENV, c('methods: "credit"')),
        ("openOnCardForm no booleano", BASE_ENV, c('openOnCardForm: "yes"')),
        ("amount.min menor a un peso (100 centavos)", BASE_ENV, c("amount: { min: 50 }")),
        ("amount.min decimal", BASE_ENV, c("amount: { min: 150.5 }")),
        ("amount.min mayor que amount.max", BASE_ENV, c("amount: { min: 5000, max: 1000 }")),
        ("amount.max como texto", BASE_ENV, c('amount: { max: "999" }')),
        ("amount con clave desconocida", BASE_ENV, c("amount: { minimo: 100 }")),
        ("descriptionMax mayor a 250", BASE_ENV, c("descriptionMax: 251")),
        ("descriptionMax cero", BASE_ENV, c("descriptionMax: 0")),
        ("timeoutSeconds cero", BASE_ENV, c("timeoutSeconds: 0")),
        ("timeoutSeconds mayor a 30", BASE_ENV, c("timeoutSeconds: 31")),
        ("expiresInMinutes menor a 2", BASE_ENV, c("expiresInMinutes: 1")),
        ("expiresInMinutes mayor a un día", BASE_ENV, c("expiresInMinutes: 2000")),
        ("expiresInMinutes como texto", BASE_ENV, c('expiresInMinutes: "x"')),
        ("installmentsMsi con un plazo no admitido", BASE_ENV, c("installmentsMsi: [5]")),
        ("installmentsMsi repetidos", BASE_ENV, c("installmentsMsi: [3, 3]")),
        ("installmentsMsi no es una lista", BASE_ENV, c('installmentsMsi: "3"')),
        ("international no booleano", BASE_ENV, c('international: "x"')),
        ("webhook.path dentro de /api", BASE_ENV, c('webhook: { path: "/api/clip" }')),
        ("webhook.path de otro módulo", BASE_ENV, c('webhook: { path: "/_telegram/x" }')),
        ("webhook.path sin barra inicial ni guion bajo", BASE_ENV, c('webhook: { path: "clip" }')),
        ("webhook.path con mayúsculas", BASE_ENV, c('webhook: { path: "/_Clip" }')),
        ("webhook.path con demasiados niveles", BASE_ENV, c('webhook: { path: "/_a/b/c/d" }')),
        ("webhook.maxBytes demasiado pequeño", BASE_ENV, c("webhook: { maxBytes: 100 }")),
        ("webhook.perIpPerMin cero", BASE_ENV, c("webhook: { perIpPerMin: 0 }")),
        ("webhook no es un objeto", BASE_ENV, c("webhook: 5")),
        ("webhook con clave desconocida", BASE_ENV, c("webhook: { token: 'x' }")),
        ("create.perUserPerMin cero", BASE_ENV, c("create: { perUserPerMin: 0 }")),
        ("create.maxPendingPerUser excesivo", BASE_ENV, c("create: { maxPendingPerUser: 101 }")),
        ("verify.minIntervalMs demasiado bajo", BASE_ENV, c("verify: { minIntervalMs: 100 }")),
        ("verify.perUserPerMin cero", BASE_ENV, c("verify: { perUserPerMin: 0 }")),
        ("verify.perUserPerMin excesivo", BASE_ENV, c("verify: { perUserPerMin: 1001 }")),
        ("verify con clave desconocida", BASE_ENV, c("verify: { cada: 5 }")),
        ("reconcile.cron con 4 campos", BASE_ENV, c('reconcile: { cron: "* * * *" }')),
        ("reconcile.cron con valores fuera de rango", BASE_ENV, c('reconcile: { cron: "61 * * * *" }')),
        ("reconcile.windowHours cero", BASE_ENV, c("reconcile: { windowHours: 0 }")),
        ("reconcile.windowHours excesivo", BASE_ENV, c("reconcile: { windowHours: 200 }")),
        ("reconcile.batch cero", BASE_ENV, c("reconcile: { batch: 0 }")),
        ("reconcile.batch excesivo", BASE_ENV, c("reconcile: { batch: 501 }")),
        ("reconcile.staleCreatedMinutes cero", BASE_ENV, c("reconcile: { staleCreatedMinutes: 0 }")),
        ("reconcile.minAgeMinutes excesivo", BASE_ENV, c("reconcile: { minAgeMinutes: 61 }")),
        ("retention.failedDays cero", BASE_ENV, c("retention: { failedDays: 0 }")),
        ("retention.paidDays negativo", BASE_ENV, c("retention: { paidDays: -1 }")),
        ("readRules no booleano", BASE_ENV, c('readRules: "x"')),
        ("colección de usuarios inexistente", BASE_ENV, c('collection: "nope"')),
    ]
    return out


def build(L, ctx, A):
    Case, raw = L.Case, L.raw
    cases, cnt = [], [0]
    J = {"Content-Type": "application/json"}
    EXE, RUN = ctx["exe"], L.RUN
    cat = "P · Pagos con Clip (módulo opcional)"
    S = {"pb": None, "root": None, "env": None, "su": None}

    def add(obj, meta, run):
        cnt[0] += 1; cases.append(Case(f"VP{cnt[0]:03d}", cat, obj, meta, run=run))

    def sandbox(tag, env, cfgtxt, pages=None, extra=None):
        root = os.path.join(RUN, f"x-{tag}"); pgdir = root + "-pages"
        shutil.rmtree(pgdir, ignore_errors=True); os.makedirs(pgdir)
        for rel, txt in (pages or {"ok.js": 'module.exports = { auth: "public", get: (ctx) => ctx.json({ ok: 1 }) };'}).items():
            fp = os.path.join(pgdir, rel); os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
        L.build_sandbox(root, pgdir, symlinks=False, clean=True, hooks_extra={"pbmini.config.js": cfgtxt, **(extra or {})})
        return root, {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}

    def su_login(port): return L.api(port, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]

    def boot(tag, port, clipcfg="{ enabled: true }", env=None):
        root, full = sandbox(tag, env if env is not None else BASE_ENV, CFG % clipcfg)
        pb = L.PB(EXE, root, port, env=full); pb.serve()
        if not pb.wait_ready(): raise RuntimeError("servidor de Clip no arrancó: " + pb.log()[-400:])
        return pb, root, full

    def restart(pb, root, port, full):
        pb.stop(); pb2 = L.PB(EXE, root, port, env=full); pb2.serve()
        if not pb2.wait_ready(): raise RuntimeError("no rearrancó: " + pb2.log()[-400:])
        return pb2

    # ------------------------------------------------------------------ colección interna
    def collection_ok(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("clip1", PORT); su = su_login(PORT)
            col = L.api(PORT, "GET", "/api/collections/pbmini_clip_payments", None, su)
            names = [f["name"] for f in col["fields"]]
            want = ["reference", "clip_id", "user", "subject_kind", "subject_id", "amount", "currency", "description", "url", "qr_url", "status", "receipt_no", "note", "idem_key", "expires_at", "paid_at", "closed_at",
                    "activated_at", "checked_at", "refund_id", "refund_receipt_no", "refunded_at", "created", "updated"]
            miss = [n for n in want if n not in names]
            if miss: bad.append(f"faltan campos: {miss}")
            if names[-2:] != ["created", "updated"]: bad.append(f"created/updated deben ir al final: {names[-2:]}")
            for r in ("listRule", "viewRule", "createRule", "updateRule", "deleteRule"):
                if col.get(r) is not None: bad.append(f"{r} debe ser null (solo superusuario): {col.get(r)!r}")
            st = next(f for f in col["fields"] if f["name"] == "status")
            if st["values"] != ["created", "pending", "paid", "failed", "expired", "review", "refunded"]: bad.append(f"estados: {st['values']}")
            am = next(f for f in col["fields"] if f["name"] == "amount")
            if not am.get("onlyInt") or am.get("min") != 100: bad.append(f"amount debe ser entero en centavos con mínimo 100: {am}")
            idx = " ".join(col["indexes"])
            for k, frag in (("reference", "UNIQUE INDEX idx_pbmini_clip_payments_reference"), ("clip_id parcial", "clip_id != ''"), ("receipt_no parcial", "receipt_no != ''"), ("idem por usuario", "(user, idem_key)"), ("refund_id", "refund_id != ''")):
                if frag not in idx: bad.append(f"falta el índice único de {k}")
            if any(f.get("hidden") for f in col["fields"]): bad.append("con readRules apagado no debe haber campos ocultos")
            # reiniciar no rompe nada (idempotente) y conserva la colección
            cid = col["id"]; pb = restart(pb, root, PORT, full); su = su_login(PORT)
            if L.api(PORT, "GET", "/api/collections/pbmini_clip_payments", None, su)["id"] != cid: bad.append("el reinicio recreó la colección")
            return not bad, "; ".join(bad) or "colección creada al servir con campos, estados, índices únicos parciales y reglas null; created/updated al final; idempotente al reiniciar"
        finally:
            if pb: pb.stop()
    add("Colección interna: campos, índices únicos parciales y reglas null", "Solo superusuario; idempotente", collection_ok)

    def collection_closed(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("clip2", PORT); su = su_login(PORT)
            L.api(PORT, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference="PBM-aaaaaaaaaaaaaaa-00000000", amount=100, currency="MXN", status="paid", user="x"), su)
            em = f"p{os.getpid()}@lab.test"; L.api(PORT, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
            tok = L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
            for who, h in (("usuario", {"Authorization": tok}), ("anónimo", {})):
                for m, p, body in (("GET", "/api/collections/pbmini_clip_payments/records", None), ("POST", "/api/collections/pbmini_clip_payments/records", "{}"), ("GET", "/api/collections/pbmini_clip_payments/records/xxxxxxxxxxxxxxx", None)):
                    r = raw(PORT, m, p, {**J, **h}, body)
                    if r.status in (200, 201): bad.append(f"{who}: {m} {p} → {r.status}")
            r = raw(PORT, "GET", "/api/collections/pbmini_clip_payments/records", {"Authorization": tok})
            if "PBM-" in r.body: bad.append("un usuario pudo leer pagos")
            return not bad, "; ".join(bad) or "con readRules apagado ni usuarios ni anónimos leen ni escriben pagos por la API nativa"
        finally:
            if pb: pb.stop()
    add("La API nativa no expone los pagos (readRules apagado)", "Usuarios y anónimos: sin acceso", collection_closed)

    def read_rules(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("clip3", PORT, "{ enabled: true, readRules: true }"); su = su_login(PORT)
            col = L.api(PORT, "GET", "/api/collections/pbmini_clip_payments", None, su)
            for r in ("listRule", "viewRule"):
                if col.get(r) != "user = @request.auth.id": bad.append(f"{r} = {col.get(r)!r}")
            for r in ("createRule", "updateRule", "deleteRule"):
                if col.get(r) is not None: bad.append(f"{r} debe seguir en null")
            hid = sorted(f["name"] for f in col["fields"] if f.get("hidden"))
            if hid != sorted(["clip_id", "qr_url", "note", "idem_key", "checked_at", "refund_id"]): bad.append(f"campos ocultos: {hid}")
            def mk(n):
                em = f"r{n}{os.getpid()}@lab.test"; rec = L.api(PORT, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
                return rec["id"], L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
            a, ta = mk(1); b, tb = mk(2)
            for uid, ref in ((a, "PBM-aaaaaaaaaaaaaaa-00000001"), (b, "PBM-bbbbbbbbbbbbbbb-00000002")):
                L.api(PORT, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference=ref, amount=100, currency="MXN", status="paid", user=uid, clip_id="3746680a-e227-47d0-b209-cbffbfc69a77" if uid == a else "", note="interna", idem_key="k" + uid[:5]), su)
            mine = L.api(PORT, "GET", "/api/collections/pbmini_clip_payments/records", None, ta)
            if [i["user"] for i in mine["items"]] != [a]: bad.append(f"el dueño debe ver solo su pago: {[i['user'] for i in mine['items']]}")
            leak = [k for k in ("clip_id", "note", "idem_key", "qr_url", "checked_at", "refund_id") if mine["items"] and k in mine["items"][0]]
            if leak: bad.append(f"campos internos visibles para el dueño: {leak}")
            if raw(PORT, "GET", "/api/collections/pbmini_clip_payments/records", {}).status == 200 and json.loads(raw(PORT, "GET", "/api/collections/pbmini_clip_payments/records", {}).body)["items"]: bad.append("un anónimo vio pagos")
            for m, p, d in (("POST", "/api/collections/pbmini_clip_payments/records", json.dumps(dict(reference="PBM-ccccccccccccccc-00000003", amount=100, currency="MXN", status="paid", user=a))),):
                r = raw(PORT, m, p, {"Authorization": ta, **J}, d)
                if r.status in (200, 201): bad.append("el dueño pudo crear un pago")
            one = L.api(PORT, "GET", "/api/collections/pbmini_clip_payments/records", None, tb)["items"][0]["id"]
            if raw(PORT, "PATCH", f"/api/collections/pbmini_clip_payments/records/{one}", {"Authorization": tb, **J}, '{"status":"failed"}').status in (200, 204): bad.append("el dueño pudo modificar su pago")
            if raw(PORT, "DELETE", f"/api/collections/pbmini_clip_payments/records/{one}", {"Authorization": tb}).status in (200, 204): bad.append("el dueño pudo borrar su pago")
            return not bad, "; ".join(bad) or "readRules: el dueño lee solo sus pagos (sin campos internos), no crea, no modifica ni borra; anónimos y otros usuarios no ven nada"
        finally:
            if pb: pb.stop()
    add("readRules: el dueño ve solo sus pagos y sin campos internos", "Lectura propia; escritura solo del plugin", read_rules)

    def secrets_boot(_):
        pb = None
        try:
            pb, root, full = boot("clip4", PORT); log = pb.log()
            leak = [n for n, v in (("CLIP_API_TOKEN", CLIP_TOKEN), ("la clave base64", CLIP_TOKEN[6:]), ("CLIP_WEBHOOK_TOKEN", WH_TOKEN)) if v in log]
            return not leak, f"el log de arranque no contiene secretos" if not leak else f"aparecen en el log: {leak}"
        finally:
            if pb: pb.stop()
    add("Los secretos no aparecen en el log de arranque", "Ni el token de la API ni el del webhook", secrets_boot)

    def module_off(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("clipoff", PORT, "{ enabled: false }", env={}); su = su_login(PORT)
            cols = [c["name"] for c in L.api(PORT, "GET", "/api/collections?perPage=200", None, su)["items"]]
            if "pbmini_clip_payments" in cols: bad.append("se creó la colección con el módulo apagado")
            if raw(PORT, "POST", "/_clip/webhook", {**J}, '{"id":"x"}').status not in (404, 405): bad.append("la ruta del webhook existe con el módulo apagado")
            pb.stop(); root2, full2 = sandbox("clipoff2", {}, "module.exports = {};")
            pb = L.PB(EXE, root2, PORT, env=full2); pb.serve()
            if not pb.wait_ready(): bad.append("sin pbmini.config.js el proyecto no arranca")
            return not bad, "; ".join(bad) or "apagado (por defecto, con o sin config) no hay colección ni rutas y arranca sin ninguna variable CLIP_*"
        finally:
            if pb: pb.stop()
    add("Módulo apagado por defecto: sin colección, sin rutas, sin variables", "Nada cambia respecto a un proyecto sin el módulo", module_off)

    def valid_variants(_):
        bad = []; pb = None
        variants = [("config mínima y URL por variable", BASE_ENV, "{ enabled: true }"), ("URL pública en la config (sin variable)", {k: v for k, v in BASE_ENV.items() if k != "CLIP_PUBLIC_URL"}, '{ enabled: true, publicUrl: "https://pay.lab.example.test" }'),
                    ("todas las opciones válidas", {**BASE_ENV, "CLIP_API_URL": "https://api.payclip.com", "CLIP_WEBHOOK_TOKEN_PREV": "otroTokenAnterior_otroTokenAnterior_xx"},
                     '{ enabled: true, collection: "users", referencePrefix: "TDA", methods: ["credit", "debit", "cash"], openOnCardForm: false, amount: { min: 100, max: 100000000 }, descriptionMax: 100, timeoutSeconds: 30, expiresInMinutes: 60, installmentsMsi: [3, 6, 12], international: true, webhook: { path: "/_pagos/clip", maxBytes: 4096, perIpPerMin: 10 }, create: { perUserPerMin: 1, maxPendingPerUser: 1 }, verify: { minIntervalMs: 500 }, reconcile: { cron: "@hourly", windowHours: 168, batch: 500, staleCreatedMinutes: 1440, minAgeMinutes: 0 }, retention: { failedDays: 3650, paidDays: 3650 }, readRules: true }'),
                    ("API local de laboratorio", {**BASE_ENV, "CLIP_API_URL": "http://127.0.0.1:18799", "CLIP_PUBLIC_URL": "http://127.0.0.1:18740"}, "{ enabled: true }")]
        for label, env, clipcfg in variants:
            try:
                pb, root, full = boot("clipv", PORT, clipcfg, env=env)
            except Exception as e: bad.append(f"{label}: no arrancó ({str(e)[:160]})")
            finally:
                if pb: pb.stop(); pb = None
        return not bad, "; ".join(bad) or f"{len(variants)} combinaciones válidas (incluidas las de los extremos de cada rango) arrancan"
    add("Combinaciones válidas arrancan (extremos de rangos, URL por config o variable)", "Sin falsos positivos", valid_variants)

    # ------------------------------------------------------------------ crear pagos (servidor con Clip FALSO)
    S = {"pb": None, "root": None, "env": None, "su": None, "fake": None, "port": PORT + 10}
    LP = PORT + 10
    seq = [0]
    def livecfg(extra="", per=5, pend=10, tmo=8, rc="{ minAgeMinutes: 0, staleCreatedMinutes: 1 }", ver="{ minIntervalMs: 500, perUserPerMin: 1000 }"):
        return LIVE_CFG % ("{ enabled: true, create: { perUserPerMin: %d, maxPendingPerUser: %d }, timeoutSeconds: %d, reconcile: %s, verify: %s, webhook: { perIpPerMin: 1000 }%s }" % (per, pend, tmo, rc, ver, (", " + extra) if extra else ""))
    def live_boot(cfgtxt=None, env_over=None):
        f = S["fake"]; env = {**BASE_ENV, "CLIP_API_URL": f"http://127.0.0.1:{f.port}", **(env_over or {})}
        if S["root"] is None:
            root, full = sandbox("clipl", env, cfgtxt or livecfg(), PAGES, {"entregas.pb.js": ENTREGA_HOOK}); S["root"] = root
        else:
            root = S["root"]; full = {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}
            open(os.path.join(root, "pb_hooks", "pbmini.config.js"), "w", encoding="utf-8", newline="\n").write(cfgtxt or livecfg())
        S["env"] = full
        pb = L.PB(EXE, root, LP, env=full); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): raise RuntimeError("servidor de Clip no arrancó: " + pb.log()[-400:])
        S["su"] = su_login(LP)
    def live_restart(cfgtxt=None, env_over=None):
        S["pb"].stop(); live_boot(cfgtxt, env_over)
    def mkuser(**fields):
        seq[0] += 1; em = f"c{seq[0]}_{os.getpid()}@lab.test"
        rec = L.api(LP, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True, **fields), S["su"])
        return rec["id"], L.api(LP, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
    def rows(filt=""):
        q = "/api/collections/pbmini_clip_payments/records?perPage=500&sort=created" + (("&filter=" + urllib.parse.quote(filt)) if filt else "")
        return L.api(LP, "GET", q, None, S["su"])["items"]
    def pay(tok, opts, method="POST", path="/clip/raw", raw_body=None):
        body = raw_body if raw_body is not None else json.dumps({"opts": json.dumps(opts)})
        return raw(LP, method, path, {"Authorization": tok, **J} if tok else {**J}, body if method != "GET" else None)
    def jbody(r):
        try: return json.loads(r.body)
        except Exception: return {}

    def live_setup(_):
        S["fake"] = FakeClip(CLIP_TOKEN); live_boot()
        users = L.api(LP, "GET", "/api/collections/users", None, S["su"])
        L.api(LP, "PATCH", "/api/collections/users", dict(fields=users["fields"] + [dict(name="roles", type="select", values=["admin"], maxSelect=1), dict(name="status", type="text")]), S["su"])
        L.api(LP, "POST", "/api/collections", ENTREGAS, S["su"])
        return True, f"servidor con Clip falso en 127.0.0.1:{S['fake'].port} (la API real nunca se contacta)"
    add("Preparación: servidor con el Clip falso", "Listo", live_setup)

    def create_ok(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser()
        r = pay(tok, {**GOOD, "idemKey": "order:abc123:v1"}); j = jbody(r)
        if r.status != 200 or j.get("status") != "pending": return False, f"HTTP {r.status} {r.body[:160]}"
        pid = j["id"]
        if not re.match(r"^[a-z0-9]{15}$", pid): bad.append(f"id de pago {pid!r}")
        if j["reference"] != f"PBM-{pid}-{sig(CLIP_TOKEN, pid)}": bad.append(f"la referencia no coincide con HMAC-SHA256(CLIP_API_TOKEN) en hex: {j['reference']}")
        if len(j["reference"]) > 36: bad.append("referencia de más de 36 caracteres")
        if not j["url"].startswith("https://pago.clip.mx/v3/") or not j["url"].endswith("/card"): bad.append(f"url {j['url']}")
        if j["amount"] != 12345 or j["currency"] != "MXN": bad.append(f"monto/moneda devueltos: {j['amount']} {j['currency']}")
        if set(j) != {"id", "reference", "url", "status", "amount", "currency"}: bad.append(f"la respuesta expone campos de más: {sorted(j)}")
        calls = f.posts()
        if len(calls) != 1: return False, f"{len(calls)} llamadas a Clip (esperaba 1)"
        c = calls[0]; b = c["body"]
        if c["auth"] != CLIP_TOKEN: bad.append("Clip no recibió el token tal cual en Authorization")
        if c["ctype"] != "application/json": bad.append(f"content-type {c['ctype']}")
        if '"amount":123.45' not in c["body_text"].replace(" ", ""): bad.append(f"monto en pesos: {c['body_text'][:120]}")
        if b["currency"] != "MXN" or b["purchase_description"] != "Pedido 1042": bad.append("moneda o descripción")
        if b["redirection_url"] != {"success": PUBLIC + "/pedido/abc123", "error": PUBLIC + "/pedido/abc123?pago=error", "default": PUBLIC + "/"}: bad.append(f"redirection_url {b['redirection_url']}")
        if b["metadata"] != {"external_reference": j["reference"]}: bad.append("metadata.external_reference")
        if b["webhook_url"] != f"{PUBLIC}/_clip/webhook?token={WH_TOKEN}": bad.append(f"webhook_url {b['webhook_url']}")
        if b["custom_payment_options"] != {"payment_method_types": ["credit", "debit"]}: bad.append(f"custom_payment_options {b['custom_payment_options']}")
        if "expires_at" in b: bad.append("no debe enviarse expires_at por defecto")
        row = rows(f'id = "{pid}"')
        if len(row) != 1: return False, "no se guardó la fila"
        r0 = row[0]
        link = f.links[r0["clip_id"]] if r0["clip_id"] in f.links else None
        if not link: bad.append("la fila no guarda el id de Clip")
        if (r0["status"], r0["user"], r0["amount"], r0["currency"], r0["subject_kind"], r0["subject_id"], r0["description"], r0["idem_key"]) != ("pending", uid, 12345, "MXN", "order", "abc123", "Pedido 1042", "order:abc123:v1"): bad.append(f"fila inesperada: {r0}")
        if not r0["expires_at"].startswith(str(time.gmtime().tm_year)) or not r0["url"] or not r0["qr_url"]: bad.append("faltan expires_at, url o qr_url")
        if r0["receipt_no"] or r0["paid_at"] or r0["closed_at"]: bad.append("un pago nuevo no debe tener recibo ni cierre")
        return not bad, "; ".join(bad) or "pago creado: referencia HMAC verificada con Python, link /card, cuerpo oficial a Clip (pesos, 3 retornos, webhook con token, credit+debit), fila `pending` con id de Clip y vencimiento; respuesta mínima"
    add("Crear un pago: lo que Clip recibe y lo que se guarda", "Cuerpo oficial, referencia firmada, fila pending; respuesta sin campos internos", create_ok)

    def amounts(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser()
        for v in (0, 99, 5000001, 100.5, 100.0001, -100, "100", None, True, False, [], {}, 1e21, 10 ** 15, "1e2"):
            body = json.dumps({"opts": json.dumps({**GOOD, "amount": v})})
            r = pay(tok, None, raw_body=body)
            if r.status != 400: bad.append(f"monto {v!r} → {r.status} (debe ser 400 antes de tocar la base)")
        if f.posts(): bad.append(f"se llamó a Clip {len(f.posts())} vez(ces) con montos inválidos")
        if rows(f'user = "{uid}"'): bad.append("se guardó una fila con un monto inválido")
        for cents, text in ((100, "1"), (101, "1.01"), (150, "1.5"), (1999, "19.99"), (12345, "123.45"), (99999, "999.99"), (5000000, "50000"), (1000, "10")):
            u2, t2 = mkuser(); f.clear(); r = pay(t2, {**GOOD, "amount": cents})
            sent = f.posts()[-1]["body_text"].replace(" ", "") if f.posts() else ""
            if r.status != 200 or f'"amount":{text},' not in sent: bad.append(f"{cents} centavos debía viajar como {text} pesos: {sent[:60]}")
        return not bad, "; ".join(bad) or "decimales, texto, negativos, booleanos, nulos, fuera de rango y NaN/Infinity se rechazan antes de llamar a Clip; los montos válidos viajan en pesos exactos (sin errores de coma flotante)"
    add("Monto: solo centavos enteros dentro de rango; sin errores de redondeo hacia Clip", "400 sin llamar a Clip; pesos exactos al enviar", amounts)

    def validation(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser()
        def chk(label, **mods):
            o = json.loads(json.dumps(GOOD))
            for k, v in mods.items():
                if v == "DEL": o.pop(k, None)
                else: o[k] = v
            r = pay(tok, o)
            if r.status != 400: bad.append(f"{label} → {r.status}")
        chk("description vacía", description=""); chk("description en blanco", description="   "); chk("description de 251", description="x" * 251); chk("description con salto", description="a\nb"); chk("description con nulo", description="a\u0000b")
        chk("description numérica", description=5); chk("description nula", description=None); chk("sin description", description="DEL")
        chk("sin subject", subject="DEL"); chk("subject texto", subject="order"); chk("subject sin id", subject={"kind": "order"}); chk("subject.kind en mayúsculas", subject={"kind": "Order", "id": "a"}); chk("subject.kind largo", subject={"kind": "a" * 33, "id": "a"})
        chk("subject.id con espacio", subject={"kind": "order", "id": "a b"}); chk("subject.id largo", subject={"kind": "order", "id": "a" * 65}); chk("subject.id con ../", subject={"kind": "order", "id": "../x"}); chk("subject con clave extra", subject={"kind": "order", "id": "a", "x": 1})
        chk("sin urls", urls="DEL"); chk("urls texto", urls="/x")
        for label, u in (("url absoluta", "https://evil.example.com/x"), ("protocolo relativo", "//evil.example.com"), ("con backslash", "/\\evil"), ("con salto de línea", "/a\nb"), ("con espacio", "/a b"), ("sin barra inicial", "pedido"), ("vacía", ""), ("javascript", "javascript:alert(1)"), ("larga", "/" + "a" * 300), ("nula", None), ("numérica", 5), ("con nulo", "/a\u0000b")):
            for k in ("success", "error", "default"):
                chk(f"urls.{k} {label}", urls={**GOOD["urls"], k: u})
        chk("urls sin default", urls={"success": "/a", "error": "/b"}); chk("urls con clave extra", urls={**GOOD["urls"], "extra": "/x"})
        for label, k in (("idemKey vacía", ""), ("idemKey con espacio", "a b"), ("idemKey larga", "a" * 65), ("idemKey numérica", 5), ("idemKey con salto", "a\nb"), ("idemKey con ../", "../k")): chk(label, idemKey=k)
        for key in ("user", "status", "clip_id", "reference", "receipt_no", "publicUrl", "webhook", "webhookUrl", "url", "id", "currency", "paid_at", "metadata", "__proto__"):
            o = {**GOOD, key: "x"}; r = pay(tok, None, raw_body=json.dumps({"opts": json.dumps(o)}))
            if r.status != 400: bad.append(f"opción desconocida «{key}» aceptada → {r.status}")
        r = pay(tok, None, raw_body=json.dumps({"opts": json.dumps([1])}))
        if r.status != 400: bad.append(f"opts como arreglo → {r.status}")
        r = pay(tok, None, raw_body=json.dumps({"opts": "null"}))
        if r.status != 400: bad.append(f"opts nulo → {r.status}")
        if f.posts(): bad.append(f"se llamó a Clip {len(f.posts())} vez(ces) con opciones inválidas")
        if rows(f'user = "{uid}"'): bad.append("se guardaron filas con opciones inválidas")
        # válidos extremos
        for label, mods in (("descripción de 250", {"description": "x" * 250}), ("urls con consulta y raíz", {"urls": {"success": "/", "error": "/e?x=1&y=2", "default": "/a/b/c.html#f"}}), ("subject.id de 64", {"subject": {"kind": "a", "id": "a" * 64}}), ("kind con guion bajo", {"subject": {"kind": "top_up", "id": "x-1_Y"}})):
            u2, t2 = mkuser(); r = pay(t2, {**GOOD, **mods})
            if r.status != 200: bad.append(f"válido «{label}» rechazado → {r.status} {r.body[:80]}")
        return not bad, "; ".join(bad) or "descripción, sujeto, URLs (absolutas, //, \\, controles, javascript:), idemKey y opciones desconocidas (mass assignment) se rechazan antes de llamar a Clip y sin dejar filas; los valores extremos válidos pasan"
    add("Validación estricta de las opciones de createPayment", "400 sin llamar a Clip ni guardar nada; nunca un destino libre ni campos internos", validation)

    def auth_rules(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser()
        r = raw(LP, "POST", "/clip/raw", {**J}, json.dumps({"opts": json.dumps(GOOD)}))
        if r.status != 401: bad.append(f"anónimo → {r.status}")
        if raw(LP, "POST", "/clip/su", {"Authorization": S["su"], **J}, "{}").status != 401: bad.append("un superusuario (no es usuario de la colección) debe recibir 401")
        if raw(LP, "GET", "/clip/raw", {"Authorization": tok}).status != 500: bad.append("createPayment desde GET debe ser un error de programación (500)")
        if raw(LP, "POST", "/clip/pub", {**J}, "{}").status != 500: bad.append("createPayment en una ruta pública debe ser un error de programación (500)")
        bu, bt = mkuser(); L.api(LP, "PATCH", f"/api/collections/users/records/{bu}", {"status": "suspended"}, S["su"])
        r = pay(bt, GOOD)
        if r.status not in (401, 403): bad.append(f"cuenta bloqueada → {r.status}")
        if f.posts() or rows(f'user = "{bu}"'): bad.append("hubo llamadas o filas de una petición no autorizada")
        return not bad, "; ".join(bad) or "anónimo → 401, superusuario → 401, GET o ruta pública → error de programación, cuenta bloqueada → rechazada; nunca se llama a Clip ni se guarda nada"
    add("Quién puede crear pagos: sesión de usuario, no GET, no público, no bloqueados", "Rechazo sin llamar a Clip", auth_rules)

    def limits(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser(); u2, t2 = mkuser()
        codes = [pay(tok, {**GOOD, "subject": {"kind": "order", "id": f"o{i}"}}).status for i in range(8)]
        if codes[:5] != [200] * 5 or codes[5:] != [429] * 3: bad.append(f"límite por usuario/minuto: {codes}")
        if len(f.posts()) != 5: bad.append(f"Clip recibió {len(f.posts())} llamadas (esperaba 5): un bloqueo no debe llamar a Clip")
        if pay(t2, GOOD).status != 200: bad.append("el límite de un usuario afectó a otro")
        # los intentos inválidos no cuentan para el límite
        u3, t3 = mkuser()
        for i in range(8): pay(t3, {**GOOD, "amount": 1})
        if pay(t3, GOOD).status != 200: bad.append("los intentos inválidos no deben agotar el límite")
        return not bad, "; ".join(bad) or "5 pagos por minuto y usuario; el sexto → 429 sin llamar a Clip; otro usuario no se ve afectado; las peticiones inválidas no cuentan"
    add("Límite de creación por usuario y minuto", "429 desde el sexto; solo cuentan los intentos permitidos", limits)

    def pending_limit(_):
        bad = []; live_restart(livecfg(per=100, pend=3)); f = S["fake"]; f.clear(); uid, tok = mkuser(); u2, t2 = mkuser()
        codes = [pay(tok, {**GOOD, "subject": {"kind": "order", "id": f"o{i}"}}).status for i in range(5)]
        if codes != [200, 200, 200, 429, 429]: bad.append(f"pendientes por usuario: {codes}")
        if pay(t2, GOOD).status != 200: bad.append("el límite de un usuario afectó a otro")
        # al resolverse uno (fallido en Clip), vuelve a haber cupo
        first = rows(f'user = "{uid}"')[0]; f.cancel(first["clip_id"])
        L.api(LP, "PATCH", f"/api/collections/pbmini_clip_payments/records/{first['id']}", {"status": "failed"}, S["su"])
        if pay(tok, {**GOOD, "subject": {"kind": "order", "id": "nuevo"}}).status != 200: bad.append("al cerrarse un pago pendiente debe liberarse un cupo")
        live_restart()
        return not bad, "; ".join(bad) or "máximo de pagos pendientes por usuario (3 en esta configuración): el cuarto → 429; otro usuario no se ve afectado; al cerrarse uno vuelve a haber cupo"
    add("Límite de pagos pendientes por usuario", "429 al exceder; se libera al cerrarse uno", pending_limit)

    def idem(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser(); u2, t2 = mkuser()
        a = jbody(pay(tok, {**GOOD, "idemKey": "k1"})); b = jbody(pay(tok, {**GOOD, "idemKey": "k1"}))
        if not a.get("id") or a != b: bad.append(f"la misma llave debe devolver el MISMO pago: {a} / {b}")
        if len(f.posts()) != 1: bad.append(f"{len(f.posts())} llamadas a Clip con la misma llave (esperaba 1)")
        c = jbody(pay(t2, {**GOOD, "idemKey": "k1"}))
        if not c.get("id") or c["id"] == a["id"]: bad.append("otro usuario con la misma llave no debe reutilizar el pago ajeno")
        d = jbody(pay(tok, {**GOOD, "idemKey": "k2"}))
        if d.get("id") in (a.get("id"), None): bad.append("otra llave debe crear otro pago")
        # una llave ya usada devuelve el pago existente aunque ahora se pida otro monto (la llave identifica el pago)
        e = jbody(pay(tok, {**GOOD, "amount": 99999, "idemKey": "k1"}))
        if e.get("id") != a.get("id") or e.get("amount") != 12345: bad.append(f"la llave identifica al pago original: {e}")
        # los reintentos de una llave ya usada no gastan cupo (5 pagos nuevos por minuto)
        u4, t4 = mkuser(); first = jbody(pay(t4, {**GOOD, "idemKey": "r0"}))
        for _ in range(8): pay(t4, {**GOOD, "idemKey": "r0"})
        if pay(t4, {**GOOD, "idemKey": "r1"}).status != 200: bad.append("los reintentos de una llave ya usada no deben gastar el límite de creación")
        # queda UN solo cupo de creación y 12 hilos piden a la vez el mismo pago nuevo: uno gana el cupo y los demás deben devolver SU pago (no un 429)
        u5, t5 = mkuser()
        for i in range(4): pay(t5, {**GOOD, "subject": {"kind": "order", "id": f"b{i}"}})
        f.clear(); res5 = []; bar5 = threading.Barrier(12)
        def go5():
            bar5.wait(); res5.append(jbody(pay(t5, {**GOOD, "idemKey": "ultimo-cupo"})))
        ts = [threading.Thread(target=go5) for _ in range(12)]; [t.start() for t in ts]; [t.join() for t in ts]
        ids5 = {r.get("id") for r in res5}
        if len(ids5) != 1 or None in ids5: bad.append(f"con un solo cupo y 12 peticiones simultáneas todas deben recibir el mismo pago: {[r.get('id') or r.get('error') for r in res5]}")
        if len(f.posts()) != 1: bad.append(f"con un solo cupo: {len(f.posts())} links creados en Clip (esperaba 1)")
        # carrera: 40 hilos que salen a la vez con la misma llave, en 6 rondas (cada una con un usuario nuevo): con el límite por defecto y con uno amplio
        for rnd in range(8):
            if rnd == 4: live_restart(livecfg(per=100, pend=100)); f = S["fake"]
            u3, t3 = mkuser(); f.clear(); res = []; bar = threading.Barrier(40)
            def go():
                bar.wait(); res.append(jbody(pay(t3, {**GOOD, "idemKey": "carrera"})))
            ts = [threading.Thread(target=go) for _ in range(40)]; [t.start() for t in ts]; [t.join() for t in ts]
            ids = {r.get("id") for r in res}
            if len(ids) != 1 or None in ids: bad.append(f"ronda {rnd}: ids distintos o errores: {[r.get('id') or r for r in res][:4]}")
            if len(f.posts()) != 1: bad.append(f"ronda {rnd}: {len(f.posts())} links creados en Clip (esperaba 1)")
            n3 = len(rows(f'user = "{u3}"'))
            if n3 != 1: bad.append(f"ronda {rnd}: {n3} filas (esperaba 1)")
            if any(r.get("status") != "pending" or not r.get("url") for r in res): bad.append(f"ronda {rnd}: todas las respuestas deben traer el mismo link ya creado")
            if bad: break
        live_restart()
        return not bad, "; ".join(bad) or "idemKey: la misma llave devuelve el mismo pago (una sola llamada a Clip), otro usuario no la comparte y 12 hilos simultáneos crean exactamente un link y una fila"
    add("idemKey: el mismo pago, también con peticiones simultáneas", "Un solo link y una sola fila; cada usuario con su espacio de llaves", idem)

    def failures(_):
        bad = []; f = S["fake"]
        def attempt(label, setup):
            uid, tok = mkuser(); f.clear(); setup(); r = pay(tok, GOOD); f.clear()
            rs = rows(f'user = "{uid}"')
            if r.status != 502: bad.append(f"{label}: HTTP {r.status} (esperaba 502)")
            if "payment provider error" not in r.body or CLIP_TOKEN[6:] in r.body or WH_TOKEN in r.body or "Invalid credentials" in r.body: bad.append(f"{label}: la respuesta al cliente debe ser genérica y sin secretos: {r.body[:120]}")
            if len(rs) != 1 or rs[0]["status"] != "failed" or not rs[0]["closed_at"] or rs[0]["clip_id"]: bad.append(f"{label}: fila {[(x['status'], x['clip_id'][:6], x['closed_at'][:4]) for x in rs]}")
            elif not rs[0]["note"] or len(rs[0]["note"]) > 255 or CLIP_TOKEN[6:] in rs[0]["note"] or "Basic" in rs[0]["note"] or WH_TOKEN in rs[0]["note"]: bad.append(f"{label}: nota con secretos o vacía: {rs[0]['note']!r}")
            return rs[0]["note"] if rs else ""
        notes = {}
        for code in (500, 403, 401, 412, 400): notes[code] = attempt(f"HTTP {code}", lambda c=code: f.fail_next(c))
        for want, code in (("credenciales", 401), ("México", 403), ("límite", 412)):
            if want not in notes[code]: bad.append(f"la nota de {code} debe orientar al operador ({want}): {notes[code]!r}")
        for mode in ("json", "no_id", "bad_id", "id_number", "http_url", "js_url", "evil_host", "no_url", "long_url", "userinfo_url", "empty", "array"):
            def setup(m=mode): f.garbage_mode = m
            attempt(f"respuesta basura «{mode}»", setup)
        f.clear()
        if [x for x in rows("status = 'pending'") if x["clip_id"] == ""]: bad.append("quedaron pagos pending sin link")
        return not bad, "; ".join(bad) or "5 códigos de error de Clip y 12 respuestas basura (JSON roto, sin id, id no UUID, URL http/javascript/otro host/con credenciales/enorme/ausente, vacío, arreglo): 502 genérico al cliente, fila `failed` con nota orientativa sin secretos y sin link"
    add("Clip falla o responde basura al crear", "502 genérico; fila failed con nota sin secretos; nada pending sin link", failures)

    def in_flight(_):
        bad = []; f = S["fake"]; f.clear(); f.delay = 2.0; uid, tok = mkuser(); out = {}
        t = threading.Thread(target=lambda: out.setdefault("r", pay(tok, GOOD))); t.start(); time.sleep(0.8)
        mid = rows(f'user = "{uid}"'); t.join(); f.delay = 0.0
        if len(mid) != 1 or mid[0]["status"] != "created" or not re.match(r"^PBM-[a-z0-9]{15}-[a-f0-9]{8}$", mid[0]["reference"]) or mid[0]["clip_id"]: bad.append(f"mientras Clip responde la fila debe estar `created` con la referencia ya guardada: {[(x['status'], x['reference'], x['clip_id']) for x in mid]}")
        end = rows(f'user = "{uid}"')
        if out.get("r") is None or out["r"].status != 200 or end[0]["status"] != "pending": bad.append("al terminar debe quedar `pending`")
        return not bad, "; ".join(bad) or "la referencia queda guardada (estado `created`) ANTES de llamar a Clip: si el webhook llega muy rápido, ya existe; después pasa a `pending`"
    add("La referencia se guarda antes de llamar a Clip", "Fila created con referencia mientras Clip responde", in_flight)

    def timeout_and_down(_):
        bad = []; live_restart(livecfg(tmo=1)); f = S["fake"]; f.clear(); uid, tok = mkuser(); f.delay = 3.0
        t0 = time.time(); r = pay(tok, GOOD); took = time.time() - t0; f.delay = 0.0
        rs = rows(f'user = "{uid}"')
        if r.status != 502 or took > 2.8 or not rs or rs[0]["status"] != "failed": bad.append(f"timeout: HTTP {r.status} en {took:.1f}s, estado {[x['status'] for x in rs]}")
        elif "conectar" not in rs[0]["note"]: bad.append(f"nota del timeout: {rs[0]['note']!r}")
        # Clip caído (nadie escucha en ese puerto)
        live_restart(livecfg(tmo=1), {"CLIP_API_URL": "http://127.0.0.1:18799"}); uid2, tok2 = mkuser(); r2 = pay(tok2, GOOD); rs2 = rows(f'user = "{uid2}"')
        if r2.status != 502 or not rs2 or rs2[0]["status"] != "failed": bad.append(f"Clip caído: HTTP {r2.status} {[x['status'] for x in rs2]}")
        elif CLIP_TOKEN[6:] in rs2[0]["note"] or "18799" in r2.body: bad.append(f"la nota o la respuesta filtran datos: {rs2[0]['note']!r}")
        # token de otra cuenta: Clip responde 401
        other = "Basic " + base64.b64encode(b"otra-cuenta:otra-clave").decode()
        live_restart(livecfg(), {"CLIP_API_TOKEN": other}); uid3, tok3 = mkuser(); r3 = pay(tok3, GOOD); rs3 = rows(f'user = "{uid3}"')
        if r3.status != 502 or not rs3 or rs3[0]["status"] != "failed" or "credenciales" not in rs3[0]["note"] or other[6:] in r3.body + rs3[0]["note"]: bad.append(f"token equivocado: HTTP {r3.status} {[(x['status'], x['note']) for x in rs3]}")
        live_restart()
        return not bad, "; ".join(bad) or "timeout (respeta timeoutSeconds), Clip caído y token de otra cuenta (401): 502 genérico, fila failed y nota orientativa sin secretos ni URLs internas"
    add("Timeout, Clip caído y credenciales equivocadas", "502 en el plazo configurado; nota sin secretos", timeout_and_down)

    def options_to_clip(_):
        bad = []; live_restart(livecfg('methods: ["credit", "debit", "cash"], openOnCardForm: true, installmentsMsi: [3, 6], international: true, expiresInMinutes: 60')); f = S["fake"]; f.clear(); uid, tok = mkuser()
        j = jbody(pay(tok, GOOD)); b = f.posts()[-1]["body"] if f.posts() else {}
        o = b.get("custom_payment_options", {})
        if o != {"payment_method_types": ["credit", "debit", "cash"], "international_enabled": True, "installments_msi": [3, 6]}: bad.append(f"opciones enviadas a Clip: {o}")
        if j.get("url", "").endswith("/card"): bad.append("con efectivo en los métodos no debe forzarse /card")
        try:
            import datetime as dtm
            e = dtm.datetime.strptime(b["expires_at"][:19], "%Y-%m-%dT%H:%M:%S"); delta = (e - dtm.datetime.utcnow()).total_seconds()
            if not 3500 < delta < 3700: bad.append(f"expires_at a {delta:.0f}s (esperaba ~3600)")
        except Exception as ex: bad.append(f"expires_at ausente o inválido: {ex}")
        live_restart(livecfg('openOnCardForm: false')); f = S["fake"]; f.clear(); uid, tok = mkuser(); j = jbody(pay(tok, GOOD))
        if j.get("url", "").endswith("/card"): bad.append("con openOnCardForm:false no debe añadirse /card")
        live_restart()
        return not bad, "; ".join(bad) or "métodos, meses sin intereses, pago internacional y vigencia llegan a Clip como se configuraron; /card solo con crédito/débito y openOnCardForm"
    add("Las opciones de configuración llegan a Clip", "payment_method_types, installments_msi, international_enabled, expires_at y /card", options_to_clip)

    def refs(_):
        bad = []; f = S["fake"]; f.clear(); seen = set(); pids = []
        for i in range(12):
            uid, tok = mkuser(); j = jbody(pay(tok, GOOD))
            if j.get("reference") in seen: bad.append("referencia repetida")
            seen.add(j.get("reference")); pids.append(j.get("id"))
        if len(seen) != 12 or any(len(r) > 36 or not re.match(r"^PBM-[a-z0-9]{15}-[a-f0-9]{8}$", r) for r in seen): bad.append("formato de las referencias")
        sent = {c["body"]["metadata"]["external_reference"] for c in f.posts()}
        if sent != seen: bad.append("lo enviado a Clip no coincide con lo guardado")
        return not bad, "; ".join(bad) or "12 pagos: referencias únicas, de 36 caracteres como máximo, con la firma esperada, y lo enviado a Clip es lo guardado"
    add("Referencias únicas y consistentes con lo enviado a Clip", "Una por pago, con formato fijo", refs)

    def secrets_live(_):
        bad = []; log = S["pb"].log(); blob = json.dumps(rows())
        for name, v in (("token de la API", CLIP_TOKEN), ("clave base64", CLIP_TOKEN[6:]), ("token del webhook", WH_TOKEN)):
            if v in log: bad.append(f"{name} aparece en el log")
            if v in blob: bad.append(f"{name} aparece en la colección")
        if "Authorization" in blob or "authorization" in blob: bad.append("una cabecera Authorization quedó guardada")
        return not bad, "; ".join(bad) or "tras crear, fallar y reintentar decenas de pagos, ni el token de la API ni el del webhook aparecen en el log ni en la colección"
    add("Los secretos no aparecen en logs ni en la base de datos", "Ni token de la API ni token del webhook", secrets_live)

    # ------------------------------------------------------------------ verificar, webhook y conciliador
    def newpay(**over):
        uid, tok = mkuser(); r = pay(tok, {**GOOD, "subject": {"kind": "order", "id": f"o{seq[0]}"}, **over}); j = jbody(r)
        if r.status != 200: raise RuntimeError(f"no se pudo crear el pago: {r.status} {r.body[:120]}")
        row = rows(f'id = "{j["id"]}"')[0]
        return uid, tok, j["id"], row["clip_id"], j["reference"]
    def newpay_for(uid_tok, n):
        uid, tok = uid_tok; r = pay(tok, {**GOOD, "subject": {"kind": "order", "id": f"x{seq[0]}n{n}"}}); j = jbody(r); row = rows(f'id = "{j["id"]}"')[0]
        return j["id"], row["clip_id"], j["reference"]
    def entregas(pid): return L.api(LP, "GET", "/api/collections/entregas/records?perPage=50&filter=" + urllib.parse.quote(f'pago = "{pid}"'), None, S["su"])["totalItems"]
    def row_of(pid): return rows(f'id = "{pid}"')[0]
    def verify_api(tok, pid): return raw(LP, "POST", "/clip/verify", {"Authorization": tok, **J}, json.dumps({"id": pid}))
    def wh(body, token=WH_TOKEN, method="POST", path="/_clip/webhook", headers=None, raw_body=None):
        q = path + (("?token=" + urllib.parse.quote(token)) if token is not None else "")
        return raw(LP, method, q, {**J, **(headers or {})}, raw_body if raw_body is not None else (json.dumps(body) if body is not None else None))
    def reconcile_now(): return jbody(raw(LP, "POST", "/clip/rc", {"Authorization": S["su"], **J}, "{}"))
    def settle(): time.sleep(0.6)   # supera verify.minIntervalMs (500 ms) entre consultas al mismo pago

    def ver_basic(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok, pid, cid, ref = newpay()
        f.complete(cid, "RCP-ABC123"); f.clear()
        r = verify_api(tok, pid); j = jbody(r)
        if r.status != 200 or j.get("status") != "paid" or j.get("receiptNo") != "RCP-ABC123": bad.append(f"verificar: {r.status} {r.body[:140]}")
        rw = row_of(pid)
        if (rw["status"], rw["receipt_no"]) != ("paid", "RCP-ABC123") or not rw["paid_at"] or not rw["closed_at"] or rw["note"]: bad.append(f"fila: {rw['status']} {rw['receipt_no']} paid_at={rw['paid_at']!r} closed_at={rw['closed_at']!r} note={rw['note']!r}")
        if entregas(pid) != 1: bad.append(f"el hook de pago confirmado corrió {entregas(pid)} veces (esperaba 1)")
        if j.get("url"): bad.append("un pago confirmado no debe seguir ofreciendo el link")
        if len(f.gets(cid)) != 1: bad.append(f"{len(f.gets(cid))} consultas a Clip (esperaba 1)")
        settle(); f.clear(); r2 = verify_api(tok, pid)
        if f.gets() or jbody(r2).get("status") != "paid" or entregas(pid) != 1: bad.append("un pago ya confirmado no se vuelve a consultar ni vuelve a disparar el hook")
        return not bad, "; ".join(bad) or "verificar con Clip completado: `paid` con recibo, fechas y hook nativo UNA vez (la transición pasa por la API de registros); ya confirmado no se consulta de nuevo"
    add("Verificar: Clip completado => paid, una sola vez, con el hook nativo", "paid con recibo; el hook corre una vez; un pago final no se reconsulta", ver_basic)

    def ver_states(_):
        bad = []; f = S["fake"]; f.clear()
        uid, tok, pid, cid, ref = newpay(); before = row_of(pid)["updated"]
        for _i in range(2):
            j = jbody(verify_api(tok, pid)); settle()
            if j.get("status") != "pending": bad.append(f"link recién creado → {j.get('status')}")
        if row_of(pid)["updated"] != before: bad.append("verificar un pago que sigue pendiente no debe escribir en la base")
        f.set_status(cid, "CHECKOUT_PENDING"); j = jbody(verify_api(tok, pid)); settle()
        if j.get("status") != "pending": bad.append("CHECKOUT_PENDING => pending")
        for raw_status in ("COMPLETED", "PAID", "SUCCESS", "checkout_completed", "UNKNOWN", ""):
            f.set_status(cid, raw_status); f.tamper(cid, receipt="R1")
            j = jbody(verify_api(tok, pid)); settle()
            if j.get("status") != "pending": bad.append(f"estado crudo {raw_status!r} no debe dar {j.get('status')}")
        f.fail_next(500); r500 = verify_api(tok, pid); settle()
        if r500.status != 200 or jbody(r500).get("status") != "pending": bad.append(f"si Clip falla al verificar, la ruta del usuario recibe el estado actual (no un error): {r500.status} {r500.body[:80]}")
        f.cancel(cid); j = jbody(verify_api(tok, pid)); rw = row_of(pid)
        if j.get("status") != "failed" or not rw["closed_at"] or rw["receipt_no"]: bad.append(f"cancelado => failed con cierre: {j.get('status')} {rw['closed_at']!r}")
        u2, t2, p2, c2, r2 = newpay(); f.expire(c2); j2 = jbody(verify_api(t2, p2)); rw2 = row_of(p2)
        if j2.get("status") != "expired" or not rw2["closed_at"]: bad.append(f"vencido => expired con cierre: {j2.get('status')}")
        if entregas(pid) or entregas(p2): bad.append("un pago fallido o vencido no debe disparar la entrega")
        return not bad, "; ".join(bad) or "pending/created y estados desconocidos (COMPLETED, PAID, minúsculas, vacío) => pending sin escribir; CANCELLED => failed y EXPIRED => expired, ambos con cierre y sin entrega"
    add("Verificar: pendiente, estados desconocidos, cancelado y vencido", "Solo los 5 estados oficiales; nada ambiguo da paid", ver_states)

    def ver_anomalies(_):
        bad = []; f = S["fake"]; other = newpay(); notes = {}
        cases = (("monto menor", {"amount": 0.5 + 0.0}), ("monto mayor", {"amount": 99999.99}), ("moneda USD", {"currency": "USD"}), ("referencia ajena con firma válida", {"reference": other[4]}), ("referencia vacía", {"reference": ""}), ("referencia basura", {"reference": "PBM-zzzzzzzzzzzzzzz-00000000"}))
        for label, mod in cases:
            f.clear(); uid, tok, pid, cid, ref = newpay(); f.complete(cid, "RCP-" + pid[:6]); f.tamper(cid, **mod); f.clear()
            j = jbody(verify_api(tok, pid)); rw = row_of(pid)
            if j.get("status") != "review" or rw["status"] != "review": bad.append(f"{label}: {j.get('status')} (esperaba review, NUNCA paid ni failed)")
            if rw["receipt_no"] or rw["paid_at"] or rw["closed_at"] or not rw["note"]: bad.append(f"{label}: una anomalía no confirma ni cierra y deja nota: {rw['receipt_no']!r} {rw['paid_at']!r} {rw['closed_at']!r} {rw['note']!r}")
            if entregas(pid): bad.append(f"{label}: disparó la entrega")
            if CLIP_TOKEN[6:] in rw["note"] or WH_TOKEN in rw["note"]: bad.append(f"{label}: nota con secretos")
            notes[label] = rw["note"]
            f.clear(); settle(); verify_api(tok, pid); rec = reconcile_now()
            if f.gets(cid): bad.append(f"{label}: una anomalía no se vuelve a consultar (ni por usuario ni por el conciliador)")
            f.tamper(cid, amount=123.45 if "monto" in label else 123.45, currency="MXN", reference=ref); settle(); verify_api(tok, pid)
            if row_of(pid)["status"] != "review": bad.append(f"{label}: review es final hasta que lo resuelva el operador")
        if "monto" not in notes["monto menor"] or "moneda" not in notes["moneda USD"] or "referencia" not in notes["referencia basura"]: bad.append(f"notas poco claras: {notes}")
        return not bad, "; ".join(bad) or "monto, moneda y referencia (ajena con firma válida, vacía o basura) distintos => review sin confirmar, sin cerrar, sin entrega, con nota sin secretos; no se reconsulta (ni por el conciliador) y no se corrige solo"
    add("Anomalías: Clip dice completado pero no cuadra => review, nunca failed ni paid", "Sin confirmar ni cancelar: el cliente SÍ pagó; no repite la alarma", ver_anomalies)

    def receipts(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok, pid, cid, ref = newpay()
        f.complete(cid, "none"); j = jbody(verify_api(tok, pid))
        if j.get("status") != "pending" or row_of(pid)["receipt_no"]: bad.append(f"completado sin recibo => pending: {j.get('status')}")
        settle(); f.tamper(cid, receipt="RCP-LATE1"); j = jbody(verify_api(tok, pid))
        if j.get("status") != "paid" or row_of(pid)["receipt_no"] != "RCP-LATE1": bad.append(f"al aparecer el recibo => paid: {j.get('status')}")
        # recibo duplicado entre dos pagos
        u1, t1, p1, c1, r1 = newpay(); u2, t2, p2, c2, r2 = newpay(); f.complete(c1, "DUP-1"); f.complete(c2, "DUP-1")
        j1 = jbody(verify_api(t1, p1)); j2 = jbody(verify_api(t2, p2)); rw2 = row_of(p2)
        if (j1.get("status"), j2.get("status")) != ("paid", "review") or "recibo" not in rw2["note"]: bad.append(f"recibo duplicado: {j1.get('status')}/{j2.get('status')} {rw2['note']!r}")
        if entregas(p2): bad.append("el pago con recibo repetido no debe entregarse")
        # carrera: dos pagos con el mismo recibo verificados a la vez, en varias rondas
        for rnd in range(5):
            a = newpay(); b = newpay(); f.complete(a[3], f"DUP-R{rnd}"); f.complete(b[3], f"DUP-R{rnd}"); res = []; bar = threading.Barrier(2)
            def go(t, i): bar.wait(); res.append(verify_api(t, i).status)
            ts = [threading.Thread(target=go, args=(a[1], a[2])), threading.Thread(target=go, args=(b[1], b[2]))]; [t.start() for t in ts]; [t.join() for t in ts]
            for x in (a, b):   # una consulta a Clip pudo tardar o fallar bajo carga: se reintenta tras el intervalo mínimo (la prueba es de CONCURRENCIA, no de latencia)
                if row_of(x[2])["status"] == "pending": settle(); verify_api(x[1], x[2])
            st = sorted([row_of(a[2])["status"], row_of(b[2])["status"]])
            if st != ["paid", "review"] or any(c != 200 for c in res): bad.append(f"ronda {rnd}: dos pagos con el mismo recibo a la vez => {st} {res} (esperaba un paid y un review, sin errores)")
            if entregas(a[2]) + entregas(b[2]) != 1: bad.append(f"ronda {rnd}: entregas {entregas(a[2]) + entregas(b[2])} (esperaba 1)")
        # recibo con formato inválido
        u3, t3, p3, c3, r3 = newpay(); f.complete(c3, "rec ibo/inválido"); j3 = jbody(verify_api(t3, p3))
        if j3.get("status") != "review": bad.append(f"recibo con formato inválido => review: {j3.get('status')}")
        return not bad, "; ".join(bad) or "completado sin recibo => pending hasta que aparece; recibo repetido => el segundo a review (también con dos verificaciones simultáneas: exactamente un paid y una entrega, sin excepciones); recibo con formato inválido => review"
    add("Recibos: ausente, repetido (también en carrera) e inválido", "Un recibo acredita un solo pago", receipts)

    def late(_):
        bad = []; f = S["fake"]
        uid, tok, pid, cid, ref = newpay(); f.cancel(cid); verify_api(tok, pid)
        if row_of(pid)["status"] != "failed": bad.append("preparación: debía quedar failed")
        settle(); f.complete(cid, "LATE-1"); j = jbody(verify_api(tok, pid)); rw = row_of(pid)
        if j.get("status") != "paid" or rw["receipt_no"] != "LATE-1" or "tardío" not in rw["note"] or entregas(pid) != 1: bad.append(f"failed y luego pagado en Clip => paid tardío con nota y entrega: {j.get('status')} {rw['note']!r} entregas={entregas(pid)}")
        u2, t2, p2, c2, r2 = newpay(); f.expire(c2); verify_api(t2, p2); settle(); f.complete(c2, "LATE-2"); j2 = jbody(verify_api(t2, p2))
        if j2.get("status") != "paid" or "expired" not in row_of(p2)["note"]: bad.append(f"expired y luego pagado => paid tardío: {j2.get('status')} {row_of(p2)['note']!r}")
        # un pago ya confirmado no vuelve a failed aunque Clip dijera otra cosa después
        settle(); f.cancel(c2); f.clear(); verify_api(t2, p2)
        if row_of(p2)["status"] != "paid" or f.gets(c2): bad.append("un pago confirmado es final: ni se consulta ni retrocede")
        return not bad, "; ".join(bad) or "un pago que quedó failed/expired y luego se completa en Clip se registra como `paid` tardío (con nota y entrega UNA vez): el cliente pagó; un pago confirmado nunca retrocede"
    add("Pago tardío: failed/expired y después completado en Clip => paid", "Se registra y se entrega una vez; lo confirmado es final", late)

    def stale_read(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.cancel(cid); f.clear(); f.reply_delay = 1.6
        out = {}
        t = threading.Thread(target=lambda: out.setdefault("r", verify_api(tok, pid))); t.start(); time.sleep(0.4)
        f.reply_delay = 0.0; f.complete(cid, "STALE-1"); wh({"id": cid})                 # otra vía confirma el pago mientras la primera respuesta (CANCELLED) aún viaja
        mid = row_of(pid)["status"]; t.join()
        end = row_of(pid)
        if mid != "paid": bad.append(f"preparación: el webhook debía confirmar el pago: {mid}")
        if end["status"] != "paid" or end["receipt_no"] != "STALE-1" or entregas(pid) != 1: bad.append(f"una respuesta vieja (CANCELLED) llegó tarde y movió un pago confirmado: {end['status']} entregas={entregas(pid)}")
        return not bad, "; ".join(bad) or "una lectura vieja de Clip que llega después de confirmar el pago no lo hace retroceder (la transición comprueba el estado ACTUAL dentro de la transacción)"
    add("Una respuesta vieja de Clip no hace retroceder un pago confirmado", "El estado final no cambia; una sola entrega", stale_read)

    def race_verify(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.complete(cid, "RACE-1"); f.clear(); res = []; bar = threading.Barrier(40)
        def go(): bar.wait(); res.append(verify_api(tok, pid).status)
        ts = [threading.Thread(target=go) for _ in range(40)]; [t.start() for t in ts]; [t.join() for t in ts]
        n = entregas(pid)
        if row_of(pid)["status"] != "paid" or n != 1: bad.append(f"40 verificaciones simultáneas: estado {row_of(pid)['status']}, entregas {n} (esperaba paid y 1)")
        if any(c not in (200, 429) for c in res): bad.append(f"códigos inesperados: {sorted(set(res))}")
        if len(f.gets(cid)) > 6: bad.append(f"{len(f.gets(cid))} consultas a Clip para un solo pago (el intervalo mínimo debe acotarlas)")
        # además: webhook + usuario + conciliador a la vez sobre varios pagos
        batch = []
        for _i in range(6): batch.append(newpay()); f.complete(batch[-1][3], f"RACE-B{_i}")
        f.clear(); bar2 = threading.Barrier(18)
        def trio(kind, b):
            bar2.wait()
            if kind == 0: wh({"id": b[3], "origin": "checkout-api", "event_type": "UPDATE"})
            elif kind == 1: verify_api(b[1], b[2])
            else: reconcile_now()
        ts = [threading.Thread(target=trio, args=(k, b)) for b in batch for k in range(3)]; [t.start() for t in ts]; [t.join() for t in ts]
        for b in batch:
            if row_of(b[2])["status"] != "paid" or entregas(b[2]) != 1: bad.append(f"webhook+usuario+conciliador a la vez: {row_of(b[2])['status']} entregas={entregas(b[2])}")
        return not bad, "; ".join(bad) or "40 verificaciones simultáneas del mismo pago: exactamente un cambio a paid y un disparo del hook; webhook, usuario y conciliador a la vez sobre 6 pagos: todos paid con una entrega"
    add("Carrera: muchas verificaciones simultáneas => un solo cambio y un solo hook", "Exactamente una entrega por pago", race_verify)

    def throttle_t(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.clear(); t0 = time.time()
        for _i in range(8): verify_api(tok, pid)
        allowed = 1 + int((time.time() - t0) / 0.5)   # bajo carga las 8 llamadas pueden cruzar una ventana de 500 ms: se permite una consulta más por ventana transcurrida
        if len(f.gets(cid)) > allowed or len(f.gets(cid)) < 1: bad.append(f"8 verificaciones seguidas => {len(f.gets(cid))} consultas a Clip (esperaba 1, máx. {allowed} por el tiempo transcurrido)")
        n1 = len(f.gets(cid)); settle(); verify_api(tok, pid)
        if len(f.gets(cid)) <= n1: bad.append("pasado el intervalo debe volver a consultar")
        f.clear(); end = time.time() + 2.4; n = 0
        while time.time() < end: verify_api(tok, pid); n += 1; time.sleep(0.05)
        g = len(f.gets(cid))
        if g < 3: bad.append(f"un sondeo constante no debe extender la espera: {g} consultas en 2.4 s (esperaba ≥ 3)")
        if g > 6: bad.append(f"el intervalo mínimo no acota las consultas: {g}")
        return not bad, "; ".join(bad) or f"intervalo mínimo por pago: 8 verificaciones seguidas => 1 consulta; pasado el intervalo vuelve a consultar; {g} consultas en 2.4 s de sondeo (solo cuentan las que SÍ se hacen)"
    add("Intervalo mínimo entre consultas a Clip por pago", "Acotado y sin extenderse por los intentos bloqueados", throttle_t)

    def ownership(_):
        bad = []; f = S["fake"]; ua, ta, pid, cid, ref = newpay(); ub, tb = mkuser(); f.clear()
        for label, r in (("verificar", raw(LP, "GET", "/clip/verify?id=" + pid, {"Authorization": tb})), ("leer", raw(LP, "GET", "/clip/get?id=" + pid, {"Authorization": tb}))):
            if r.status != 404: bad.append(f"{label} el pago de otro → {r.status} (esperaba 404 sin revelar si existe)")
        if raw(LP, "GET", "/clip/get?id=zzzzzzzzzzzzzzz", {"Authorization": tb}).status != 404 or raw(LP, "GET", "/clip/get?id=../x", {"Authorization": tb}).status != 404: bad.append("ids inexistentes o inválidos => 404")
        if f.gets(): bad.append("consultar un pago ajeno provocó llamadas a Clip")
        sid = row_of(pid)["subject_id"]
        lst = jbody(raw(LP, "GET", f"/clip/list?kind=order&sid={sid}", {"Authorization": tb}))
        if lst.get("items"): bad.append("la lista de otro usuario no debe incluir pagos ajenos")
        mine_l = jbody(raw(LP, "GET", f"/clip/list?kind=order&sid={sid}", {"Authorization": ta}))
        if [i["id"] for i in mine_l.get("items", [])] != [pid]: bad.append(f"la lista del dueño: {[i.get('id') for i in mine_l.get('items', [])]}")
        for qs in ("kind=Order&sid=x", "kind=order&sid=a%20b", "kind=%27&sid=x"):
            if raw(LP, "GET", "/clip/list?" + qs, {"Authorization": ta}).status != 400: bad.append(f"consulta de lista inválida {qs} => 400")
        mine = jbody(raw(LP, "GET", "/clip/get?id=" + pid, {"Authorization": ta}))
        want = {"id", "reference", "status", "amount", "currency", "description", "subject", "url", "receiptNo", "paidAt", "expiresAt", "created"}
        if set(mine) != want: bad.append(f"campos de get: {sorted(set(mine) ^ want)}")
        if "clip_id" in json.dumps(mine) or "note" in mine: bad.append("get expone datos internos")
        if raw(LP, "GET", "/clip/vsu?id=" + pid, {"Authorization": S["su"]}).status != 200: bad.append("un superusuario debe poder verificar cualquier pago")
        if raw(LP, "GET", "/clip/get?id=" + pid, {}).status != 401: bad.append("anónimo => 401")
        if raw(LP, "GET", "/clip/vpub", {}).status != 500: bad.append("verify en ruta pública => error de programación")
        bu, bt = mkuser(); L.api(LP, "PATCH", f"/api/collections/users/records/{bu}", {"status": "suspended"}, S["su"])
        if raw(LP, "GET", "/clip/get?id=" + pid, {"Authorization": bt}).status not in (401, 403): bad.append("cuenta bloqueada => rechazada")
        # pago sin link (created): no hay nada que preguntar
        cu, ct = mkuser(); crow = L.api(LP, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference="PBM-ccccccccccccccc-aaaaaaaa", amount=100, currency="MXN", status="created", user=cu, subject_kind="order", subject_id="s"), S["su"])
        f.clear(); jc = jbody(verify_api(ct, crow["id"]))
        if f.gets() or jc.get("status") != "created": bad.append(f"un pago `created` sin link no se consulta: {jc.get('status')} {len(f.gets())}")
        # límite de verificaciones por usuario
        live_restart(livecfg(ver="{ minIntervalMs: 500, perUserPerMin: 30 }")); u9, t9, p9, c9, r9 = newpay(); codes = [verify_api(t9, p9).status for _i in range(34)]
        live_restart()
        if codes[:30] != [200] * 30 or any(c != 429 for c in codes[30:]): bad.append(f"límite de verificaciones por usuario (30/min): {codes}")
        return not bad, "; ".join(bad) or "pagos ajenos: 404 sin llamar a Clip; get sin datos internos; lista solo propia; superusuario sí; anónimo 401; ruta pública error; bloqueado rechazado; `created` sin link no se consulta; 30 verificaciones por minuto y usuario"
    add("Propiedad: solo el dueño (o un superusuario) verifica, lee y lista", "404/401/403 sin llamar a Clip; respuesta sin datos internos", ownership)

    def webhook_auth(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.clear(); body = {"id": cid, "origin": "checkout-api", "event_type": "UPDATE"}
        for label, t in (("sin token", None), ("vacío", ""), ("incorrecto", "x" * 43), ("prefijo", WH_TOKEN[:-1]), ("con sufijo", WH_TOKEN + "x"), ("mayúsculas", WH_TOKEN.upper()), ("el token de la API", CLIP_TOKEN[6:50])):
            r = wh(body, token=t)
            if r.status != 403: bad.append(f"{label} → {r.status}")
        if f.gets(): bad.append("un token inválido provocó consultas a Clip")
        for m in ("GET", "PUT", "DELETE", "PATCH"):
            r = wh(None, method=m)
            if r.status in (200, 201, 204): bad.append(f"{m} → {r.status}")
        if wh(body, path="/_clip/otra").status in (200, 403): bad.append("otra ruta del webhook no debe existir")
        if wh(body).status != 200: bad.append("con el token correcto debe responder 200")
        return not bad, "; ".join(bad) or "sin token, vacío, parcial, con sufijo, mayúsculas y el token de la API => 403 sin consultar a Clip; otros métodos no pasan; el correcto => 200"
    add("Webhook: autenticación por token en la URL", "Solo el token exacto; el resto 403 y sin consultas", webhook_auth)

    def webhook_bodies(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.clear()
        unknown = "3f2a9c1e-5b7d-4e8a-9c0b-1a2b3c4d5e6f"
        for label, b, st in (("JSON roto", "{", 400), ("arreglo", "[1]", 400), ("null", "null", 400), ("sin id", "{}", 400), ("id numérico", '{"id":5}', 400), ("id objeto", '{"id":{}}', 400), ("id arreglo", '{"id":["' + cid + '"]}', 400),
                             ("id no UUID", '{"id":"abc"}', 400), ("id con inyección", '{"id":"\' OR 1=1 --"}', 400), ("id con unicode", '{"id":"3f2a9c1e-5b7d-4e8a-9c0b-1a2b3c4d5e6\\uff10"}', 400), ("id con espacio", '{"id":" ' + cid + '"}', 400),
                             ("forma antigua payment_request_id", '{"payment_request_id":"' + cid + '"}', 400), ("basura final", '{"id":"' + cid + '"} x', 400)):
            r = wh(None, raw_body=b)
            if r.status != st: bad.append(f"{label} → {r.status} (esperaba {st})")
        if f.gets(cid): bad.append("alguna variante inválida provocó una consulta al id real")
        r = wh(None, raw_body=json.dumps({"id": unknown})); f.clear(); r2 = wh({"id": unknown, "origin": "x", "event_type": "INSERT", "extra": "z"})
        if (r.status, r2.status) != (200, 200) or r.body != '{"ok":true}' or r2.body != '{"ok":true}': bad.append(f"id desconocido: {r.status} {r.body!r}")
        if f.gets(): bad.append("un UUID que no es nuestro provocó una consulta a Clip")
        big = wh(None, raw_body=json.dumps({"id": cid, "pad": "x" * 5000}))
        if big.status not in (400, 413): bad.append(f"cuerpo mayor que maxBytes → {big.status}")
        f.clear(); okr = wh({"id": cid, "origin": "checkout-api", "event_type": "UPDATE", "status": "CHECKOUT_COMPLETED", "amount": 1})
        if okr.status != 200 or okr.body != '{"ok":true}' or row_of(pid)["status"] != "pending": bad.append("el estado que traiga el aviso NO se usa: sigue pending hasta que Clip lo confirme")
        if len(f.gets(cid)) != 1: bad.append(f"un id real provoca exactamente una consulta: {len(f.gets(cid))}")
        up = wh({"id": cid.upper()}); settle()
        return not bad, "; ".join(bad) or "JSON roto, arreglo, nulo, sin id, id numérico/objeto/arreglo/no UUID/inyección/unicode, forma antigua y cuerpos enormes => 400/413 sin consultas; un UUID ajeno => 200 igual y sin llamar a Clip; lo que diga el aviso (estado, monto) no se usa"
    add("Webhook: cuerpos inválidos, ids ajenos y contenido no confiable", "400/413 en lo malformado; 200 idéntico y sin consulta para ids ajenos", webhook_bodies)

    def webhook_flow(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.complete(cid, "WH-OK1"); f.clear()
        r = wh({"id": cid, "origin": "checkout-api", "event_type": "UPDATE"})
        if r.status != 200 or row_of(pid)["status"] != "paid" or row_of(pid)["receipt_no"] != "WH-OK1": bad.append(f"el webhook de un pago completado debe confirmarlo: {row_of(pid)['status']}")
        if entregas(pid) != 1: bad.append("entregas tras el webhook")
        # webhooks repetidos y simultáneos
        u2, t2, p2, c2, r2 = newpay(); f.complete(c2, "WH-OK2"); res = []; bar = threading.Barrier(20)
        def go(): bar.wait(); res.append(wh({"id": c2}).status)
        ts = [threading.Thread(target=go) for _ in range(20)]; [t.start() for t in ts]; [t.join() for t in ts]
        if row_of(p2)["status"] != "paid" or entregas(p2) != 1 or any(c != 200 for c in res): bad.append(f"20 webhooks simultáneos: {row_of(p2)['status']} entregas={entregas(p2)} códigos={sorted(set(res))}")
        # el webhook llega justo tras una consulta del usuario: espera el intervalo y verifica igualmente
        u3, t3, p3, c3, r3 = newpay(); verify_api(t3, p3); f.complete(c3, "WH-OK3"); t0 = time.time(); wh({"id": c3}); took = time.time() - t0
        if row_of(p3)["status"] != "paid": bad.append(f"el webhook tras una consulta reciente no debe perder el pago: {row_of(p3)['status']}")
        if took > 2.5: bad.append(f"el webhook tardó {took:.1f}s")
        # cuenta bloqueada con pago ya realizado: el hecho contable se registra (D8)
        u4, t4, p4, c4, r4 = newpay(); L.api(LP, "PATCH", f"/api/collections/users/records/{u4}", {"status": "banned"}, S["su"]); f.complete(c4, "WH-OK4"); wh({"id": c4})
        if row_of(p4)["status"] != "paid": bad.append("un pago ya hecho por una cuenta bloqueada se registra igualmente")
        # Clip falla durante el webhook: 200 igualmente y el conciliador lo recupera
        u5, t5, p5, c5, r5 = newpay(); f.complete(c5, "WH-OK5"); f.fail_next(500); r5w = wh({"id": c5})
        if r5w.status != 200 or row_of(p5)["status"] != "pending": bad.append(f"Clip falla en el webhook: HTTP {r5w.status} estado {row_of(p5)['status']}")
        settle(); rc = reconcile_now()
        if row_of(p5)["status"] != "paid": bad.append(f"el conciliador debe recuperar el aviso fallido: {row_of(p5)['status']} {rc}")
        return not bad, "; ".join(bad) or "el webhook confirma pagos completados (una entrega aunque lleguen 20 a la vez); espera el intervalo si hubo una consulta reciente; una cuenta bloqueada con pago hecho se registra; si Clip falla responde 200 y el conciliador lo recupera"
    add("Webhook: confirma, es idempotente y se recupera si Clip falla", "paid con una entrega; 200 siempre", webhook_flow)

    def webhook_limits_and_prev(_):
        bad = []; f = S["fake"]
        live_restart(livecfg('webhook: { perIpPerMin: 8, path: "/_pagos/clip" }'), {"CLIP_WEBHOOK_TOKEN_PREV": "tokenAnterior_tokenAnterior_tokenAnterior"}); f = S["fake"]
        uid, tok, pid, cid, ref = newpay(); path = "/_pagos/clip"
        if wh({"id": cid}, path="/_clip/webhook").status in (200, 403): bad.append("la ruta por defecto no debe existir cuando se configura otra")
        if wh({"id": cid}, token="tokenAnterior_tokenAnterior_tokenAnterior", path=path).status != 200: bad.append("el token anterior (_PREV) debe valer durante la rotación")
        codes = [wh({"id": cid}, token="x" * 43, path=path).status for _i in range(8)]
        if codes[-1] != 429: bad.append(f"el límite por IP debe cortar los intentos con token malo: {codes}")
        if wh({"id": cid}, path=path).status != 429: bad.append("con el límite agotado ni el token correcto pasa (el límite va ANTES del token: adivinarlo no sale gratis)")
        live_restart()
        return not bad, "; ".join(bad) or "webhook.path configurable; _PREV acepta el token anterior; perIpPerMin corta los intentos (incluso el token correcto) antes de comprobar el token"
    add("Webhook: ruta configurable, token anterior (_PREV) y límite por IP", "429 al exceder; el límite va antes del token", webhook_limits_and_prev)

    def reconcile_t(_):
        bad = []; f = S["fake"]; f.clear(); live_restart(livecfg(rc="{ minAgeMinutes: 0, staleCreatedMinutes: 1, batch: 50 }")); f = S["fake"]
        pays = [newpay() for _i in range(5)]
        f.complete(pays[0][3], "RC-1"); f.cancel(pays[1][3]); f.expire(pays[2][3]); f.complete(pays[3][3], "RC-2"); f.tamper(pays[3][3], amount=999.0)
        settle(); rc = reconcile_now()
        got = [row_of(p[2])["status"] for p in pays]
        if got != ["paid", "failed", "expired", "review", "pending"]: bad.append(f"estados tras conciliar: {got} {rc}")
        if rc.get("paid", 0) < 1 or rc.get("review", 0) < 1: bad.append(f"resumen: {rc}")
        if entregas(pays[0][2]) != 1 or entregas(pays[3][2]) != 0: bad.append("entregas del conciliador")
        f.clear(); settle(); rc2 = reconcile_now()
        if row_of(pays[3][2])["status"] != "review" or any(g["path"].endswith(pays[3][3]) for g in f.gets()): bad.append("la anomalía no se reconsulta ni cambia")
        if any(g["path"].endswith(pays[0][3]) for g in f.gets()): bad.append("los pagos ya confirmados no se reconsultan")
        # un error con un pago no detiene a los demás
        batch = [newpay() for _i in range(4)]
        for b in batch: f.complete(b[3], "RC-E" + b[2][:4])
        f.clear(); f.fail_next(500); rc3 = reconcile_now(); st = sorted(row_of(b[2])["status"] for b in batch)
        if st.count("paid") != 3 or rc3.get("errors", 0) != 1: bad.append(f"un fallo no debe detener al resto: {st} {rc3}")
        settle(); reconcile_now()
        if any(row_of(b[2])["status"] != "paid" for b in batch): bad.append("el pago que falló se recupera en la siguiente ejecución")
        # candado: ejecuciones simultáneas no duplican trabajo
        more = [newpay() for _i in range(14)]
        for b in more: f.complete(b[3], "RC-L" + b[2][:4]); 
        f.clear(); f.reply_delay = 0.15; res = []; bar = threading.Barrier(4)
        def go(): bar.wait(); res.append(reconcile_now())
        ts = [threading.Thread(target=go) for _ in range(4)]; [t.start() for t in ts]; [t.join() for t in ts]
        f.reply_delay = 0.0
        if sum(1 for r in res if r.get("running")) < 1: bad.append(f"ninguna de 4 ejecuciones simultáneas respetó el candado: {res}")
        reconcile_now()
        if any(row_of(b[2])["status"] != "paid" or entregas(b[2]) != 1 for b in more): bad.append("conciliaciones simultáneas: todos paid con una sola entrega")
        dup = max(len(f.gets(b[3])) for b in more)
        if dup > 2: bad.append(f"el candado y el intervalo mínimo no evitaron consultas duplicadas: un pago se consultó {dup} veces")
        # la tarea programada existe
        crons = L.api(LP, "GET", "/api/crons", None, S["su"])
        if not any(c.get("id") == "pbmini_clip_reconcile" for c in crons): bad.append("falta la tarea pbmini_clip_reconcile")
        return not bad, "; ".join(bad) or "el conciliador confirma, cancela y vence según Clip, deja las anomalías en review sin repetirlas, no reconsulta lo final, un error no detiene al resto, ejecuciones simultáneas no duplican y la tarea programada está registrada"
    add("Conciliador: recupera avisos perdidos, aislado y sin repetir alarmas", "paid/failed/expired/review correctos; reentrante; tarea registrada", reconcile_t)

    def reconcile_batch_stale(_):
        bad = []; f = S["fake"]; live_restart(livecfg(rc="{ minAgeMinutes: 0, staleCreatedMinutes: 1, batch: 2 }")); f = S["fake"]
        pays = [newpay() for _i in range(5)]
        for i, b in enumerate(pays): f.complete(b[3], f"RB-{i}")
        rc = reconcile_now(); done = [row_of(p[2])["status"] for p in pays]
        if done.count("paid") != 2 or rc.get("checked") != 2: bad.append(f"batch=2 => procesa 2 por ejecución: {done} {rc}")
        if done[-1] != "paid" or done[-2] != "paid": bad.append(f"se procesan primero los más nuevos: {done}")
        cu, ct = mkuser(); crow = L.api(LP, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference="PBM-ddddddddddddddd-bbbbbbbb", amount=100, currency="MXN", status="created", user=cu), S["su"])
        time.sleep(62); rc2 = reconcile_now(); rw = L.api(LP, "GET", f"/api/collections/pbmini_clip_payments/records/{crow['id']}", None, S["su"])
        if rw["status"] != "failed" or "creación" not in rw["note"] or not rw["closed_at"] or rc2.get("stale", 0) < 1: bad.append(f"un `created` colgado más de staleCreatedMinutes => failed: {rw['status']} {rw['note']!r} {rc2}")
        live_restart()
        return not bad, "; ".join(bad) or "batch limita cada ejecución (más nuevos primero); un `created` sin link colgado más de staleCreatedMinutes pasa a failed con nota y cierre"
    add("Conciliador: lote limitado y creación colgada", "batch por ejecución; created colgado => failed", reconcile_batch_stale)

    def secrets_p4(_):
        bad = []; log = S["pb"].log(); blob = json.dumps(rows())
        for name, v in (("token de la API", CLIP_TOKEN), ("clave base64", CLIP_TOKEN[6:]), ("token del webhook", WH_TOKEN)):
            if v in log: bad.append(f"{name} aparece en el log")
            if v in blob: bad.append(f"{name} aparece en la colección")
        return not bad, "; ".join(bad) or "tras verificar, anomalías, webhooks y conciliaciones, ningún secreto aparece en el log ni en la colección"
    add("Los secretos siguen fuera de logs y base de datos (verificación y webhook)", "Ni token de la API ni token del webhook", secrets_p4)

    # ------------------------------------------------------------------ reembolso, entrega, retención, anonimización y CLI
    def op(body, tok=None): return raw(LP, "POST", "/clip/op", {"Authorization": tok or S["su"], **J}, json.dumps(body))
    def paidpay(receipt=None):
        f = S["fake"]; uid, tok, pid, cid, ref = newpay(); f.complete(cid, receipt or "RCPT-" + pid[:8]); verify_api(tok, pid)
        if row_of(pid)["status"] != "paid": raise RuntimeError("preparación: el pago no quedó paid")
        return uid, tok, pid, cid, ref
    def patch(pid, **kw): return L.api(LP, "PATCH", f"/api/collections/pbmini_clip_payments/records/{pid}", kw, S["su"])

    def refund_ok(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = paidpay("RCPT-RF1"); f.clear()
        r = op({"op": "refund", "id": pid}); j = jbody(r)
        if r.status != 200 or j.get("status") != "refunded" or j.get("payment", {}).get("status") != "refunded": bad.append(f"reembolsar: {r.status} {r.body[:140]}")
        rp = f.refund_posts()
        if len(rp) != 1: return False, f"{len(rp)} llamadas a /refunds (esperaba 1)"
        c = rp[0]; b = c["body"]
        if b["reference"] != {"type": "receipt", "id": "RCPT-RF1"} or '"amount":123.45' not in c["body_text"].replace(" ", "") or not b["reason"].startswith("Reembolso PBM-"): bad.append(f"cuerpo del reembolso: {c['body_text'][:140]}")
        if c["idem"] != f"refund-{pid}": bad.append(f"idempotency-key {c['idem']!r}")
        if c["auth"] != CLIP_TOKEN: bad.append("Authorization hacia /refunds")
        rw = row_of(pid)
        if (rw["status"], rw["receipt_no"]) != ("refunded", "RCPT-RF1") or not rw["refund_id"] or rw["refund_receipt_no"] != "RCPT-RF1" or not rw["refunded_at"] or not rw["closed_at"] or "reembolsado en Clip" not in rw["note"]: bad.append(f"fila: {rw['status']} refund_id={rw['refund_id']!r} rec={rw['refund_receipt_no']!r} note={rw['note']!r}")
        if rw["refund_id"].startswith("rq:"): bad.append("el candado no se sustituyó por el id del reembolso de Clip")
        r2 = op({"op": "refund", "id": pid})
        if r2.status != 200 or jbody(r2).get("changed") is not False or len(f.refund_posts()) != 1: bad.append("reembolsar de nuevo no debe llamar a Clip ni cambiar nada")
        # carrera: 30 hilos reembolsan el mismo pago a la vez, en 6 rondas (cada una con un pago nuevo); Clip tarda para que el ganador conserve el candado
        for rnd in range(6):
            u2, t2, p2, c2, r2_ = paidpay(); f.clear(); f.delay = 0.4; res = []; bar = threading.Barrier(30)
            def go(): bar.wait(); res.append(op({"op": "refund_mod", "id": p2}).status)
            ts = [threading.Thread(target=go) for _ in range(30)]; [t.start() for t in ts]; [t.join() for t in ts]; f.delay = 0.0
            if len(f.refund_posts()) != 1 or row_of(p2)["status"] != "refunded" or any(c not in (200, 409) for c in res): bad.append(f"ronda {rnd}: 30 reembolsos simultáneos: {len(f.refund_posts())} llamadas a Clip, estado {row_of(p2)['status']}, códigos {sorted(set(res))} (esperaba 1 llamada, refunded, sin 500)")
            if bad: break
        return not bad, "; ".join(bad) or "reembolso total: Clip recibe el recibo, el monto en pesos exactos, el motivo y la idempotency-key; solo con la aprobación de Clip pasa a `refunded` (con id y recibo del reembolso); repetirlo no llama a Clip; 10 hilos a la vez => una sola solicitud"
    add("Reembolso total: primero a Clip, después `refunded`, y nunca dos veces", "refunded con id de Clip; idempotente; una llamada aun con 10 hilos", refund_ok)

    def refund_rules(_):
        bad = []; f = S["fake"]; f.clear()
        pend = newpay(); fail = newpay(); f.cancel(fail[3]); verify_api(fail[1], fail[2]); rev = newpay(); f.complete(rev[3], "RV-1"); f.tamper(rev[3], amount=1.0); verify_api(rev[1], rev[2])
        cu, ct = mkuser(); crow = L.api(LP, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference="PBM-eeeeeeeeeeeeeee-cccccccc", amount=100, currency="MXN", status="created", user=cu), S["su"])
        norec = L.api(LP, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference="PBM-fffffffffffffff-dddddddd", amount=100, currency="MXN", status="paid", user=cu), S["su"])
        for label, pid in (("pending", pend[2]), ("failed", fail[2]), ("review", rev[2]), ("created", crow["id"]), ("paid sin recibo", norec["id"])):
            r = op({"op": "refund", "id": pid})
            if r.status != 409: bad.append(f"reembolsar un pago {label} → {r.status} (esperaba 409)")
        if f.refund_posts(): bad.append("se llamó a /refunds con pagos que no se pueden reembolsar")
        if op({"op": "refund", "id": "zzzzzzzzzzzzzzz"}).status != 404 or op({"op": "refund", "id": "../x"}).status != 404: bad.append("ids inexistentes o inválidos => 404")
        up = paidpay()
        if raw(LP, "POST", "/clip/refuser", {"Authorization": up[1], **J}, "{}").status != 401: bad.append("un usuario normal (aunque sea el dueño) no puede reembolsar: 401")
        if raw(LP, "GET", "/clip/refget", {"Authorization": S["su"]}).status != 500: bad.append("reembolsar desde GET debe ser un error de programación")
        if raw(LP, "POST", "/clip/op", {**J}, json.dumps({"op": "refund", "id": up[2]})).status != 401: bad.append("anónimo => 401")
        if f.refund_posts() or row_of(up[2])["status"] != "paid": bad.append("un intento no autorizado movió dinero")
        return not bad, "; ".join(bad) or "solo se reembolsan pagos `paid` con recibo; pending/failed/review/created/sin recibo => 409 sin llamar a Clip; solo un superusuario, nunca desde GET, ni el dueño ni anónimos"
    add("Reembolso: solo pagos confirmados con recibo y solo un superusuario", "409/401/404 sin llamar a Clip", refund_rules)

    def refund_errors(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = paidpay(); f.clear()
        for http, code, frag in ((400, "AI1400", "saldo"), (400, "AI1803", "180 días"), (400, "AI1805", "deshabilitados"), (409, "AI1807", "en proceso"), (404, "AI1300", "no encontró"), (400, "ZZ9999", "refund error")):
            f.refund_error.append((http, code)); r = op({"op": "refund", "id": pid}); rw = row_of(pid)
            if r.status != 409 or frag.lower() not in r.body.lower(): bad.append(f"{code}: HTTP {r.status} {r.body[:100]}")
            if rw["status"] != "paid" or rw["refund_id"]: bad.append(f"{code}: el pago debe seguir paid y sin candado: {rw['status']} {rw['refund_id']!r}")
        f.fail_next(500); r = op({"op": "refund", "id": pid})
        if r.status != 502 or row_of(pid)["refund_id"]: bad.append(f"Clip 500 => 502 y sin candado: {r.status} {row_of(pid)['refund_id']!r}")
        f.refund_mode = "decline"; r = op({"op": "refund", "id": pid})
        if r.status != 409 or "rechaz" not in r.body or row_of(pid)["status"] != "paid" or row_of(pid)["refund_id"]: bad.append(f"rechazado por el emisor: {r.status} {r.body[:100]}")
        f.refund_mode = "unknown"; r = op({"op": "refund", "id": pid})
        if r.status != 409 or row_of(pid)["status"] != "paid": bad.append(f"estado desconocido de Clip NO cuenta como aprobado: {r.status}")
        f.refund_mode = None
        r = op({"op": "refund", "id": pid})
        if r.status != 200 or row_of(pid)["status"] != "refunded": bad.append(f"tras corregirse, el reintento debe funcionar: {r.status}")
        # candados: reciente => en proceso; antiguo => se reemplaza; real o manual => ya registrado
        u2, t2, p2, c2, r2 = paidpay(); f.clear()
        patch(p2, refund_id=f"rq:{int(time.time() * 1000)}:abcdef")
        if op({"op": "refund", "id": p2}).status != 409 or f.refund_posts(): bad.append("un candado reciente (otro reembolso en curso) => 409 sin llamar a Clip")
        patch(p2, refund_id=f"rq:{int((time.time() - 300) * 1000)}:abcdef")
        r = op({"op": "refund", "id": p2})
        if r.status != 200 or row_of(p2)["status"] != "refunded": bad.append(f"un candado viejo (proceso caído) se reemplaza: {r.status}")
        u3, t3, p3, c3, r3 = paidpay(); patch(p3, refund_id="manual-x")
        if op({"op": "refund", "id": p3}).status != 409: bad.append("un reembolso ya registrado => 409")
        return not bad, "; ".join(bad) or "errores de Clip traducidos (saldo, 180 días, deshabilitado, en proceso, no encontrado, código desconocido), 500 => 502, rechazo del emisor y estado desconocido: el pago sigue `paid` y SIN candado; el reintento funciona; candado reciente/viejo/manual bien tratados"
    add("Reembolso: errores de Clip, rechazos y candados", "El pago sigue paid sin candado; se puede reintentar", refund_errors)

    def refunded_manual(_):
        bad = []; f = S["fake"]; uid, tok, pid, cid, ref = paidpay(); f.clear()
        r = op({"op": "refunded", "id": pid}); rw = row_of(pid)
        if r.status != 200 or rw["status"] != "refunded" or rw["refund_id"] != f"manual-{pid}" or not rw["refunded_at"] or "a mano" not in rw["note"]: bad.append(f"registrar un reembolso hecho a mano: {r.status} {rw['status']} {rw['refund_id']!r}")
        if f.refund_posts(): bad.append("registrar a mano no debe llamar a Clip")
        if op({"op": "refunded", "id": pid}).status != 200: bad.append("repetir el registro es idempotente")
        pend = newpay()
        if op({"op": "refunded", "id": pend[2]}).status != 409: bad.append("solo un pago paid puede registrarse como reembolsado")
        return not bad, "; ".join(bad) or "refunded registra (sin llamar a Clip) un reembolso hecho en el panel: refund_id manual-<id>, nota y fecha; idempotente; solo desde paid"
    add("Registrar a mano un reembolso hecho en el panel de Clip", "Sin llamar a Clip; solo desde paid", refunded_manual)

    def review_resolve(_):
        bad = []; f = S["fake"]
        def anomaly():
            u, t, pid, cid, ref = newpay(); f.complete(cid, "RV-" + pid[:6]); f.tamper(cid, amount=1.0); verify_api(t, pid)
            if row_of(pid)["status"] != "review": raise RuntimeError("preparación")
            return t, pid, cid
        t, pid, cid = anomaly(); f.tamper(cid, amount=123.45); r = op({"op": "review", "id": pid, "to": "paid", "receipt": "MAN-0001"}); rw = row_of(pid)
        if r.status != 200 or rw["status"] != "paid" or rw["receipt_no"] != "MAN-0001" or not rw["paid_at"] or not rw["closed_at"] or "resuelta como pagada" not in rw["note"]: bad.append(f"review => paid: {r.status} {rw['status']} {rw['receipt_no']!r} {rw['note']!r}")
        if entregas(pid) != 1: bad.append(f"resolver a pagado dispara el hook de entrega una vez: {entregas(pid)}")
        t2, p2, c2 = anomaly(); r = op({"op": "review", "id": p2, "to": "failed"}); rw2 = row_of(p2)
        if r.status != 200 or rw2["status"] != "failed" or not rw2["closed_at"] or entregas(p2): bad.append(f"review => failed: {r.status} {rw2['status']}")
        t3, p3, c3 = anomaly()
        for label, body, st in (("destino inválido", {"op": "review", "id": p3, "to": "refunded"}, 400), ("destino ausente", {"op": "review", "id": p3}, 400), ("recibo con formato inválido", {"op": "review", "id": p3, "to": "paid", "receipt": "a b/c"}, 400),
                                ("recibo con failed", {"op": "review", "id": p3, "to": "failed", "receipt": "X-1"}, 400), ("recibo ya usado", {"op": "review", "id": p3, "to": "paid", "receipt": "MAN-0001"}, 409),
                                ("pago que no está en review", {"op": "review", "id": pid, "to": "failed"}, 409), ("pago inexistente", {"op": "review", "id": "zzzzzzzzzzzzzzz", "to": "paid"}, 404)):
            r = op(body)
            if r.status != st: bad.append(f"{label} → {r.status} (esperaba {st})")
        if row_of(p3)["status"] != "review": bad.append("los intentos inválidos no deben mover el pago")
        r = op({"op": "review", "id": p3, "to": "paid"})
        if r.status != 200 or row_of(p3)["status"] != "paid" or row_of(p3)["receipt_no"]: bad.append("resolver a pagado sin recibo es válido (queda sin recibo)")
        return not bad, "; ".join(bad) or "una anomalía se resuelve a mano (solo desde review): a pagado (con recibo opcional, único y con formato válido; dispara la entrega una vez) o a fallido; destinos, recibos y estados inválidos rechazados sin mover nada"
    add("Resolver una anomalía (review) a mano", "Solo desde review; paid con entrega o failed; entradas inválidas rechazadas", review_resolve)

    def activation(_):
        bad = []; uid, tok, pid, cid, ref = paidpay()
        r1 = jbody(op({"op": "claim", "id": pid})); r2 = jbody(op({"op": "claim", "id": pid}))
        if (r1.get("ok"), r2.get("ok")) != (True, False) or not row_of(pid)["activated_at"]: bad.append(f"reclamar la entrega: {r1} {r2}")
        u2, t2, p2, c2, _r = paidpay(); res = []; bar = threading.Barrier(20)
        def go(): bar.wait(); res.append(jbody(op({"op": "claim", "id": p2})).get("ok"))
        ts = [threading.Thread(target=go) for _ in range(20)]; [t.start() for t in ts]; [t.join() for t in ts]
        if res.count(True) != 1: bad.append(f"20 hilos reclaman la entrega: {res.count(True)} ganadores (esperaba 1)")
        pend = newpay()
        if jbody(op({"op": "claim", "id": pend[2]})).get("ok") is not False: bad.append("un pago que no está paid no se puede reclamar")
        for badid in ("zzz", "../x", "a" * 16):
            r = op({"op": "claim", "id": badid})
            if jbody(r).get("ok") is True: bad.append(f"id inválido {badid!r} reclamado")
        u3, t3, p3, c3, _r3 = paidpay()
        m1 = jbody(op({"op": "activated", "id": p3})).get("ok"); m2 = jbody(op({"op": "activated", "id": p3})).get("ok"); cl = jbody(op({"op": "claim", "id": p3})).get("ok")
        if (m1, m2, cl) != (True, False, False): bad.append(f"markActivated es idempotente y bloquea el reclamo posterior: {(m1, m2, cl)}")
        return not bad, "; ".join(bad) or "claimActivation devuelve true solo a quien gana (20 hilos => 1), solo desde paid; markActivated es idempotente (patrón al-menos-una-vez)"
    add("Entrega: claimActivation (como máximo una vez) y markActivated", "Un solo ganador; solo pagos paid", activation)

    def retention(_):
        bad = []; live_restart(livecfg('retention: { failedDays: 1, paidDays: 0 }')); f = S["fake"]
        old = time.strftime("%Y-%m-%d %H:%M:%S.000Z", time.gmtime(time.time() - 3 * 86400)); new = time.strftime("%Y-%m-%d %H:%M:%S.000Z", time.gmtime(time.time() - 600))
        cu, ct = mkuser(); mk = lambda n, st, closed, **kw: L.api(LP, "POST", "/api/collections/pbmini_clip_payments/records", dict(reference=f"PBM-r{n:014d}-00000000", amount=100, currency="MXN", status=st, user=cu, closed_at=closed, **kw), S["su"])["id"]
        ids = {"failed_old": mk(1, "failed", old), "failed_new": mk(2, "failed", new), "expired_old": mk(3, "expired", old), "paid_old": mk(4, "paid", old, receipt_no="OLD-P"), "refunded_old": mk(5, "refunded", old, receipt_no="OLD-R"),
               "review_old": mk(6, "review", old), "pending": mk(7, "pending", ""), "created": mk(8, "created", ""), "failed_noclose": mk(9, "failed", "")}
        exists = lambda k: bool(rows(f'id = "{ids[k]}"'))
        d = jbody(op({"op": "purge", "id": "x", "to": "dry"}))
        if (d.get("failed"), d.get("expired"), d.get("paid"), d.get("refunded"), d.get("dryRun")) != (1, 1, 0, 0, True) or not all(exists(k) for k in ids): bad.append(f"purge en seco: {d}")
        r = jbody(op({"op": "purge", "id": "x"}))
        if (r.get("failed"), r.get("expired")) != (1, 1): bad.append(f"purge: {r}")
        gone = [k for k in ids if not exists(k)]
        if sorted(gone) != ["expired_old", "failed_old"]: bad.append(f"solo se purgan failed/expired con cierre anterior a failedDays: {gone}")
        live_restart(livecfg('retention: { failedDays: 1, paidDays: 1 }'))
        r2 = jbody(op({"op": "purge", "id": "x"}))
        gone2 = sorted(k for k in ids if not exists(k))
        if gone2 != ["expired_old", "failed_old", "paid_old", "refunded_old"] or (r2.get("paid"), r2.get("refunded")) != (1, 1): bad.append(f"con paidDays=1 se purgan también paid/refunded antiguos y NUNCA review/pending/created/sin cierre: {gone2} {r2}")
        crons = L.api(LP, "GET", "/api/crons", None, S["su"])
        if not any(c.get("id") == "pbmini_clip_purge" for c in crons): bad.append("falta la tarea pbmini_clip_purge")
        live_restart()
        return not bad, "; ".join(bad) or "retención por closed_at: failed/expired antiguos se purgan, paid/refunded solo con paidDays>0, NUNCA review/pending/created ni filas sin cierre; el modo en seco no borra; la tarea está registrada"
    add("Retención: por fecha de cierre y nunca lo que espera a una persona", "failed/expired viejos; paid solo si se configura; review/pending intactos", retention)

    def anonymize(_):
        bad = []; ua, ta, pa, ca, ra = paidpay("ANON-1"); pend = pay(ta, {**GOOD, "subject": {"kind": "order", "id": "secreto-99"}}); ub, tb, pb_, cb, rb = paidpay("ANON-2")
        before = row_of(pa); ids = [pa, jbody(pend).get("id")]
        L.api(LP, "DELETE", f"/api/collections/users/records/{ua}", None, S["su"])
        for pid in ids:
            rw = row_of(pid)
            if rw["user"] or rw["description"] or rw["subject_id"]: bad.append(f"{pid}: user/description/subject_id deben quedar vacíos: {rw['user']!r} {rw['description']!r} {rw['subject_id']!r}")
        a = row_of(pa)
        for k in ("amount", "currency", "status", "receipt_no", "reference", "paid_at", "closed_at", "subject_kind", "clip_id"):
            if a[k] != before[k]: bad.append(f"el campo contable {k} no debe cambiar al anonimizar: {before[k]!r} -> {a[k]!r}")
        b = row_of(pb_)
        if b["user"] != ub or not b["description"]: bad.append("los pagos de otros usuarios no se tocan")
        return not bad, "; ".join(bad) or "al borrar un usuario sus pagos pierden el vínculo y los textos libres (user, description, subject_id) y CONSERVAN los campos contables (monto, moneda, estado, recibo, referencia, fechas); los de otros no cambian"
    add("Borrar un usuario anonimiza sus pagos y conserva lo contable", "Sin datos personales; contabilidad intacta", anonymize)

    def cli_all(_):
        bad = []; f = S["fake"]; import subprocess as sp
        paid = paidpay("CLI-1"); paid2 = paidpay("CLI-2"); rev = newpay(); f.complete(rev[3], "CLI-RV"); f.tamper(rev[3], amount=1.0); verify_api(rev[1], rev[2])
        late = newpay(); f.complete(late[3], "CLI-AN"); f.tamper(late[3], amount=2.0)   # se volverá anomalía al conciliar desde la CLI
        S["pb"].stop(); root, full = S["root"], S["env"]
        def cli(*a):
            r = sp.run([EXE, "pbmini:clip", *a, f"--dir={root}/pb_data", f"--hooksDir={root}/pb_hooks", f"--publicDir={root}/pb_public"], capture_output=True, text=True, timeout=90, cwd=root, env=dict(os.environ, **full), encoding="utf-8", errors="replace")
            return r.returncode, r.stdout + r.stderr
        def jout(o):
            i, j = o.find("{"), o.rfind("}")
            try: return json.loads(o[i:j + 1])
            except Exception: return {}
        try:
            rc, o = cli("status"); st = jout(o)
            if rc != 0 or not st.get("enabled") or "payments" not in st or st["payments"].get("paid", 0) < 2: bad.append(f"status: rc={rc} {o[-200:]!r}")
            if CLIP_TOKEN[6:] in o or WH_TOKEN in o or CLIP_TOKEN in o: bad.append("status muestra un secreto")
            rc, o = cli("show", paid[2]); sh = jout(o)
            if rc != 0 or sh.get("receipt_no") != "CLI-1" or sh.get("status") != "paid": bad.append(f"show por id: rc={rc} {o[-160:]!r}")
            rc, o = cli("show", paid[4]); sh2 = jout(o)
            if rc != 0 or sh2.get("id") != paid[2]: bad.append("show por referencia")
            if cli("show", "no-existe")[0] == 0 or cli("show")[0] == 0: bad.append("show de un pago inexistente o sin argumento debe fallar")
            f.clear()
            rc, o = cli("refund", paid[2])
            if rc != 2 or f.refund_posts(): bad.append(f"refund sin confirm: rc={rc} (esperaba 2) y NO debe llamar a Clip")
            rc, o = cli("refund", paid[2], "confirm")
            if rc != 0 or len(f.refund_posts()) != 1 or jout(o).get("status") != "refunded": bad.append(f"refund confirm: rc={rc} {o[-160:]!r} llamadas={len(f.refund_posts())}")
            rc, o = cli("refund", paid[2], "confirm")
            if rc != 0 or len(f.refund_posts()) != 1: bad.append("repetir el reembolso por CLI no debe llamar de nuevo a Clip")
            rc, o = cli("refunded", paid2[2])
            if rc != 2: bad.append("refunded sin confirm => 2")
            rc, o = cli("refunded", paid2[2], "confirm")
            if rc != 0 or len(f.refund_posts()) != 1: bad.append(f"refunded confirm: rc={rc} y no debe llamar a Clip")
            rc, o = cli("review", rev[2], "paid", "CLI-REV")
            if rc != 2: bad.append("review sin confirm => 2")
            rc, o = cli("review", rev[2], "paid", "CLI-REV", "confirm")
            if rc != 0 or jout(o).get("status") != "paid": bad.append(f"review confirm: rc={rc} {o[-160:]!r}")
            if cli("review", rev[2], "failed", "confirm")[0] == 0: bad.append("review de un pago que ya no está en review debe fallar")
            if cli("review", rev[2], "otro", "confirm")[0] == 0: bad.append("review con destino inválido debe fallar")
            rc, o = cli("purge", "dry")
            if rc != 0 or jout(o).get("dryRun") is not True: bad.append("purge dry")
            rc, o = cli("reconcile"); rr = jout(o)
            if rc != 1 or rr.get("review", 0) < 1: bad.append(f"reconcile con una anomalía nueva debe salir con código 1: rc={rc} {rr}")
            rc, o = cli("reconcile")
            if rc != 0: bad.append(f"reconcile sin anomalías nuevas => 0: rc={rc}")
            f.clear(); rc, o = cli("check")
            ps = f.posts()
            if rc != 0 or len(ps) != 1 or "Clip aceptó las credenciales" not in o or "pago.clip.mx" not in o or ps[0]["body"]["amount"] != 1: bad.append(f"check: rc={rc} {o[-240:]!r} posts={len(ps)}")
            if CLIP_TOKEN[6:] in o or WH_TOKEN in o: bad.append("check muestra un secreto")
            if "OK " not in o or not re.search(r"-- +estado COMPLETADO", o): bad.append(f"check debe imprimir las comprobaciones: {o[-300:]!r}")
            f.clear(); rc, o = cli("check", "0.5")
            if rc == 0 or f.posts(): bad.append("check con un monto menor al mínimo debe fallar sin llamar a Clip")
            if cli("check", "abc")[0] == 0 or cli("nada")[0] == 0 or cli()[0] == 0: bad.append("subcomandos o montos inválidos deben fallar")
        finally:
            live_boot();
        return not bad, "; ".join(bad) or "CLI: status sin secretos, show por id o referencia, refund/refunded/review exigen `confirm` (sin él salen con 2 sin tocar nada), el reembolso por CLI llama a Clip una sola vez, reconcile sale con 1 solo ante anomalías nuevas, check crea un link real de prueba y muestra las 5 comprobaciones, entradas inválidas fallan"
    add("CLI pbmini:clip: status, show, reconcile, purge, review, refund, refunded y check", "`confirm` obligatorio en lo que mueve dinero; sin secretos", cli_all)

    def secrets_p5(_):
        bad = []; log = S["pb"].log(); blob = json.dumps(rows())
        for name, v in (("token de la API", CLIP_TOKEN), ("clave base64", CLIP_TOKEN[6:]), ("token del webhook", WH_TOKEN)):
            if v in log: bad.append(f"{name} aparece en el log")
            if v in blob: bad.append(f"{name} aparece en la colección")
        return not bad, "; ".join(bad) or "tras reembolsos, revisiones, retención y CLI, ningún secreto aparece en el log ni en la colección"
    add("Los secretos siguen fuera de logs y base de datos (reembolso y CLI)", "Ni token de la API ni token del webhook", secrets_p5)

    # ------------------------------------------------------------------ núcleo puro (node, sin PocketBase)
    NODE = {"res": None}
    def unit():
        if NODE["res"] is None:
            node = shutil.which("node")
            if not node: NODE["res"] = ("skip", "no hay Node en este sistema (instálalo para correr las pruebas del núcleo puro)")
            else:
                r = subprocess.run([node, os.path.join(L.HERE, "unit_clip.js"), os.path.join(L.ROOT, "pb_hooks")], capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
                try: NODE["res"] = ("ok", json.loads(r.stdout.strip().splitlines()[-1]))
                except Exception: NODE["res"] = ("err", (r.stdout + r.stderr)[-400:])
        return NODE["res"]
    def unit_case(group, obj, meta):
        def run(_):
            kind, res = unit()
            if kind == "skip": return None, "OMITIDO: " + res
            if kind == "err": return False, "no se pudo ejecutar unit_clip.js: " + res
            g = res["groups"].get(group)
            if g is None: return False, f"el grupo «{group}» no existe en unit_clip.js"
            return not g["fail"], ("; ".join(g["fail"][:6]) + (f" (+{len(g['fail']) - 6})" if len(g["fail"]) > 6 else "")) or f"{g['pass']} comprobaciones"
        add(obj, meta, run)
    unit_case("estados", "Estados de Clip: mapeo exacto y nada ambiguo cuenta como pagado", "Solo los 5 estados oficiales; mayúsculas, espacios, nombres de prototipo y tipos raros => pending, nunca paid")
    unit_case("dinero", "Dinero: pesos <-> centavos sin errores de coma flotante", "Más de 2 decimales, notación científica, negativos, NaN/Infinity y textos raros => inválido; ida y vuelta exacta (20 000 casos aleatorios)")
    unit_case("referencia", "Referencia firmada: formato, 36 caracteres, firma y rechazo de lo ajeno", "Reconoce solo la propia (clave y prefijo) y nunca lanza con basura")
    unit_case("transiciones", "Máquina de estados: matriz exhaustiva de transiciones", "Solo las permitidas; el pago tardío sí se registra; revisión y reembolso solo por operador")
    unit_case("decide", "decide(): `paid` solo si TODO coincide con lo nuestro", "Anomalía => review (nunca failed ni paid); sin recibo => pending; recibo repetido => review; ninguna mutación de un campo da paid")
    unit_case("ids de Clip", "Ids de Clip: solo UUID", "Cualquier otra cosa se descarta antes de llamar a Clip")

    # ------------------------------------------------------------------ fail-closed
    def bad_boot_case(label, env, clipcfg):
        def run(_):
            root, full = sandbox("clipbad", env, CFG % clipcfg)
            full = {**full, "PBMINI_ON_ERROR": ""}
            pb = L.PB(EXE, root, BADPORT, env=full); pb.serve(); died, end = False, time.time() + 14
            while time.time() < end:
                if pb.proc.poll() is not None: died = True; break
                time.sleep(0.25)
            log = pb.log(); pb.stop()
            leaked = [n for n, v in (("el token de la API", CLIP_TOKEN), ("el token del webhook", WH_TOKEN)) if v in log]
            return died and ("pbmini" in log) and not leaked, ("abortó el arranque (fail-closed)" if died else "ARRANCÓ con configuración inválida") + (f"; el log contiene {leaked}" if leaked else "")
        add(f"Fail-closed: {label}", "El servidor NO arranca; el mensaje nombra la opción, no el valor", run)
    for lab_, env_, cfg_ in cfgs(): bad_boot_case(lab_, env_, cfg_)

    def live_teardown(_):
        try:
            if S["pb"]: S["pb"].stop()
        finally:
            if S["fake"]: S["fake"].stop()
        return True, "servidor y Clip falso detenidos"
    add("Limpieza: se detienen el servidor y el Clip falso", "Listo", live_teardown)

    return cases
