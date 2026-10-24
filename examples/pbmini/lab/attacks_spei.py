"""Ronda 12: módulo opcional de pagos por transferencia SPEI (validación contra el CEP de Banxico). Sección VSP. Todo contra un Banxico FALSO en 127.0.0.1 (nunca se contacta con banxico.org.mx).
`build(L, ctx, A)` devuelve los casos: arranque inválido (fail-closed), colección interna, órdenes, reporte/verificación, conciliador, operador, retención y núcleo puro (node)."""
import json, os, re, time, shutil, datetime, threading, subprocess, urllib.parse
from fake_banxico import FakeBanxico
from fake_omni import FakeOmni

PORT, BADPORT = 18750, 18751
def mk(b3, rest14):
    b = b3 + rest14; w = [3, 7, 1]; s = sum((int(b[i]) * w[i % 3]) % 10 for i in range(17)); return b + str((10 - s % 10) % 10)
BBVA, BNTE, NU = mk("012", "18000456789012"), mk("072", "18000123456789"), mk("638", "18000111122223")
ACCOUNTS = json.dumps({"accounts": [{"account": BBVA, "holder": "LAB BBVA", "label": "BBVA"}, {"account": BNTE, "holder": "LAB BANORTE", "label": "Banorte"}]})
OTHER = json.dumps({"accounts": [{"account": NU, "holder": "LAB NU", "label": "Nu"}, {"account": BNTE, "holder": "LAB BANORTE", "label": "Banorte"}]})
VKEY = "labOmniKey_labOmniKey_labOmniKey_1234"
CFG = 'module.exports = { spei: %s };'
LIVE_CFG = 'module.exports = { access: { enabled: true, mode: "membership", collection: "users", roles: ["admin"], rolesField: "roles", statusField: "status" }, spei: %s };'
PAGES = {
    "spei/order.js": 'module.exports = { auth: "user", body: { opts: { type: "string", max: 5000, required: true } }, post: (ctx) => ctx.json(ctx.spei.createOrder(JSON.parse(ctx.body.opts))), get: (ctx) => ctx.json(ctx.spei.createOrder({})) };',
    "spei/pub.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.spei.createOrder({})) };',
    "spei/su.js": 'module.exports = { auth: "superuser", post: (ctx) => ctx.json(ctx.spei.createOrder({})) };',
    "spei/report.js": 'module.exports = { auth: "user", body: { id: { type: "string", max: 64, required: true }, input: { type: "string", max: 5000, required: true } }, post: (ctx) => ctx.json(ctx.spei.report(ctx.body.id, JSON.parse(ctx.body.input))), get: (ctx) => ctx.json(ctx.spei.report("x", {})) };',
    "spei/sureport.js": 'module.exports = { auth: "superuser", body: { id: { type: "string", max: 64, required: true } }, post: (ctx) => ctx.json(ctx.spei.report(ctx.body.id, { tracking: "MBAN00000000000000" })) };',
    "spei/pubreport.js": 'module.exports = { auth: "public", post: (ctx) => ctx.json(ctx.spei.report("x", {})) };',
    "spei/read.js": 'module.exports = { auth: "user", body: { id: { type: "string", max: 64, required: true }, image: { type: "string", max: 400000, required: true } }, post: (ctx) => ctx.json(ctx.spei.readReceipt(ctx.body.id, ctx.body.image)), get: (ctx) => ctx.json(ctx.spei.readReceipt("x", "x")) };',
    "spei/auto.js": 'module.exports = { auth: "user", body: { id: { type: "string", max: 64, required: true }, image: { type: "string", max: 400000, required: true } }, post: (ctx) => ctx.json(ctx.spei.reportFromReceipt(ctx.body.id, ctx.body.image)) };',
    "spei/get.js": 'module.exports = { auth: "user", query: { id: { type: "string", max: 64, required: true } }, get: (ctx) => ctx.json(ctx.spei.get(ctx.query.id)) };',
    "spei/list.js": 'module.exports = { auth: "user", query: { kind: { type: "string", max: 64, required: true }, sid: { type: "string", max: 80, required: true } }, get: (ctx) => ctx.json({ items: ctx.spei.list({ subjectKind: ctx.query.kind, subjectId: ctx.query.sid }) }) };',
    "spei/op.js": 'module.exports = { auth: "superuser", body: { op: { type: "string", max: 20, required: true }, id: { type: "string", max: 40, required: true }, to: { type: "string", max: 10 } }, post: (ctx) => { const T = require(`${__hooks}/lib/spei.js`), b = ctx.body;' +
                  ' if (b.op === "reconcile") return ctx.json(T.reconcile($app)); if (b.op === "review") return ctx.json(T.reviewResolve($app, b.id, b.to, "lab")); if (b.op === "claim") return ctx.json({ ok: T.claimActivation($app, b.id) });' +
                  ' if (b.op === "activated") return ctx.json({ ok: T.markActivated($app, b.id) }); if (b.op === "purge") return ctx.json(T.purge($app, { dryRun: b.to === "dry" })); if (b.op === "verify") return ctx.json(T.verify($app, $app.findRecordById(T.COLL, b.id), {})); throw new Error("op"); } };',
}
ENTREGA_HOOK = """/// <reference path="../pb_data/types.d.ts" />
onRecordAfterUpdateSuccess((e) => {
  try {
    if (e.record.original().getString("status") !== "paid" && e.record.getString("status") === "paid") {
      const r = new Record($app.findCollectionByNameOrId("entregas")); r.set("pago", e.record.id); $app.save(r);
    }
  } catch (err) { $app.logger().error("entrega no registrada", "error", String(err)); }
  e.next();
}, "pbmini_spei_payments");
"""
ENTREGAS = dict(name="entregas", type="base", fields=[dict(name="pago", type="text")])
GOOD = {"amount": 30000, "description": "Pedido 1042", "subject": {"kind": "order", "id": "abc123"}, "customerBank": "40012"}


def cfgs():
    """(etiqueta, env, bloque spei, texto del archivo de cuentas o None) que deben impedir el arranque (fail-closed)."""
    on = "{ enabled: true }"
    c = lambda body: "{ enabled: true, %s }" % body
    V = {"OMNIROUTER_URL": "https://omni.lab.example.test/v1", "OMNIROUTER_API_KEY": VKEY, "OMNIROUTER_MODEL": "gemini-lab"}
    vc = "vision: { enabled: true }"
    acc = lambda *a: json.dumps({"accounts": list(a)})
    A = lambda account=BBVA, **k: {"account": account, "holder": "Lab", **k}
    return [
        ("sin archivo de cuentas", {}, on, None),
        ("el archivo de cuentas no es JSON", {}, on, "{no"),
        ("archivo de cuentas sin cuentas", {}, on, acc()),
        ("archivo de cuentas con 11 cuentas", {}, on, json.dumps({"accounts": [{"account": mk("012", "1800045678%04d" % i), "holder": "Lab"} for i in range(11)]})),
        ("cuentas repetidas", {}, on, acc(A(), A())),
        ("CLABE con dígito verificador incorrecto", {}, on, acc(A(BBVA[:17] + str((int(BBVA[17]) + 1) % 10)))),
        ("CLABE con prefijo de banco desconocido", {}, on, acc(A(mk("999", "18000456789012")))),
        ("CLABE de 17 dígitos", {}, on, acc(A(BBVA[:17]))),
        ("cuenta de 10 dígitos (celular)", {}, on, acc(A("5512345678", bank="40012"))),
        ("tarjeta sin banco", {}, on, acc(A("4111111111111111"))),
        ("tarjeta con Luhn incorrecto", {}, on, acc(A("4111111111111112", bank="40072"))),
        ("banco declarado distinto del de la CLABE", {}, on, acc(A(BBVA, bank="40072"))),
        ("banco declarado inexistente", {}, on, acc(A(BBVA, bank="99999"))),
        ("cuenta con una opción desconocida", {}, on, acc(A(pin="1"))),
        ("cuenta sin titular", {}, on, acc({"account": BBVA})),
        ("titular con etiquetas HTML", {}, on, acc(A(holder="<script>x</script>"))),
        ("etiqueta demasiado larga", {}, on, acc(A(label="x" * 41))),
        ("archivo de cuentas con clave extra", {}, on, json.dumps({"accounts": [A()], "extra": 1})),
        ("accountsFile con ruta", {}, c('accountsFile: "../spei.accounts.json"'), ACCOUNTS),
        ("accountsFile sin extensión .json", {}, c('accountsFile: "cuentas.txt"'), ACCOUNTS),
        ("SPEI_BANXICO_URL hacia un host externo (https)", {"SPEI_BANXICO_URL": "https://banxico.evil.example.com"}, on, ACCOUNTS),
        ("SPEI_BANXICO_URL http no local", {"SPEI_BANXICO_URL": "http://www.banxico.org.mx"}, on, ACCOUNTS),
        ("SPEI_BANXICO_URL con ruta", {"SPEI_BANXICO_URL": "https://www.banxico.org.mx/cep"}, on, ACCOUNTS),
        ("visión activada sin OMNIROUTER_URL", {k: v for k, v in V.items() if k != "OMNIROUTER_URL"}, c(vc), ACCOUNTS),
        ("visión activada sin OMNIROUTER_API_KEY", {k: v for k, v in V.items() if k != "OMNIROUTER_API_KEY"}, c(vc), ACCOUNTS),
        ("visión con OMNIROUTER_API_KEY corta", {**V, "OMNIROUTER_API_KEY": "corta"}, c(vc), ACCOUNTS),
        ("visión sin OMNIROUTER_MODEL", {k: v for k, v in V.items() if k != "OMNIROUTER_MODEL"}, c(vc), ACCOUNTS),
        ("visión con OMNIROUTER_MODEL con espacios", {**V, "OMNIROUTER_MODEL": "gemini lab"}, c(vc), ACCOUNTS),
        ("OMNIROUTER_URL http no local", {**V, "OMNIROUTER_URL": "http://omni.example.com/v1"}, c(vc), ACCOUNTS),
        ("OMNIROUTER_URL con credenciales", {**V, "OMNIROUTER_URL": "https://u:p@omni.example.com/v1"}, c(vc), ACCOUNTS),
        ("OMNIROUTER_URL con parámetros", {**V, "OMNIROUTER_URL": "https://omni.example.com/v1?x=1"}, c(vc), ACCOUNTS),
        ("clave desconocida en spei", {}, c("maxAmount: 1"), ACCOUNTS),
        ("enabled no booleano", {}, '{ enabled: "yes" }', ACCOUNTS),
        ("spei no es un objeto", {}, "5", ACCOUNTS),
        ("collection de sistema", {}, c('collection: "_superusers"'), ACCOUNTS),
        ("collection con formato inválido", {}, c('collection: "mi coleccion"'), ACCOUNTS),
        ("amount.min mayor que amount.max", {}, c("amount: { min: 5000, max: 1000 }"), ACCOUNTS),
        ("amount.min decimal", {}, c("amount: { min: 100.5 }"), ACCOUNTS),
        ("amount.min cero", {}, c("amount: { min: 0 }"), ACCOUNTS),
        ("vision.perUserPerMin cero", {}, c("vision: { perUserPerMin: 0 }"), ACCOUNTS),
        ("vision.maxPerOrder excesivo", {}, c("vision: { maxPerOrder: 201 }"), ACCOUNTS),
        ("vision.minConfidence cero", {}, c("vision: { minConfidence: 0 }"), ACCOUNTS),
        ("vision.minConfidence decimal", {}, c("vision: { minConfidence: 50.5 }"), ACCOUNTS),
        ("orderTtlHours cero", {}, c("orderTtlHours: 0"), ACCOUNTS),
        ("orderTtlHours excesivo", {}, c("orderTtlHours: 169"), ACCOUNTS),
        ("orderTtlHours decimal", {}, c("orderTtlHours: 1.5"), ACCOUNTS),
        ("report con opción desconocida", {}, c("report: { perDay: 5 }"), ACCOUNTS),
        ("report.perUserPerMin cero", {}, c("report: { perUserPerMin: 0 }"), ACCOUNTS),
        ("report.maxReportsPerOrder excesivo", {}, c("report: { maxReportsPerOrder: 21 }"), ACCOUNTS),
        ("report.maxPendingPerUser como texto", {}, c('report: { maxPendingPerUser: "5" }'), ACCOUNTS),
        ("banxico.timeoutSeconds cero", {}, c("banxico: { timeoutSeconds: 0 }"), ACCOUNTS),
        ("banxico.timeoutSeconds excesivo", {}, c("banxico: { timeoutSeconds: 31 }"), ACCOUNTS),
        ("banxico.minIntervalMs demasiado bajo", {}, c("banxico: { minIntervalMs: 100 }"), ACCOUNTS),
        ("banxico.perMinute cero", {}, c("banxico: { perMinute: 0 }"), ACCOUNTS),
        ("reconcile.cron inválido", {}, c('reconcile: { cron: "cada rato" }'), ACCOUNTS),
        ("reconcile.maxTries cero", {}, c("reconcile: { maxTries: 0 }"), ACCOUNTS),
        ("reconcile.retryMinutes excesivo", {}, c("reconcile: { retryMinutes: 1441 }"), ACCOUNTS),
        ("reconcile.batch cero", {}, c("reconcile: { batch: 0 }"), ACCOUNTS),
        ("vision.enabled no booleano", {}, c('vision: { enabled: "si" }'), ACCOUNTS),
        ("vision.maxKB demasiado bajo", {}, c("vision: { maxKB: 1 }"), ACCOUNTS),
        ("retention.failedDays cero", {}, c("retention: { failedDays: 0 }"), ACCOUNTS),
        ("retention.paidDays negativo", {}, c("retention: { paidDays: -1 }"), ACCOUNTS),
        ("readRules no booleano", {}, c('readRules: "yes"'), ACCOUNTS),
        ("uniqueCents no es un objeto", {}, c("uniqueCents: 5"), ACCOUNTS),
        ("uniqueCents.enabled no booleano", {}, c('uniqueCents: { enabled: "si" }'), ACCOUNTS),
        ("uniqueCents.max cero", {}, c("uniqueCents: { enabled: true, max: 0 }"), ACCOUNTS),
        ("uniqueCents.max mayor que 99", {}, c("uniqueCents: { enabled: true, max: 100 }"), ACCOUNTS),
        ("uniqueCents con opción desconocida", {}, c("uniqueCents: { enabled: true, cents: 5 }"), ACCOUNTS),
        ("vision.provider desconocido", {}, c('vision: { enabled: true, provider: "openai" }'), ACCOUNTS),
        ("vision.provider google sin el plugin ai", {}, c('vision: { enabled: true, provider: "google" }'), ACCOUNTS),
    ]


def build(L, ctx, A):
    Case, raw = L.Case, L.raw
    cases, cnt = [], [0]
    J = {"Content-Type": "application/json"}
    EXE, RUN = ctx["exe"], L.RUN
    cat = "S · Pagos por transferencia SPEI (módulo opcional)"
    S = {"pb": None, "root": None, "env": None, "su": None, "fake": None}
    COL = "/api/collections/pbmini_spei_payments"

    def add(obj, meta, run):
        cnt[0] += 1; cases.append(Case(f"VSP{cnt[0]:03d}", cat, obj, meta, run=run))

    def sandbox(tag, env, cfgtxt, pages=None, extra=None, accounts=ACCOUNTS):
        root = os.path.join(RUN, f"x-{tag}"); pgdir = root + "-pages"
        shutil.rmtree(pgdir, ignore_errors=True); os.makedirs(pgdir)
        for rel, txt in (pages or {"ok.js": 'module.exports = { auth: "public", get: (ctx) => ctx.json({ ok: 1 }) };'}).items():
            fp = os.path.join(pgdir, rel); os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", newline="\n", encoding="utf-8") as f: f.write(txt)
        he = {"pbmini.config.js": cfgtxt, **(extra or {})}
        if accounts is not None: he["spei.accounts.json"] = accounts
        L.build_sandbox(root, pgdir, symlinks=False, clean=True, hooks_extra=he)
        return root, {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}

    def su_login(port): return L.api(port, "POST", "/api/collections/_superusers/auth-with-password", {"identity": L.SU_MAIL, "password": L.SU_PASS})["token"]
    def boot(tag, port, speicfg="{ enabled: true }", env=None, accounts=ACCOUNTS):
        root, full = sandbox(tag, env or {}, CFG % speicfg, accounts=accounts)
        pb = L.PB(EXE, root, port, env=full); pb.serve()
        if not pb.wait_ready(): raise RuntimeError("servidor de SPEI no arrancó: " + pb.log()[-400:])
        return pb, root, full

    # ------------------------------------------------------------------ colección interna y módulo apagado
    def collection_ok(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("spei1", PORT); su = su_login(PORT)
            col = L.api(PORT, "GET", "/api/collections/pbmini_spei_payments", None, su)
            names = [f["name"] for f in col["fields"]]
            want = ["user", "subject_kind", "subject_id", "amount", "base_amount", "currency", "description", "account", "account_kind", "account_bank", "account_label", "account_holder", "customer_bank", "status", "source", "tracking", "tracking_u", "last_tracking", "emisor", "pay_date",
                    "reports", "tries", "next_try", "checked_at", "bx_status", "bx_amount", "bx_processed", "bx_account_tail", "note", "idem_key", "expires_at", "paid_at", "closed_at", "activated_at", "created", "updated"]
            miss = [n for n in want if n not in names]
            if miss: bad.append(f"faltan campos: {miss}")
            if names[-2:] != ["created", "updated"]: bad.append(f"created/updated deben ir al final: {names[-2:]}")
            for r in ("listRule", "viewRule", "createRule", "updateRule", "deleteRule"):
                if col.get(r) is not None: bad.append(f"{r} debe ser null: {col.get(r)!r}")
            st = next(f for f in col["fields"] if f["name"] == "status")
            if st["values"] != ["awaiting", "checking", "paid", "review", "failed", "expired"]: bad.append(f"estados: {st['values']}")
            am = next(f for f in col["fields"] if f["name"] == "amount")
            if not am.get("onlyInt") or am.get("min") != 1: bad.append(f"amount: {am}")
            idx = " ".join(col["indexes"])
            for k, frag in (("clave de rastreo parcial (sin distinguir mayúsculas)", "tracking_u != ''"), ("idem por usuario", "(user, idem_key)")):
                if "UNIQUE" not in idx or frag not in idx: bad.append(f"falta el índice único de {k}")
            if any(f.get("hidden") for f in col["fields"]): bad.append("con readRules apagado no debe haber campos ocultos")
            cid = col["id"]; pb.stop(); pb = L.PB(EXE, root, PORT, env=full); pb.serve(); pb.wait_ready(); su = su_login(PORT)
            if L.api(PORT, "GET", "/api/collections/pbmini_spei_payments", None, su)["id"] != cid: bad.append("el reinicio recreó la colección")
            return not bad, "; ".join(bad) or "colección con campos, estados, índice único parcial de la clave de rastreo y reglas null; idempotente al reiniciar"
        finally:
            if pb: pb.stop()
    add("Colección interna: campos, índices únicos parciales y reglas null", "Solo superusuario; idempotente", collection_ok)

    def collection_closed(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("spei2", PORT); su = su_login(PORT)
            L.api(PORT, "POST", COL + "/records", dict(amount=100, currency="MXN", status="paid", account="x", account_bank="40072", user="x", description="LABSECRETO"), su)
            em = f"s{os.getpid()}@lab.test"; L.api(PORT, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
            tok = L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
            for who, h in (("usuario", {"Authorization": tok}), ("anónimo", {})):
                for m, p, body in (("GET", COL + "/records", None), ("POST", COL + "/records", "{}"), ("GET", COL + "/records/x", None), ("DELETE", COL + "/records/x", None)):
                    r = raw(PORT, m, p, {**J, **h}, body)
                    if r.status in (200, 201): bad.append(f"{who}: {m} {p} → {r.status}")
            if "LABSECRETO" in raw(PORT, "GET", COL + "/records", {"Authorization": tok}).body: bad.append("un usuario pudo leer órdenes")
            return not bad, "; ".join(bad) or "con readRules apagado ni usuarios ni anónimos leen ni escriben órdenes por la API nativa"
        finally:
            if pb: pb.stop()
    add("La API nativa no expone las órdenes (readRules apagado)", "Usuarios y anónimos: sin acceso", collection_closed)

    def read_rules(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("spei3", PORT, "{ enabled: true, readRules: true }"); su = su_login(PORT)
            col = L.api(PORT, "GET", "/api/collections/pbmini_spei_payments", None, su)
            for r in ("listRule", "viewRule"):
                if col.get(r) != "user = @request.auth.id": bad.append(f"{r} = {col.get(r)!r}")
            for r in ("createRule", "updateRule", "deleteRule"):
                if col.get(r) is not None: bad.append(f"{r} debe seguir en null")
            hid = sorted(f["name"] for f in col["fields"] if f.get("hidden"))
            want = sorted(["tracking", "tracking_u", "last_tracking", "next_try", "checked_at", "bx_status", "bx_amount", "bx_processed", "bx_account_tail", "note", "idem_key"])
            if hid != want: bad.append(f"campos ocultos: {hid}")
            def mkn(n):
                em = f"r{n}{os.getpid()}@lab.test"; rec = L.api(PORT, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
                return rec["id"], L.api(PORT, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
            a, ta = mkn(1); b, tb = mkn(2)
            for uid in (a, b): L.api(PORT, "POST", COL + "/records", dict(amount=100, currency="MXN", status="paid", account="x", account_bank="40072", user=uid, note="secreto", tracking="K" + uid), su)
            mine = L.api(PORT, "GET", COL + "/records", None, ta)
            if [i["user"] for i in mine["items"]] != [a]: bad.append(f"el dueño debe ver solo su orden: {[i['user'] for i in mine['items']]}")
            leak = [k for k in want if mine["items"] and k in mine["items"][0]]
            if leak: bad.append(f"campos internos visibles para el dueño: {leak}")
            if json.loads(raw(PORT, "GET", COL + "/records", {}).body).get("items"): bad.append("un anónimo ve órdenes")
            if raw(PORT, "POST", COL + "/records", {"Authorization": ta, **J}, json.dumps(dict(amount=100, currency="MXN", status="paid", account="x", account_bank="40072", user=a))).status in (200, 201): bad.append("el dueño pudo crear una orden")
            one = L.api(PORT, "GET", COL + "/records", None, tb)["items"][0]["id"]
            if raw(PORT, "PATCH", COL + f"/records/{one}", {"Authorization": tb, **J}, '{"status":"failed"}').status in (200, 204): bad.append("el dueño pudo modificar su orden")
            if raw(PORT, "DELETE", COL + f"/records/{one}", {"Authorization": tb}).status in (200, 204): bad.append("el dueño pudo borrar su orden")
            return not bad, "; ".join(bad) or "readRules: el dueño lee solo sus órdenes (sin claves ni datos de Banxico), no crea, no modifica ni borra; anónimos y otros usuarios no ven nada"
        finally:
            if pb: pb.stop()
    add("readRules: el dueño ve solo sus órdenes y sin campos internos", "Lectura propia; escritura solo del plugin", read_rules)

    def secrets_boot(_):
        pb = None
        try:
            V = {"OMNIROUTER_URL": "https://omni.lab.example.test/v1", "OMNIROUTER_API_KEY": VKEY, "OMNIROUTER_MODEL": "gemini-lab"}
            pb, root, full = boot("spei4", PORT, "{ enabled: true, vision: { enabled: true } }", env=V); log = pb.log()
            leak = [n for n, v in (("OMNIROUTER_API_KEY", VKEY), ("la CLABE de BBVA", BBVA), ("la CLABE de Banorte", BNTE)) if v in log]
            return not leak, "el log de arranque no contiene la clave del enrutador ni las cuentas" if not leak else f"aparecen en el log: {leak}"
        finally:
            if pb: pb.stop()
    add("La clave del enrutador y las cuentas no aparecen en el log de arranque", "Ni OMNIROUTER_API_KEY ni los números de cuenta", secrets_boot)

    def module_off(_):
        bad = []; pb = None
        try:
            pb, root, full = boot("speioff", PORT, "{ enabled: false }", accounts=None); su = su_login(PORT)
            cols = [c["name"] for c in L.api(PORT, "GET", "/api/collections?perPage=200", None, su)["items"]]
            if "pbmini_spei_payments" in cols: bad.append("se creó la colección con el módulo apagado")
            crons = L.api(PORT, "GET", "/api/crons", None, su)
            if any("spei" in (c.get("id") or "") for c in crons): bad.append("hay tareas programadas de spei con el módulo apagado")
            return not bad, "; ".join(bad) or "con spei apagado (y sin archivo de cuentas) arranca igual: sin colección, sin tareas, sin rutas"
        finally:
            if pb: pb.stop()
    add("Módulo apagado: arranca sin cuentas y no crea nada", "Sin colección ni tareas", module_off)

    # ------------------------------------------------------------------ servidor vivo con Banxico falso
    LP = PORT + 10
    seq = [0]
    def livecfg(extra="", rep="perUserPerMin: 1000, maxReportsPerOrder: 5, maxPendingPerUser: 50", rc="retryMinutes: 1, maxTries: 3, batch: 50, cron: \"0 3 1 1 *\"", vis="enabled: true, maxKB: 64, perUserPerMin: 100, maxPerOrder: 100, timeoutSeconds: 5"):
        return LIVE_CFG % ("{ enabled: true, report: { %s }, banxico: { minIntervalMs: 500, perMinute: 600, timeoutSeconds: 3 }, reconcile: { %s }, vision: { %s }%s }" % (rep, rc, vis, (", " + extra) if extra else ""))
    def live_boot(cfgtxt=None, env_over=None, accounts=None):
        f = S["fake"]; o = S["omni"]; env = {"SPEI_BANXICO_URL": f"http://127.0.0.1:{f.port}", "OMNIROUTER_URL": f"http://127.0.0.1:{o.port}/v1", "OMNIROUTER_API_KEY": VKEY, "OMNIROUTER_MODEL": "gemini-lab", **(env_over or {})}
        if S["root"] is None:
            root, full = sandbox("speil", env, cfgtxt or livecfg(), PAGES, {"entregas.pb.js": ENTREGA_HOOK}); S["root"] = root
        else:
            root = S["root"]; full = {"PBMINI_PUBLIC_AUDIT": "warn", "PBMINI_DEBUG": "1", "PBMINI_ON_ERROR": "warn", **env}
            open(os.path.join(root, "pb_hooks", "pbmini.config.js"), "w", encoding="utf-8", newline="\n").write(cfgtxt or livecfg())
            if accounts: open(os.path.join(root, "pb_hooks", "spei.accounts.json"), "w", encoding="utf-8", newline="\n").write(accounts)
        S["env"] = full
        pb = L.PB(EXE, root, LP, env=full); pb.serve(); S["pb"] = pb
        if not pb.wait_ready(): raise RuntimeError("servidor de SPEI no arrancó: " + pb.log()[-400:])
        S["su"] = su_login(LP)
    def live_restart(cfgtxt=None, env_over=None, accounts=None):
        S["pb"].stop(); live_boot(cfgtxt, env_over, accounts)
    def mkuser(**fields):
        seq[0] += 1; em = f"s{seq[0]}_{os.getpid()}@lab.test"
        rec = L.api(LP, "POST", "/api/collections/users/records", dict(email=em, password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True, **fields), S["su"])
        return rec["id"], L.api(LP, "POST", "/api/collections/users/auth-with-password", dict(identity=em, password="Passw0rd!!"))["token"]
    def rows(filt=""):
        q = COL + "/records?perPage=500&sort=created" + (("&filter=" + urllib.parse.quote(filt)) if filt else "")
        return L.api(LP, "GET", q, None, S["su"])["items"]
    def row(i): return L.api(LP, "GET", COL + f"/records/{i}", None, S["su"])
    def patch(i, **kw): return L.api(LP, "PATCH", COL + f"/records/{i}", kw, S["su"])
    def jbody(r):
        try: return json.loads(r.body)
        except Exception: return {}
    def order(tok, opts=None, **o):
        body = json.dumps({"opts": json.dumps(opts if opts is not None else {**GOOD, **o})})
        return raw(LP, "POST", "/spei/order", {"Authorization": tok, **J} if tok else {**J}, body, timeout=60)
    def mkorder(tok=None, **o):
        if tok is None: _, tok = mkuser()
        r = order(tok, **o)
        if r.status != 200: raise RuntimeError(f"no se pudo crear la orden: {r.status} {r.body[:200]}")
        return tok, jbody(r)
    def report(tok, oid, **inp):
        return raw(LP, "POST", "/spei/report", {"Authorization": tok, **J} if tok else {**J}, json.dumps({"id": oid, "input": json.dumps(inp)}), timeout=60)
    def opcall(op, oid="aaaaaaaaaaaaaaa", to=""):
        body = {"op": op, "id": oid}
        if to: body["to"] = to
        r = raw(LP, "POST", "/spei/op", {"Authorization": S["su"], **J}, json.dumps(body), timeout=60)
        return r.status, jbody(r)
    def trk(prefix="MBAN"):
        seq[0] += 1; return f"{prefix}{int(time.time() * 1000) % 10**11:011d}{seq[0]:04d}"
    def bxtime(minutes_ago=1): return (datetime.datetime.utcnow() - datetime.timedelta(hours=6, minutes=minutes_ago)).strftime("%d/%m/%Y %H:%M:%S")
    def mxdate(): return (datetime.datetime.utcnow() - datetime.timedelta(hours=6)).strftime("%d-%m-%Y")
    def addop(tracking, o, emisor="40012", mins=1, **over):
        d = dict(fecha=mxdate(), emisor=emisor, receptor=o["account_bank"], cuenta=o["account"], monto=o["amount"] / 100, status="Liquidado", account=o["account"], processed=bxtime(mins), received=bxtime(mins + 0), issuing="BBVA MEXICO", receiving="BANORTE")
        d.update(over); return S["fake"].add(tracking, **d)
    def settle(): time.sleep(0.7)
    def due(i): patch(i, next_try="2000-01-01 00:00:00.000Z")
    def entregas(): return [x["pago"] for x in L.api(LP, "GET", "/api/collections/entregas/records?perPage=500", None, S["su"])["items"]]

    def live_setup(_):
        S["fake"] = FakeBanxico(); S["omni"] = FakeOmni(VKEY, "gemini-lab"); live_boot()
        users = L.api(LP, "GET", "/api/collections/users", None, S["su"])
        L.api(LP, "PATCH", "/api/collections/users", dict(fields=users["fields"] + [dict(name="roles", type="select", values=["admin"], maxSelect=1), dict(name="status", type="text")]), S["su"])
        L.api(LP, "POST", "/api/collections", ENTREGAS, S["su"])
        return True, f"servidor con Banxico falso en 127.0.0.1:{S['fake'].port} (banxico.org.mx nunca se contacta)"
    add("Preparación: servidor con el Banxico falso", "Listo", live_setup)

    # ---- órdenes
    def create_ok(_):
        bad = []; uid, tok = mkuser(); r = order(tok, idemKey="order:abc123:v1"); j = jbody(r)
        if r.status != 200 or j.get("status") != "awaiting": return False, f"HTTP {r.status} {r.body[:160]}"
        oid = j["id"]
        if not re.match(r"^[a-z0-9]{15}$", oid): bad.append(f"id {oid!r}")
        a = j.get("account") or {}
        if a.get("number") != BNTE or a.get("label") != "Banorte" or a.get("holder") != "LAB BANORTE" or a.get("bankCode") != "40072": bad.append(f"el cliente de BBVA debe recibir la cuenta de Banorte: {a}")
        if j["amount"] != 30000 or j["currency"] != "MXN" or j["reports"] != 0: bad.append(f"monto/moneda/reportes: {j['amount']} {j['currency']} {j['reports']}")
        if j.get("manualReview") is not False: bad.append("manualReview debe ser false")
        if set(j) != {"id", "status", "amount", "baseAmount", "currency", "description", "subject", "account", "reports", "expiresAt", "paidAt", "created", "manualReview"}: bad.append(f"campos expuestos: {sorted(j)}")
        r2 = row(oid)
        if r2["status"] != "awaiting" or r2["user"] != uid or r2["account"] != BNTE or r2["account_bank"] != "40072" or r2["customer_bank"] != "40012": bad.append(f"fila: {r2['status']} {r2['account_bank']} {r2['customer_bank']}")
        ttl = (datetime.datetime.strptime(r2["expires_at"][:19], "%Y-%m-%d %H:%M:%S") - datetime.datetime.utcnow()).total_seconds() / 3600
        if not 23.5 < ttl < 24.1: bad.append(f"vigencia {ttl:.2f} h (esperaba 24)")
        return not bad, "; ".join(bad) or "orden creada con la cuenta de OTRO banco que el del cliente, monto del servidor, vigencia de 24 h y solo los campos públicos"
    add("Crear una orden: cuenta asignada de otro banco, vigencia y campos públicos", "Estado awaiting; sin datos internos", create_ok)

    def assign_rules(_):
        bad = []; _, tok = mkuser()
        for cb, want, mr in (("40072", BBVA, False), ("40012", BNTE, False), ("40638", BBVA, False), (None, BBVA, False)):
            o = dict(GOOD); o.pop("customerBank", None)
            if cb: o["customerBank"] = cb
            r = order(tok, opts=o); j = jbody(r)
            if r.status != 200 or (j.get("account") or {}).get("number") != want or j.get("manualReview") is not mr: bad.append(f"banco {cb}: {r.status} cuenta {(j.get('account') or {}).get('number')} (esperaba {want})")
        return not bad, "; ".join(bad) or "Banorte => BBVA, BBVA => Banorte, otro banco o ninguno => la primera"
    add("Asignación de cuenta según el banco del cliente", "Siempre que se pueda, de otro banco", assign_rules)

    def validation(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); n0 = len(rows())
        def sub(**k): return {**GOOD, **k}
        invalid = [("monto decimal", sub(amount=100.5)), ("monto texto", sub(amount="300")), ("monto negativo", sub(amount=-100)), ("monto cero", sub(amount=0)), ("monto bajo el mínimo", sub(amount=99)), ("monto sobre el máximo", sub(amount=5000001)),
                   ("monto booleano", sub(amount=True)), ("monto nulo", sub(amount=None)), ("sin descripción", {k: v for k, v in GOOD.items() if k != "description"}), ("descripción vacía", sub(description="  ")),
                   ("descripción con salto de línea", sub(description="a\nb")), ("descripción de 251", sub(description="x" * 251)), ("descripción numérica", sub(description=5)),
                   ("sujeto ausente", {k: v for k, v in GOOD.items() if k != "subject"}), ("sujeto.kind con mayúsculas", sub(subject={"kind": "Order", "id": "a"})), ("sujeto.id con espacio", sub(subject={"kind": "order", "id": "a b"})),
                   ("sujeto con clave extra", sub(subject={"kind": "order", "id": "a", "x": 1})), ("banco inexistente", sub(customerBank="99999")), ("banco numérico", sub(customerBank=40012)), ("banco __proto__", sub(customerBank="__proto__")),
                   ("el cliente intenta ELEGIR la cuenta", sub(account=BBVA)), ("el cliente intenta fijar el estado", sub(status="paid")), ("el cliente intenta fijar el banco receptor", sub(accountBank="40012")),
                   ("idemKey con espacio", sub(idemKey="a b")), ("idemKey de 65", sub(idemKey="a" * 65)), ("opciones no son un objeto", [1]), ("opciones nulas", None)]
        for label, o in invalid:
            r = order(tok, opts=o) if o is not None else raw(LP, "POST", "/spei/order", {"Authorization": tok, **J}, json.dumps({"opts": "null"}))
            if r.status != 400: bad.append(f"«{label}» → {r.status}")
        if len(rows()) != n0: bad.append("hubo filas de peticiones inválidas")
        for label, o in (("monto mínimo", sub(amount=100)), ("monto máximo", sub(amount=5000000)), ("idemKey de 64", sub(idemKey="a" * 64)), ("sujeto.id de 64", sub(subject={"kind": "order", "id": "a" * 64}))):
            r = order(tok, opts=o)
            if r.status != 200: bad.append(f"válido «{label}» rechazado → {r.status} {r.body[:80]}")
        return not bad, "; ".join(bad) or "monto, descripción, sujeto, banco, idemKey y TODA opción desconocida (cuenta, estado, banco receptor) se rechazan sin dejar filas; los extremos válidos pasan"
    add("Validación estricta de las opciones de createOrder", "400; el cliente nunca elige la cuenta ni el estado", validation)

    def auth_rules(_):
        bad = []; _, tok = mkuser(); n0 = len(rows())
        if order(None).status != 401: bad.append("anónimo debe recibir 401")
        if raw(LP, "POST", "/spei/su", {"Authorization": S["su"], **J}, "{}").status != 401: bad.append("un superusuario debe recibir 401")
        if raw(LP, "GET", "/spei/order", {"Authorization": tok}).status != 500: bad.append("createOrder desde GET debe ser error de programación (500)")
        if raw(LP, "POST", "/spei/pub", {**J}, "{}").status != 500: bad.append("createOrder en una ruta pública debe ser error de programación (500)")
        bu, bt = mkuser(); L.api(LP, "PATCH", f"/api/collections/users/records/{bu}", {"status": "suspended"}, S["su"])
        if order(bt).status not in (401, 403): bad.append("cuenta bloqueada debe ser rechazada")
        if len(rows()) != n0: bad.append("se guardó algo de una petición no autorizada")
        return not bad, "; ".join(bad) or "anónimo → 401, superusuario → 401, GET o ruta pública → error de programación, cuenta bloqueada → rechazada; nada se guarda"
    add("Quién puede crear órdenes: usuario de la colección, no GET, no público, no bloqueado", "Rechazo sin dejar filas", auth_rules)

    def idem_orders(_):
        bad = []; _, tok = mkuser(); _, tok2 = mkuser()
        a = jbody(order(tok, idemKey="k1")); b = jbody(order(tok, idemKey="k1"))
        if not a.get("id") or a["id"] != b.get("id"): bad.append("la misma idemKey debe devolver la MISMA orden")
        out = []; ts = [threading.Thread(target=lambda: out.append(jbody(order(tok, idemKey="k-conc")))) for _ in range(8)]
        [t.start() for t in ts]; [t.join() for t in ts]
        ids = {o.get("id") for o in out}
        if len(ids) != 1 or None in ids: bad.append(f"8 peticiones simultáneas con la misma llave crearon {len(ids)} órdenes")
        c = jbody(order(tok2, idemKey="k1"))
        if c.get("id") in (a.get("id"),): bad.append("la llave de otro usuario no debe devolver mi orden")
        if len(rows(f'idem_key = "k1"')) != 2 or len(rows('idem_key = "k-conc"')) != 1: bad.append("filas por llave incorrectas")
        return not bad, "; ".join(bad) or "idemKey: misma orden en reintentos y con 8 peticiones simultáneas; es por usuario"
    add("Idempotencia de createOrder (también con peticiones simultáneas)", "Una sola orden por llave y usuario", idem_orders)

    def limits(_):
        bad = []
        try:
            live_restart(livecfg(rep="perUserPerMin: 4, maxReportsPerOrder: 5, maxPendingPerUser: 3"))
            _, tok = mkuser(); r = [order(tok).status for _ in range(5)]
            if r != [200, 200, 200, 429, 429]: bad.append(f"tope de 3 pendientes: {r}")
            live_restart(livecfg(rep="perUserPerMin: 3, maxReportsPerOrder: 5, maxPendingPerUser: 50"))
            _, tok2 = mkuser(); rr = [order(tok2).status for _ in range(5)]
            if rr != [200, 200, 200, 429, 429]: bad.append(f"límite por minuto: {rr}")
        finally:
            live_restart(livecfg())
        return not bad, "; ".join(bad) or "tope de órdenes pendientes por usuario y límite por minuto (429)"
    add("Límites: órdenes pendientes y peticiones por minuto", "429 al superarlos", limits)

    # ---- reporte y verificación
    def happy(_):
        bad = []; f = S["fake"]; f.clear(); uid, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); R = row(oid); addop(k, R)
        r = report(tok, oid, tracking=k); j = jbody(r)
        if r.status != 200 or j.get("status") != "paid": return False, f"HTTP {r.status} {r.body[:200]} (llamadas: {len(f.posts())})"
        p = f.posts()
        if len(p) != 1: bad.append(f"debía consultar a Banxico una vez: {len(p)}")
        else:
            fm = p[0]["form"]; want = {"tipoCriterio": "T", "fecha": mxdate(), "criterio": k, "emisor": "40012", "receptor": "40072", "cuenta": BNTE, "receptorParticipante": "0", "monto": "300.00", "captcha": "c", "tipoConsulta": "0"}
            if fm != want: bad.append(f"formulario enviado a Banxico: {fm}")
            if "JSESSIONID=LABSESSION123" not in (p[0]["cookie"] or ""): bad.append("no reenvió la cookie de sesión")
            if p[0]["xrw"] != "XMLHttpRequest" or "x-www-form-urlencoded" not in (p[0]["ctype"] or ""): bad.append("cabeceras de la consulta")
        R = row(oid)
        if R["status"] != "paid" or not R["paid_at"] or not R["closed_at"] or R["bx_amount"] != 30000 or R["bx_status"] != "Liquidado" or R["tracking"] != k.upper() or R["bx_account_tail"] != BNTE[-4:]: bad.append(f"fila pagada: {R['status']} {R['bx_amount']} {R['bx_status']}")
        if j.get("account") is not None: bad.append("tras pagar ya no se muestra la cuenta")
        for leak in ("note", "tracking", "bx_status", "bx_amount", "bx_processed", "next_try", "idem_key"):
            if leak in j: bad.append(f"la vista expone {leak}")
        # reportar de nuevo la misma clave: idempotente, sin nueva consulta
        n = len(f.posts()); r2 = report(tok, oid, tracking=k)
        if r2.status != 200 or jbody(r2).get("status") != "paid" or len(f.posts()) != n: bad.append("reportar otra vez debe ser idempotente y no consultar")
        time.sleep(0.5)
        if entregas().count(oid) != 1: bad.append(f"el hook de entrega debía correr UNA vez: {entregas().count(oid)}")
        return not bad, "; ".join(bad) or "pagado con la consulta exacta a Banxico (fecha, emisor, receptor, cuenta, monto, captcha «c», cookie), campos guardados, reintento idempotente y entrega una sola vez"
    add("Camino feliz: la transferencia liquidada con todo correcto => pagado", "Banxico confirma; un solo pago; hook de entrega una vez", happy)

    def not_found_flow(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk()
        r = report(tok, oid, tracking=k); j = jbody(r)
        if r.status != 200 or j.get("status") != "checking": return False, f"HTTP {r.status} {r.body[:160]}"
        R = row(oid)
        if R["tracking"] != k.upper() or R["reports"] != 1 or R["tries"] != 1 or not R["next_try"]: bad.append(f"tras «no encontrada»: tries={R['tries']} reports={R['reports']} next_try={R['next_try']!r}")
        # aparece después: el conciliador lo paga
        addop(k, R); due(oid); settle(); st, res = opcall("reconcile")
        if row(oid)["status"] != "paid": bad.append(f"el conciliador no pagó al aparecer: {row(oid)['status']} {res}")
        return not bad, "; ".join(bad) or "«no encontrada» => checking (con intento contado y próxima consulta); cuando Banxico la muestra, el conciliador la paga"
    add("Transferencia aún no visible: checking y el conciliador la paga después", "Reintento programado", not_found_flow)

    def exhausted(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); report(tok, oid, tracking=k)
        for _i in range(3):
            due(oid); settle(); opcall("reconcile")
        R = row(oid)
        if R["status"] != "awaiting" or R["tracking"] != "" or "revisa la clave" not in R["note"]: bad.append(f"tras agotar los intentos: {R['status']} tracking={R['tracking']!r} {R['note']!r}")
        # la clave quedó libre: otra orden puede usarla
        _, tok2 = mkuser(); _, o2 = mkorder(tok2); R2 = row(o2["id"]); addop(k, R2)
        j2 = jbody(report(tok2, o2["id"], tracking=k))
        if j2.get("status") != "paid": bad.append(f"la clave liberada debería poder usarse: {j2.get('status')}")
        return not bad, "; ".join(bad) or "tras maxTries consultas sin éxito vuelve a awaiting liberando la clave (no se pierde para siempre)"
    add("Intentos agotados: vuelve a awaiting y libera la clave", "El cliente puede corregir", exhausted)

    def in_process(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); R = row(oid); op = addop(k, R, status="En proceso")
        j = jbody(report(tok, oid, tracking=k))
        if j.get("status") != "checking": bad.append(f"en proceso => checking: {j.get('status')}")
        if row(oid)["tries"] != 0: bad.append("«en proceso» no debe gastar intentos")
        op["status"] = "Liquidado"; due(oid); settle(); opcall("reconcile")
        if row(oid)["status"] != "paid": bad.append(f"al liquidarse debía pagarse: {row(oid)['status']}")
        return not bad, "; ".join(bad) or "«En proceso» espera sin gastar intentos y se paga al liquidarse"
    add("Transferencia «En proceso»: espera y se paga al liquidarse", "Sin gastar intentos", in_process)

    def bad_statuses(_):
        bad = []
        for st in ("Cancelado", "Rechazado", "Devuelto", "Retornado", "No liquidado", "En proceso de devolución", "Raro"):
            f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); addop(k, row(oid), status=st)
            j = jbody(report(tok, oid, tracking=k)); R = row(oid)
            if j.get("status") != "review" or "estado" not in R["note"]: bad.append(f"«{st}» => {j.get('status')} {R['note']!r}")
        return not bad, "; ".join(bad) or "cualquier estado que no sea «Liquidado» ni «En proceso» => revisión (nunca pagado ni fallado)"
    add("Estados distintos de Liquidado => revisión", "Nunca paid ni failed", bad_statuses)

    def anomalies(_):
        bad = []; f = S["fake"]
        cases = [("monto distinto (si Banxico lo devolviera)", dict(loose=True, monto=1.0, amount_text="1.00"), "monto"), ("otra cuenta beneficiaria", dict(loose=True, account=BBVA), "cuenta"), ("transferencia anterior a la orden", dict(mins=600), "anterior"), ("transferencia 5 min anterior (reclamar con una orden nueva la de otro cliente)", dict(mins=5), "anterior"),
                 ("clave de Banxico distinta", dict(loose=True, tracking_override="OTRA0000000000"), "clave"), ("fecha ilegible", dict(processed="ayer"), "fecha"), ("monto ilegible", dict(loose=True, amount_text="mucho"), "monto"),
                 ("cuenta enmascarada", dict(loose=True, account="**** 3451"), "cuenta")]
        for label, over, word in cases:
            f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); R = row(oid); over = dict(over); mins = over.pop("mins", 1); tov = over.pop("tracking_override", None)
            op = addop(k, R, mins=mins, **over)
            if tov: op["tracking"] = tov
            j = jbody(report(tok, oid, tracking=k)); R2 = row(oid)
            if j.get("status") != "review" or word not in R2["note"].lower(): bad.append(f"«{label}» => {j.get('status')} {R2['note']!r}")
        return not bad, "; ".join(bad) or "monto, cuenta, fecha anterior, clave distinta, fecha o monto ilegibles y cuenta enmascarada => revisión con el motivo en la nota"
    add("Anomalías en lo que devuelve Banxico => revisión con motivo", "Nunca pagado; el operador decide", anomalies)

    def strict_banxico(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); R = row(oid)
        addop(k, R, monto=1.0)   # en el sitio real un monto distinto = «no encontrada»
        j = jbody(report(tok, oid, tracking=k))
        if j.get("status") != "checking": bad.append(f"monto distinto en Banxico estricto => checking: {j.get('status')}")
        f.clear(); _, tok2 = mkuser(); _, o2 = mkorder(tok2); k2 = trk(); addop(k2, row(o2["id"]), emisor="40638")   # emisor distinto del declarado
        if jbody(report(tok2, o2["id"], tracking=k2, emisor="40012")).get("status") == "paid": bad.append("emisor distinto no debe pagarse")
        return not bad, "; ".join(bad) or "si Banxico no encuentra la operación con ESOS datos (monto o emisor distintos) no se paga"
    add("Banxico estricto: un dato distinto en la consulta => no encontrada => no se paga", "Como el sitio real", strict_banxico)

    def banxico_down(_):
        bad = []; f = S["fake"]
        for mode, delay in (("500", 0), ("503", 0), ("captcha", 0), ("maint", 0), ("err", 0), ("garbage", 0), ("empty", 0), ("huge", 0), ("redirect", 0), (None, 5.0)):
            f.clear(); f.mode, f.delay = mode, delay; _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); addop(k, row(oid))
            t0 = time.time(); j = jbody(report(tok, oid, tracking=k)); R = row(oid); el = time.time() - t0
            if j.get("status") != "checking" or R["tries"] != 0 or R["status"] == "paid": bad.append(f"modo {mode or 'lento'}: {j.get('status')} tries={R['tries']}")
            if el > 12: bad.append(f"modo {mode or 'lento'} tardó {el:.1f}s")
            f.mode, f.delay = None, 0.0; due(oid); settle(); opcall("reconcile")
            if row(oid)["status"] != "paid":
                R9 = row(oid); bad.append(f"modo {mode or 'lento'}: no se recuperó al volver Banxico: {R9['status']} tries={R9['tries']} next_try={R9['next_try']!r} note={R9['note']!r} reconcile={opcall('reconcile')[1]} posts={len(f.posts())}")
        f.clear()
        return not bad, "; ".join(bad) or "con Banxico caído, con captcha, en mantenimiento, con basura, enorme, con redirección o lento: la orden sigue en checking SIN gastar intentos y se paga al recuperarse"
    add("Banxico caído, captcha, basura o lento: nunca se paga ni se gasta el intento", "Reintento al recuperarse", banxico_down)

    def table_without_status(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); addop(k, row(oid), drop=["Estado del pago en Banxico"])
        j = jbody(report(tok, oid, tracking=k))
        if j.get("status") != "checking": bad.append(f"sin fila de estado => {j.get('status')} (no se puede dar por pagado)")
        return not bad, "; ".join(bad) or "una tabla sin el estado del pago no se interpreta como pagado"
    add("Tabla de Banxico sin el estado: no se interpreta como pagada", "checking", table_without_status)

    def hostile_values(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); R = row(oid)
        addop(k, R, status="<img src=x onerror=alert(1)>" + "x" * 300, issuing="'; DROP TABLE users;--")
        r = report(tok, oid, tracking=k); j = jbody(r); R = row(oid)
        if j.get("status") != "review": bad.append(f"estado hostil => {j.get('status')}")
        if "<" in r.body or "DROP" in r.body or "onerror" in r.body: bad.append("el texto hostil de Banxico llegó al cliente")
        if len(R["bx_status"]) > 40 or len(R["note"]) > 255: bad.append("campos sin acotar")
        return not bad, "; ".join(bad) or "texto hostil de Banxico: se acota, no llega al cliente y la orden va a revisión"
    add("Texto hostil en la respuesta de Banxico: acotado y fuera de la vista", "Revisión; sin eco al cliente", hostile_values)

    def reuse_and_burn(_):
        bad = []; f = S["fake"]; f.clear(); ua, ta = mkuser(); ub, tb = mkuser(); _, oa = mkorder(ta); _, ob = mkorder(tb); k = trk(); addop(k, row(oa["id"]))
        if jbody(report(ta, oa["id"], tracking=k)).get("status") != "paid": bad.append("el primero debía pagarse")
        n = len(f.posts()); jb = jbody(report(tb, ob["id"], tracking=k.lower()))
        if jb.get("status") != "review": bad.append(f"la clave ya usada (en minúsculas) debe ir a revisión: {jb.get('status')}")
        Rb = row(ob["id"])
        if Rb["tracking"] != "" or Rb["last_tracking"] != k.lower() or "ya acredita" not in Rb["note"]: bad.append(f"fila del segundo: tracking={Rb['tracking']!r} last={Rb['last_tracking']!r} {Rb['note']!r}")
        if len(f.posts()) != n: bad.append("no debía consultar a Banxico por una clave ya usada")
        if row(oa["id"])["status"] != "paid": bad.append("el primer pago no debe alterarse")
        _, oc = mkorder(ta); jc = jbody(report(ta, oc["id"], tracking="  " + k + "  "))
        if jc.get("status") != "review": bad.append(f"mismo usuario, otra orden, clave con espacios alrededor: {jc.get('status')}")
        return not bad, "; ".join(bad) or "una clave acredita UN solo pago: otra orden (de otro usuario o del mismo, con mayúsculas/espacios/guiones distintos) va a revisión sin consultar a Banxico"
    add("Una clave de rastreo acredita un solo pago", "La segunda orden va a revisión", reuse_and_burn)

    def concurrent_claim(_):
        bad = []; f = S["fake"]; f.clear(); ua, ta = mkuser(); ub, tb = mkuser(); _, oa = mkorder(ta); _, ob = mkorder(tb); k = trk(); addop(k, row(oa["id"]))
        out = []
        def go(tok, oid): out.append(jbody(report(tok, oid, tracking=k)).get("status"))
        ts = [threading.Thread(target=go, args=(ta, oa["id"])) for _ in range(3)] + [threading.Thread(target=go, args=(tb, ob["id"])) for _ in range(3)]
        [t.start() for t in ts]; [t.join() for t in ts]
        sa, sb = row(oa["id"])["status"], row(ob["id"])["status"]
        paid = [s for s in (sa, sb) if s == "paid"]
        if len(paid) > 1: bad.append(f"DOBLE ACREDITACIÓN: {sa} / {sb}")
        if "paid" not in (sa, sb) and "checking" not in (sa, sb): bad.append(f"nadie quedó pagado ni verificando: {sa} / {sb}")
        if len(rows(f'tracking_u = "{k.upper()}"')) > 1: bad.append("la clave acredita a dos órdenes")
        if entregas().count(oa["id"]) + entregas().count(ob["id"]) > 1: bad.append("se entregó dos veces")
        return not bad, "; ".join(bad) or f"6 reportes simultáneos de la misma clave en 2 órdenes: nunca más de un pago ({sa}/{sb}), una sola fila con la clave y una sola entrega"
    add("Carrera: la misma clave reportada a la vez en dos órdenes", "A lo sumo un pago", concurrent_claim)

    def cross_user(_):
        bad = []; f = S["fake"]; f.clear(); ua, ta = mkuser(); ub, tb = mkuser(); _, oa = mkorder(ta); k = trk(); addop(k, row(oa["id"]))
        if report(tb, oa["id"], tracking=k).status != 404: bad.append("reportar la orden de otro debe ser 404")
        if raw(LP, "GET", f"/spei/get?id={oa['id']}", {"Authorization": tb}).status != 404: bad.append("ver la orden de otro debe ser 404")
        if raw(LP, "GET", f"/spei/get?id={oa['id']}", {"Authorization": ta}).status != 200: bad.append("el dueño debe poder verla")
        lst = jbody(raw(LP, "GET", "/spei/list?kind=order&sid=abc123", {"Authorization": tb}))
        if any(x["id"] == oa["id"] for x in lst.get("items", [])): bad.append("la lista de otro usuario muestra mi orden")
        if raw(LP, "POST", "/spei/sureport", {"Authorization": S["su"], **J}, json.dumps({"id": oa["id"]})).status != 401: bad.append("un superusuario no reporta (401)")
        if raw(LP, "POST", "/spei/pubreport", {**J}, "{}").status != 500: bad.append("report en ruta pública debe ser error de programación")
        if raw(LP, "GET", "/spei/report", {"Authorization": ta}).status != 500: bad.append("report desde GET debe ser error de programación")
        if report(None, oa["id"], tracking=k).status != 401: bad.append("anónimo debe recibir 401")
        for badid in ("../x", "A" * 15, "x" * 14, "", "' OR 1=1 --"):
            if report(ta, badid, tracking=k).status not in (404, 400): bad.append(f"id raro {badid!r}")
        if f.posts(): bad.append("se consultó a Banxico en peticiones no autorizadas")
        if row(oa["id"])["status"] != "awaiting": bad.append("la orden cambió por peticiones ajenas")
        return not bad, "; ".join(bad) or "orden ajena: 404 sin consultar a Banxico; superusuario, anónimo, GET y ruta pública rechazados; la orden no cambia"
    add("Orden ajena, anónimo, superusuario, GET y ruta pública: rechazados", "Sin consultar a Banxico", cross_user)

    def report_validation(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok, ); oid = o["id"]
        o2 = jbody(order(tok, opts={k: v for k, v in GOOD.items() if k != "customerBank"})); noid = o2["id"]
        T = trk()
        invalid = [("clave corta", dict(tracking="ABC")), ("clave de 31", dict(tracking="A" * 31)), ("clave con comilla", dict(tracking="MBAN0100'; DROP")), ("clave con salto", dict(tracking="MBAN01002609\n04")), ("clave unicode", dict(tracking="MBANñ0100260904")),
                   ("clave numérica", dict(tracking=12345678)), ("clave nula", dict(tracking=None)), ("clave arreglo", dict(tracking=[T])), ("sin clave", dict()), ("referencia de 7 dígitos", dict(tracking="1234567")),
                   ("emisor inexistente", dict(tracking=T, emisor="99999")), ("emisor numérico", dict(tracking=T, emisor=40012)), ("emisor __proto__", dict(tracking=T, emisor="__proto__")),
                   ("fecha mal formada", dict(tracking=T, date="mañana")), ("fecha inexistente", dict(tracking=T, date="31-02-2026")), ("fecha futura", dict(tracking=T, date="01-01-2090")), ("fecha numérica", dict(tracking=T, date=20260101)),
                   ("intenta fijar la cuenta", dict(tracking=T, account=BBVA)), ("intenta fijar el estado", dict(tracking=T, status="paid")), ("intenta fijar el monto", dict(tracking=T, amount=1)), ("intenta fijar el receptor", dict(tracking=T, receptor="40012"))]
        for label, inp in invalid:
            r = report(tok, oid, **inp)
            if r.status != 400: bad.append(f"«{label}» → {r.status}")
        if raw(LP, "POST", "/spei/report", {"Authorization": tok, **J}, json.dumps({"id": oid, "input": "[1]"})).status != 400: bad.append("entrada no objeto debe ser 400")
        if report(tok, noid, tracking=trk("XTRK")).status != 400: bad.append("sin banco del cliente ni pista en la clave, el emisor es obligatorio (400)")
        if f.posts(): bad.append("se consultó a Banxico con entradas inválidas")
        if row(oid)["status"] != "awaiting" or row(oid)["reports"] != 0: bad.append("la orden cambió por entradas inválidas")
        return not bad, "; ".join(bad) or "clave, emisor, fecha y TODA clave desconocida (cuenta, estado, monto, receptor) se rechazan con 400 sin consultar a Banxico ni tocar la orden"
    add("Validación estricta de lo que reporta el cliente", "400 sin consultar a Banxico; nunca decide la cuenta", report_validation)

    def hint_and_same_bank(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk("MBAN"); addop(k, row(oid), emisor="40012")
        j = jbody(report(tok, oid, tracking=k, emisor="40072"))   # el cliente eligió mal el banco en la pantalla: la clave (MBAN=BBVA) manda
        if j.get("status") != "paid": bad.append(f"la pista de la clave debía corregir el banco: {j.get('status')}")
        if f.posts() and f.posts()[0]["form"]["emisor"] != "40012": bad.append(f"emisor enviado: {f.posts()[0]['form']['emisor']}")
        f.clear(); _, tok2 = mkuser(); _, o2 = mkorder(tok2); k2 = trk("XTRK")
        j2 = jbody(report(tok2, o2["id"], tracking=k2, emisor="40072")); R2 = row(o2["id"])
        if j2.get("status") != "review" or "mismo" not in R2["note"] or f.posts(): bad.append(f"mismo banco (Banorte => cuenta de Banorte) => revisión SIN consultar: {j2.get('status')} {R2['note']!r} llamadas={len(f.posts())}")
        f.clear(); _, tok3 = mkuser(); _, o3 = mkorder(tok3); j3 = jbody(report(tok3, o3["id"], tracking=trk("BTE")))
        if j3.get("status") != "review" or f.posts(): bad.append(f"la pista BTE (Banorte) contra la cuenta de Banorte => revisión: {j3.get('status')}")
        return not bad, "; ".join(bad) or "la pista de la clave corrige un banco mal elegido; mismo banco (declarado o por pista) => revisión manual sin consultar a Banxico"
    add("Pista del banco por la clave y mismo banco => revisión manual", "SPEI no genera CEP entre cuentas del mismo banco", hint_and_same_bank)

    def date_handling(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); R = row(oid)
        y = (datetime.datetime.utcnow() - datetime.timedelta(hours=6, days=1)).strftime("%d-%m-%Y")
        addop(k, R, fecha=y, mins=1)
        j = jbody(report(tok, oid, tracking=k, date=y))
        if f.posts() and f.posts()[0]["form"]["fecha"] != y: bad.append(f"fecha enviada {f.posts()[0]['form']['fecha']}")
        f.clear(); _, tok2 = mkuser(); _, o2 = mkorder(tok2); jbody(report(tok2, o2["id"], tracking=trk()))
        if not f.posts() or f.posts()[0]["form"]["fecha"] != mxdate(): bad.append("sin fecha, debe usar el día de la orden en hora de México")
        return not bad, "; ".join(bad) or "la fecha del cliente se envía tal cual (dd-mm-aaaa); sin ella se usa el día de la orden en hora de Ciudad de México"
    add("Fecha de la consulta: la del cliente o el día de la orden (hora de México)", "Formato dd-mm-aaaa", date_handling)

    def report_cap(_):
        bad = []
        try:
            live_restart(livecfg(rep="perUserPerMin: 1000, maxReportsPerOrder: 2, maxPendingPerUser: 50"))
            f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]
            for _i in range(2): report(tok, oid, tracking=trk()); settle()
            j = jbody(report(tok, oid, tracking=trk()))
            if j.get("status") != "review": bad.append(f"el tercer reporte debía ir a revisión: {j.get('status')} reports={row(oid)['reports']}")
        finally:
            live_restart(livecfg())
        return not bad, "; ".join(bad) or "tope de reportes por orden: el exceso va a revisión (no se puede sondear claves sin fin)"
    add("Tope de reportes por orden", "Revisión al excederlo", report_cap)

    def expiry(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; patch(oid, expires_at="2000-01-01 00:00:00.000Z")
        r = report(tok, oid, tracking=trk()); R = row(oid)
        if R["status"] != "expired" or f.posts(): bad.append(f"reportar una orden vencida => expired sin consultar: {R['status']} llamadas={len(f.posts())}")
        _, tok2 = mkuser(); _, o2 = mkorder(tok2); patch(o2["id"], expires_at="2000-01-01 00:00:00.000Z"); settle(); st, res = opcall("reconcile")
        if row(o2["id"])["status"] != "expired": bad.append("el conciliador debe vencer las órdenes sin reporte")
        _, tok3 = mkuser(); _, o3 = mkorder(tok3); report(tok3, o3["id"], tracking=trk()); patch(o3["id"], expires_at="2000-01-01 00:00:00.000Z", next_try="2000-01-01 00:00:00.000Z"); settle(); opcall("reconcile")
        if row(o3["id"])["status"] != "review": bad.append(f"checking vencido hace más de 24 h => review: {row(o3['id'])['status']}")
        return not bad, "; ".join(bad) or "orden vencida: no se consulta y queda expired; el conciliador vence las no reportadas y manda a revisión las verificando sin respuesta tras 24 h"
    add("Vencimiento de órdenes", "expired / review", expiry)

    def reconcile_rules(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); report(tok, oid, tracking=k); settle()
        n = len(f.posts()); st, res = opcall("reconcile")   # next_try en el futuro: no se toca
        if len(f.posts()) != n: bad.append("el conciliador consultó una orden cuya próxima consulta es futura")
        due(oid); settle(); n = len(f.posts())
        f.delay = 1.2   # Banxico lento: la primera verificación sigue en curso mientras llegan las otras dos (si no, no hay solape real)
        out = []; ts = [threading.Thread(target=lambda: out.append(opcall("reconcile")[1])) for _ in range(3)]
        [t.start() for t in ts]; [t.join() for t in ts]; f.delay = 0.0
        if len(f.posts()) - n > 2: bad.append(f"3 conciliadores simultáneos consultaron {len(f.posts()) - n} veces la misma orden (una verificación hace como mucho 2 consultas: la clave y su variante)")
        return not bad, "; ".join(bad) or f"el conciliador respeta next_try y con ejecuciones solapadas consulta cada orden una sola vez (consultas contadas: {len(f.posts()) - n}; respuestas: {[(x.get(chr(99)+chr(104)+chr(101)+chr(99)+chr(107)+chr(101)+chr(100)), x.get(chr(114)+chr(117)+chr(110)+chr(110)+chr(105)+chr(110)+chr(103))) for x in out]})"
    add("Conciliador: respeta la próxima consulta y no se solapa", "Una consulta por orden", reconcile_rules)

    def operator(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; jbody(report(tok, oid, tracking=trk("XTRK"), emisor="40072"))
        if row(oid)["status"] != "review": return False, "preparación: debía estar en revisión"
        st, j = opcall("review", oid, "paid")
        if st != 200 or row(oid)["status"] != "paid" or not row(oid)["paid_at"] or "resuelta como pagada" not in row(oid)["note"]: bad.append(f"resolver como pagada: {st} {row(oid)['status']}")
        time.sleep(0.4)
        if entregas().count(oid) != 1: bad.append("la resolución debe disparar la entrega una vez")
        if opcall("review", oid, "failed")[0] != 409: bad.append("resolver otra vez una ya resuelta debe ser 409")
        _, tok2 = mkuser(); _, o2 = mkorder(tok2); jbody(report(tok2, o2["id"], tracking=trk("XTRK"), emisor="40072"))
        if opcall("review", o2["id"], "failed")[0] != 200 or row(o2["id"])["status"] != "failed": bad.append("resolver como fallida")
        _, o3 = mkorder(tok2)
        if opcall("review", o3["id"], "paid")[0] != 409: bad.append("solo las órdenes en revisión se resuelven (409)")
        if opcall("review", oid, "x")[0] != 400: bad.append("destino inválido => 400")
        # el cliente no puede mover una orden en revisión ni la pagada
        if jbody(report(tok, oid, tracking=trk())).get("status") != "paid": bad.append("una orden pagada no cambia por nuevos reportes")
        return not bad, "; ".join(bad) or "el operador resuelve revisiones (pagada dispara la entrega una vez; ya resuelta 409; solo en revisión); el cliente no puede moverla"
    add("Operador: resolver una revisión como pagada o fallida", "Solo review; entrega una vez", operator)

    def activation(_):
        bad = []; _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; jbody(report(tok, oid, tracking=trk("XTRK"), emisor="40072")); opcall("review", oid, "paid")
        res = []; ts = [threading.Thread(target=lambda: res.append(opcall("claim", oid)[1].get("ok"))) for _ in range(8)]
        [t.start() for t in ts]; [t.join() for t in ts]
        if res.count(True) != 1: bad.append(f"claimActivation concedida {res.count(True)} veces entre 8 simultáneas")
        if opcall("activated", oid)[1].get("ok") is not False: bad.append("markActivated tras reclamar ya no debe aplicar de nuevo")
        _, o2 = mkorder(tok)
        if opcall("claim", o2["id"])[1].get("ok") is not False: bad.append("no se activa una orden no pagada")
        if opcall("claim", "../x")[1].get("ok") is not False: bad.append("id inválido")
        return not bad, "; ".join(bad) or "claimActivation: exactamente una concesión con 8 simultáneas; solo órdenes pagadas; ids inválidos rechazados"
    add("Entrega: claimActivation/markActivated atómicos", "Una concesión; solo pagadas", activation)

    def retention(_):
        bad = []; _, tok = mkuser(); ids = {}
        for name in ("failed", "expired", "paid", "review", "checking", "awaiting"):
            _, o = mkorder(tok); ids[name] = o["id"]
            patch(o["id"], status=name, closed_at="2000-01-01 00:00:00.000Z" if name in ("failed", "expired", "paid") else "")
        st, dry = opcall("purge", "aaaaaaaaaaaaaaa", "dry")
        if dry.get("failed") != 1 or dry.get("expired") != 1 or dry.get("paid") != 0 or not dry.get("dryRun"): bad.append(f"simulacro: {dry}")
        if len(rows(f'id = "{ids["failed"]}"')) != 1: bad.append("el simulacro borró")
        st, res = opcall("purge")
        left = {n: bool(rows(f'id = "{i}"')) for n, i in ids.items()}
        if left != {"failed": False, "expired": False, "paid": True, "review": True, "checking": True, "awaiting": True}: bad.append(f"retención: {left}")
        return not bad, "; ".join(bad) or "se purgan fallidas y vencidas antiguas; NUNCA pagadas (paidDays 0), revisión, verificando ni pendientes; el simulacro no borra"
    add("Retención: qué se borra y qué nunca", "Por fecha de cierre", retention)

    def anonymize(_):
        bad = []; uid, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); addop(k, row(oid)); report(tok, oid, tracking=k)
        L.api(LP, "DELETE", f"/api/collections/users/records/{uid}", None, S["su"]); time.sleep(0.4)
        R = row(oid)
        if R["user"] or R["description"] or R["subject_id"] or R["customer_bank"]: bad.append(f"no se anonimizó: user={R['user']!r} desc={R['description']!r}")
        if R["status"] != "paid" or R["amount"] != 30000 or R["tracking"] != k.upper() or not R["paid_at"]: bad.append("se perdió información contable")
        return not bad, "; ".join(bad) or "al borrar al usuario se pierde el vínculo y los textos libres; monto, estado, clave y fechas se conservan"
    add("Borrar al usuario anonimiza sus órdenes", "Conserva lo contable", anonymize)

    def snapshot(_):
        bad = []
        try:
            _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk(); addop(k, row(oid))
            live_restart(livecfg(), accounts=OTHER)   # cambian las cuentas del negocio: la orden vieja conserva la SUYA
            f = S["fake"]; f.clear(); j = jbody(report(tok, oid, tracking=k))
            if j.get("status") != "paid" or not f.posts() or f.posts()[0]["form"]["cuenta"] != BNTE: bad.append(f"la orden vieja debe verificarse contra su cuenta original: {j.get('status')}")
            _, o2 = mkorder(tok, customerBank="40072")
            if (o2.get("account") or {}).get("number") != NU: bad.append(f"las órdenes nuevas usan las cuentas nuevas: {(o2.get('account') or {}).get('number')}")
        finally:
            live_restart(livecfg(), accounts=ACCOUNTS)
        return not bad, "; ".join(bad) or "la cuenta se congela al crear la orden: cambiar el archivo de cuentas no afecta a las ya creadas"
    add("La cuenta de la orden queda congelada al crearla", "Cambiar el archivo no altera órdenes viejas", snapshot)

    def no_leaks(_):
        bad = []; log = S["pb"].log(); blob = json.dumps(rows())
        for name, v in (("CLABE de BBVA", BBVA), ("CLABE de Banorte", BNTE)):
            if v in log: bad.append(f"{name} aparece en el log")
        return not bad, "; ".join(bad) or "tras todas las pruebas, ni las cuentas ni datos de Banxico aparecen en el log del servidor"
    add("Las cuentas no aparecen en los logs del servidor", "Tras operar, reportar, revisar y purgar", no_leaks)


    # ------------------------------------------------------------------ claves reales: guion, mayúsculas
    def key_shape(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; R = row(oid)
        k = "SPIN-" + str(int(time.time() * 1000))[-11:] + "YPDFH5B9"     # como la de Spin: con guion
        addop(k, R, emisor="90728")
        if jbody(report(tok, oid, tracking=k)).get("status") != "paid": bad.append("una clave con guion debe poder pagarse")
        p = f.posts()
        if not p or p[0]["form"]["criterio"] != k: bad.append(f"la clave debe enviarse EXACTA a Banxico: {p[0]['form']['criterio'] if p else None}")
        f.clear(); _, tok2 = mkuser(); _, o2 = mkorder(tok2); oid2 = o2["id"]; k2 = "SPIN-" + str(int(time.time() * 1000))[-11:] + "ABCDEFGH"
        addop(k2, row(oid2), emisor="90728")
        f.clear(); j2 = jbody(report(tok2, oid2, tracking=k2.lower()))      # Banxico distingue mayúsculas, pero el módulo prueba las variantes: la minúscula se resuelve a la clave real
        if j2.get("status") != "paid" or len(f.posts()) > 4: bad.append(f"la clave escrita en minúsculas debe resolverse con una variante (≤4 consultas): {j2.get('status')} consultas={len(f.posts())}")
        if row(oid2)["tracking"] != k2: bad.append(f"la clave final debe ser la de Banxico: {row(oid2)['tracking']!r}")
        f.clear(); _, tok3 = mkuser(); _, o3 = mkorder(tok3); k3 = "SPIN-" + str(int(time.time() * 1000))[-11:] + "ZZZZZZZZ"; addop(k3, row(o3["id"]), emisor="90728")
        j3 = jbody(report(tok3, o3["id"], tracking=k3.replace("-", "")))   # sin el guion tampoco
        if j3.get("status") == "paid": bad.append("la clave sin el guion no debe pagar (no se puede inventar el guion)")
        return not bad, "; ".join(bad) or "la clave con guion (Spin) se envía exacta y paga; en minúsculas se resuelve con una variante y se guarda la clave de Banxico; sin el guion no se puede inventar y no se paga"
    add("Claves con guion y sensibles a mayúsculas (como en Banxico real)", "Exacta; variantes => no encontrada", key_shape)

    # ------------------------------------------------------------------ lectura del comprobante (enrutador falso)
    IMG = "iVBORw0KGgo" + "A" * 201
    def omni(): return S["omni"]
    def read(tok, oid, img=IMG): return raw(LP, "POST", "/spei/read", {"Authorization": tok, **J} if tok else {**J}, json.dumps({"id": oid, "image": img}))
    def auto(tok, oid, img=IMG): return raw(LP, "POST", "/spei/auto", {"Authorization": tok, **J} if tok else {**J}, json.dumps({"id": oid, "image": img}))
    def reading(**over):
        d = {"tracking_key": "SPIN-20261023192350YPDFH5B9", "amount": 300.0, "date": mxdate(), "issuing_bank_code": "90728", "issuing_bank_name": "SPIN BY OXXO", "confidence": 0.95}
        d.update(over); return json.dumps({k: v for k, v in d.items() if v != "__drop__"})

    def vis_call(_):
        bad = []; om = omni(); om.clear(); uid, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; om.set(reading())
        r = read(tok, oid); j = jbody(r)
        if r.status != 200 or j.get("ready") is not True or j.get("input") != {"tracking": "SPIN-20261023192350YPDFH5B9", "emisor": "90728", "date": mxdate()}: return False, f"HTTP {r.status} {r.body[:240]}"
        if len(om.calls) != 1: bad.append(f"debía llamar al enrutador una vez: {len(om.calls)}")
        else:
            c = om.calls[0]; b = c["body"]
            if c["auth"] != "Bearer " + VKEY: bad.append("falta la cabecera Authorization Bearer")
            if b["model"] != "gemini-lab" or b["temperature"] != 0 or b["max_tokens"] != 2048: bad.append(f"parámetros: {b['model']} {b['temperature']} {b['max_tokens']}")
            sysm = b["messages"][0]["content"]
            if "DATO NO CONFIABLE" not in sysm or "NUNCA la instituci" not in sysm: bad.append("el prompt del sistema no avisa que la imagen no es confiable")
            if b["messages"][1]["content"][1]["image_url"]["url"] != "data:image/png;base64," + IMG: bad.append("la imagen debe enviarse como data URI con el tipo decidido por su contenido")
            for secret, name in ((BNTE, "cuenta de Banorte"), (BBVA, "cuenta de BBVA"), ("LAB BANORTE", "titular"), ("Pedido 1042", "descripción de la orden"), (uid, "id del usuario"), (oid, "id de la orden"), ("abc123", "sujeto")):
                if secret in c["text"]: bad.append(f"al modelo se le envió la {name}")
        R = row(oid)
        if R["status"] != "awaiting" or R["reports"] != 0: bad.append("leer el comprobante no debe cambiar la orden")
        if IMG[:40] in json.dumps(rows()) or IMG[:40] in S["pb"].log(): bad.append("la imagen quedó guardada en la base o en el log")
        return not bad, "; ".join(bad) or "una llamada con Bearer, modelo, temperatura 0 y la imagen como data URI; al modelo no se le envía ninguna cuenta ni dato de la orden; la orden no cambia y la imagen no se guarda"
    add("Lectura del comprobante: qué se envía al modelo (y qué no) y que no se guarda", "Sin cuentas ni datos de la orden", vis_call)

    def vis_variants(_):
        bad = []; om = omni(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]
        sc = [("completa", reading(), True, []), ("en bloque ```json", "```json\n" + reading() + "\n```", True, []), ("monto como texto", reading(amount="300.00"), True, []),
              ("fecha con hora", reading(date="%s 01:23:50 p.m." % mxdate().replace("-", "/")), True, []), ("banco solo por nombre", reading(issuing_bank_code=None), True, []), ("banco como número", reading(issuing_bank_code=90728), True, []),
              ("monto distinto del de la orden", reading(amount=1.0), False, ["amount_mismatch"]), ("confianza baja", reading(confidence=0.2), False, ["low_confidence"]), ("sin clave", reading(tracking_key=None), False, ["tracking_unreadable"]),
              ("el banco leído es el del DESTINO", reading(issuing_bank_code="40072", issuing_bank_name="BANORTE"), False, ["bank_matches_destination"]), ("sin banco", reading(issuing_bank_code=None, issuing_bank_name=None), False, ["bank_unreadable"]),
              ("claves extra (intento de asignación masiva)", json.dumps({**json.loads(reading()), "status": "paid", "account": BBVA, "amount_paid": 1}), True, []),
              ("todo hostil", json.dumps({"tracking_key": "<script>alert(1)</script>", "amount": "1; DROP TABLE x", "date": "ayer", "issuing_bank_code": "../../x", "confidence": "sí"}), False, ["tracking_unreadable", "bank_unreadable", "amount_unreadable", "low_confidence"]),
              ("texto libre", "Claro, aquí tienes los datos del comprobante.", False, ["tracking_unreadable", "bank_unreadable", "amount_unreadable", "low_confidence"]), ("JSON roto", "{no", False, ["tracking_unreadable"]), ("arreglo", "[1,2,3]", False, ["tracking_unreadable"])]
        for label, content, ready, warns in sc:
            om.set(content); r = read(tok, oid); j = jbody(r)
            if r.status != 200: bad.append(f"«{label}» → HTTP {r.status}"); continue
            if j.get("ready") is not ready or any(w not in j.get("warnings", []) for w in warns): bad.append(f"«{label}»: ready={j.get('ready')} warnings={j.get('warnings')}")
            if "<script" in r.body or "DROP TABLE" in r.body or BBVA in r.body: bad.append(f"«{label}»: texto del modelo en la respuesta")
        om.set(reading(), mode="parts"); j = jbody(read(tok, oid))
        if j.get("ready") is not True: bad.append("contenido del modelo como lista de partes")
        om.set(None, mode="huge"); j = jbody(read(tok, oid))
        if j.get("ready") is not False or "tracking_unreadable" not in j.get("warnings", []): bad.append("una respuesta enorme debe tratarse como ilegible")
        if row(oid)["status"] != "awaiting": bad.append("la orden cambió")
        return not bad, "; ".join(bad) or "completa, en bloque, monto texto, fecha con hora, banco por nombre o número => lista; monto distinto, confianza baja, sin clave, banco del destino, sin banco, hostil, texto libre, JSON roto, arreglo o enorme => avisos y nunca lista; claves extra no hacen nada"
    add("Lectura del comprobante: variantes del modelo y salidas hostiles", "Solo propone; todo se valida", vis_variants)

    def vis_failures(_):
        bad = []; om = omni(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]
        for mode in ("500", "429", "garbage", "nochoices", "emptychoices", "nullcontent", "length"):
            om.clear(); om.set(reading(), mode=mode); r = read(tok, oid)
            if r.status != 502 or VKEY in r.body or "choices" in r.body: bad.append(f"modo {mode}: HTTP {r.status} {r.body[:80]}")
        if row(oid)["status"] != "awaiting" or row(oid)["reports"] != 0: bad.append("un fallo del proveedor cambió la orden")
        if VKEY in S["pb"].log(): bad.append("la clave del enrutador aparece en el log")
        om.clear(); om.set(reading()); j = jbody(read(tok, oid))
        if j.get("ready") is not True: bad.append("no se recuperó al volver el proveedor")
        return not bad, "; ".join(bad) or "con el proveedor caído, limitado, devolviendo basura, sin respuesta, vacío o TRUNCADO: 502 sin detalles ni la clave, la orden no cambia y se recupera"
    add("Lectura del comprobante: proveedor caído, basura o respuesta truncada", "502 sin secretos; la orden no cambia", vis_failures)

    def vis_images(_):
        bad = []; om = omni(); om.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]
        invalid = [("vacía", ""), ("muy corta", "iVBOR"), ("caracteres no base64", IMG[:100] + "!!!!" + IMG[104:]), ("largo no múltiplo de 4", IMG[:-1]), ("GIF", "R0lGODlh" + "A" * 204), ("PDF", "JVBERi0x" + "A" * 204),
                   ("SVG", "PHN2ZyB4bWxucz0" + "A" * 197), ("texto", "aGVsbG8gd29ybGQ=" * 20), ("demasiado grande (64 KB)", IMG + "A" * 90000), ("con espacios", IMG[:50] + " " + IMG[51:]), ("con salto de línea", IMG[:50] + "\n" + IMG[51:])]
        for label, img in invalid:
            r = read(tok, oid, img)
            if r.status != 400: bad.append(f"«{label}» → {r.status}")
        if raw(LP, "POST", "/spei/read", {"Authorization": tok, **J}, json.dumps({"id": oid, "image": 5})).status != 400: bad.append("imagen no texto debe ser 400")
        if om.calls: bad.append(f"se llamó al enrutador {len(om.calls)} veces con imágenes inválidas")
        om.set(reading())
        for label, img in (("PNG", IMG), ("JPEG", "/9j/" + "A" * 208), ("WebP", "UklGR" + "A" * 207)):
            r = read(tok, oid, img)
            if r.status != 200: bad.append(f"válida «{label}» rechazada → {r.status} {r.body[:80]}")
        return not bad, "; ".join(bad) or "vacía, corta, no base64, largo malo, GIF, PDF, SVG, texto, grande, con espacios o saltos => 400 sin llamar al enrutador; PNG, JPEG y WebP pasan (el tipo lo decide el contenido, no el cliente)"
    add("Lectura del comprobante: validación estricta de la imagen", "400 sin llamar al modelo", vis_images)

    def vis_auth(_):
        bad = []; om = omni(); om.clear(); om.set(reading()); ua, ta = mkuser(); ub, tb = mkuser(); _, o = mkorder(ta); oid = o["id"]
        if read(tb, oid).status != 404: bad.append("leer para la orden de otro debe ser 404")
        if read(None, oid).status != 401: bad.append("anónimo debe recibir 401")
        if raw(LP, "GET", "/spei/read", {"Authorization": ta}).status != 500: bad.append("readReceipt desde GET debe ser error de programación")
        bu, bt = mkuser(); L.api(LP, "PATCH", f"/api/collections/users/records/{bu}", {"status": "suspended"}, S["su"])
        if read(bt, oid).status not in (401, 403, 404): bad.append("cuenta bloqueada debe ser rechazada")
        for bad_id in ("../x", "x" * 14, ""):
            if read(ta, bad_id).status not in (400, 404): bad.append(f"id raro {bad_id!r}")
        _, o2 = mkorder(ta); patch(o2["id"], status="paid", paid_at="2026-01-01 00:00:00.000Z")
        if read(ta, o2["id"]).status != 409: bad.append("una orden pagada no se lee (409)")
        if om.calls: bad.append(f"se llamó al enrutador en peticiones no autorizadas: {len(om.calls)}")
        return not bad, "; ".join(bad) or "orden ajena 404, anónimo 401, GET y bloqueados rechazados, orden pagada 409; nunca se llama al modelo (cuesta dinero)"
    add("Lectura del comprobante: quién puede pedirla", "Sin llamar al modelo si no está autorizado", vis_auth)

    def vis_off_and_limits(_):
        bad = []
        try:
            live_restart(livecfg(vis="enabled: false")); om = omni(); om.clear(); _, tok = mkuser(); _, o = mkorder(tok)
            if read(tok, o["id"]).status != 500 or om.calls: bad.append("con la visión apagada debe ser error de programación sin llamar al modelo")
            live_restart(livecfg(vis="enabled: true, maxKB: 64, perUserPerMin: 100, maxPerOrder: 3, timeoutSeconds: 5")); om.clear(); om.set(reading()); _, tok = mkuser(); _, o = mkorder(tok)
            for _i in range(5): read(tok, o["id"], "R0lGODlh" + "A" * 204)   # inválidas: no gastan cupo
            r = [read(tok, o["id"]).status for _i in range(5)]
            if r != [200, 200, 200, 429, 429]: bad.append(f"tope por orden: {r}")
            live_restart(livecfg(vis="enabled: true, maxKB: 64, perUserPerMin: 2, maxPerOrder: 100, timeoutSeconds: 5")); om.clear(); om.set(reading()); _, tok = mkuser(); _, o = mkorder(tok)
            r = [read(tok, o["id"]).status for _i in range(4)]
            if r != [200, 200, 429, 429]: bad.append(f"tope por minuto: {r}")
        finally:
            live_restart(livecfg())
        return not bad, "; ".join(bad) or "visión apagada: error de programación sin llamadas; topes por orden y por minuto (429); las imágenes inválidas no gastan cupo"
    add("Lectura del comprobante: apagada y con límites", "429 al exceder; inválidas no cuentan", vis_off_and_limits)

    def vis_auto(_):
        bad = []; om = omni(); f = S["fake"]
        # 1. todo legible y coincide: se reporta solo y Banxico confirma
        om.clear(); f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = "SPIN-" + str(int(time.time() * 1000))[-11:] + "AAAAAAAA"; addop(k, row(oid), emisor="90728")
        om.set(reading(tracking_key=k)); j = jbody(auto(tok, oid))
        if j.get("auto") is not True or (j.get("order") or {}).get("status") != "paid" or len(f.posts()) != 1 or len(om.calls) != 1: bad.append(f"automático feliz: {j.get('auto')} {(j.get('order') or {}).get('status')} banxico={len(f.posts())} omni={len(om.calls)}")
        # 2. monto distinto: no se reporta
        om.clear(); f.clear(); _, tok = mkuser(); _, o = mkorder(tok); om.set(reading(amount=1.0)); j = jbody(auto(tok, o["id"]))
        if j.get("auto") is not False or row(o["id"])["status"] != "awaiting" or f.posts() or "amount_mismatch" not in j.get("warnings", []): bad.append(f"monto distinto: {j.get('auto')} {row(o['id'])['status']} {j.get('warnings')}")
        # 3. banco leído = destino, baja confianza: no se reporta
        for label, c in (("banco del destino", reading(issuing_bank_code="40072", issuing_bank_name="BANORTE")), ("confianza baja", reading(confidence=0.1)), ("sin clave", reading(tracking_key=None))):
            om.clear(); f.clear(); _, tok = mkuser(); _, o = mkorder(tok); om.set(c); j = jbody(auto(tok, o["id"]))
            if j.get("auto") is not False or row(o["id"])["status"] != "awaiting" or f.posts(): bad.append(f"{label}: no debe reportarse solo ({j.get('auto')})")
            if j.get("reading") is None: bad.append(f"{label}: debe devolver lo leído para que el cliente lo complete")
        # 4. el modelo propone una clave que Banxico no conoce: se reporta, queda verificando y NO se paga
        om.clear(); f.clear(); _, tok = mkuser(); _, o = mkorder(tok); om.set(reading(tracking_key="SPIN-99999999999INVENTADA")); j = jbody(auto(tok, o["id"]))
        if (j.get("order") or {}).get("status") != "checking": bad.append(f"clave inventada por el modelo: {(j.get('order') or {}).get('status')}")
        oid_inv = o["id"]
        for _i in range(3): due(oid_inv); settle(); opcall("reconcile")
        Ri = row(oid_inv)
        if Ri["status"] != "review" or "validar a mano" not in Ri["note"] or Ri["source"] != "receipt": bad.append(f"una clave leída del comprobante que Banxico no confirma va a revisión manual: {Ri['status']} {Ri['note']!r} source={Ri['source']!r}")
        _, tokm = mkuser(); _, om2 = mkorder(tokm); jbody(report(tokm, om2["id"], tracking="SPIN-99999999999TECLEADA"))
        for _i in range(3): due(om2["id"]); settle(); opcall("reconcile")
        if row(om2["id"])["status"] != "awaiting": bad.append("una clave escrita a mano que Banxico no confirma vuelve a awaiting (el cliente puede corregirla)")
        # 5. el modelo propone la clave de un pago YA acreditado: revisión, nunca un segundo pago
        om.clear(); f.clear(); _, tok = mkuser(); _, o = mkorder(tok); om.set(reading(tracking_key=k)); j = jbody(auto(tok, o["id"]))
        if (j.get("order") or {}).get("status") != "review" or row(o["id"])["status"] != "review": bad.append(f"clave ya usada propuesta por el modelo: {(j.get('order') or {}).get('status')}")
        return not bad, "; ".join(bad) or "reporte automático solo si TODO es legible y el monto coincide (y aun así Banxico decide); si no, devuelve lo leído; una clave inventada queda verificando; una ya usada va a revisión"
    add("Reporte automático desde el comprobante: solo cuando todo cuadra", "Banxico sigue decidiendo", vis_auto)


    # ------------------------------------------------------------------ endurecimiento: corrección de un reporte, pista del banco y centavos únicos
    def correct_report(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok, customerBank="40012"); oid = o["id"]; k = trk("XTRK"); addop(k, row(oid), emisor="40638")
        j1 = jbody(report(tok, oid, tracking=k, emisor="40012"))   # banco equivocado: Banxico no la encuentra
        if j1.get("status") != "checking": bad.append(f"con el banco equivocado debe quedar verificando: {j1.get('status')}")
        settle(); n = len(f.posts()); j2 = jbody(report(tok, oid, tracking=k, emisor="40638"))   # el cliente corrige el banco con la MISMA clave
        if j2.get("status") != "paid" or len(f.posts()) == n or row(oid)["reports"] != 2: bad.append(f"corregir el banco con la misma clave debe reintentar con el dato nuevo: {j2.get('status')} reportes={row(oid)['reports']}")
        return not bad, "; ".join(bad) or "reportar la misma clave con otro banco o fecha se trata como una corrección y se vuelve a consultar con el dato nuevo"
    add("Corregir un reporte (mismo código, otro banco) vuelve a consultar", "No se queda atascado con el dato viejo", correct_report)

    def hint_not_override(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = trk("NU"); addop(k, row(oid), emisor="40012")   # prefijo NU (pista: Nubank) pero el banco real es BBVA
        j = jbody(report(tok, oid, tracking=k, emisor="40012")); ems = [p["form"]["emisor"] for p in f.posts()]
        if j.get("status") != "paid" or ems[:2] != ["40638", "40012"]: bad.append(f"una pista equivocada no debe impedir el pago: {j.get('status')} bancos consultados={ems}")
        return not bad, "; ".join(bad) or "una pista de prefijo equivocada se prueba primero pero no pisa el banco que eligió el cliente: se consultan ambos"
    add("La pista del prefijo no pisa el banco elegido por el cliente", "Se prueban los dos", hint_not_override)

    def inline_cap(_):
        bad = []; f = S["fake"]; f.clear(); _, tok = mkuser(); _, o = mkorder(tok); oid = o["id"]; k = "Ab-" + str(int(time.time() * 1000))[-11:] + "xYz"
        report(tok, oid, tracking=k, emisor="40638")
        if len(f.posts()) > 2: bad.append(f"el reporte en línea hizo {len(f.posts())} consultas (máximo 2: el cliente está esperando)")
        n = len(f.posts()); due(oid); settle(); opcall("reconcile")
        if len(f.posts()) - n < 3: bad.append(f"el conciliador debe probar el resto de variantes: {len(f.posts()) - n}")
        return not bad, "; ".join(bad) or "en línea solo 2 consultas; el conciliador prueba las demás variantes"
    add("Reporte en línea acotado a 2 consultas; el conciliador hace el resto", "El cliente no espera minutos", inline_cap)

    def unique_cents(_):
        bad = []
        try:
            live_restart(livecfg("uniqueCents: { enabled: true, max: 99 }")); f = S["fake"]; f.clear(); ua, ta = mkuser(); ub, tb = mkuser()
            amts = []
            for _i in range(6):
                r = order(ta); j = jbody(r)
                if r.status != 200: bad.append(f"crear: {r.status} {r.body[:100]}"); break
                amts.append(j["amount"])
                if j["baseAmount"] != 30000 or not 30000 <= j["amount"] <= 30099: bad.append(f"monto fuera de rango: {j['amount']} base {j['baseAmount']}")
            if len(set(amts)) != len(amts): bad.append(f"montos repetidos entre órdenes abiertas: {amts}")
            rs = []; ts = [threading.Thread(target=lambda: rs.append(order(tb))) for _ in range(12)]
            [t.start() for t in ts]; [t.join() for t in ts]
            out = [jbody(r) for r in rs]; mine = [x.get("amount") for x in out]
            allopen = [x["amount"] for x in rows('status = "awaiting"') if x["account"] == BNTE and x["user"] in (ua, ub)]
            if None in mine or len(set(allopen)) != len(allopen): bad.append(f"12 creaciones simultáneas: respuestas sin monto={[(r.status, r.body[:90]) for r in rs if r.status != 200][:3]} repetidos={len(allopen) - len(set(allopen))}")
            # robo de clave: la orden del atacante tiene OTRO monto, así que Banxico (que busca el monto exacto) no encuentra la clave en ella
            f.clear(); _, tv = mkuser(); _, ov = mkorder(tv); _, tx = mkuser(); _, oa = mkorder(tx); k = trk("MBAN")
            if ov["amount"] == oa["amount"]: bad.append("la orden de la víctima y la del atacante tienen el mismo monto")
            addop(k, row(ov["id"]), emisor="40012")
            ja = jbody(report(tx, oa["id"], tracking=k))
            if ja.get("status") == "paid" or row(oa["id"])["status"] == "paid": bad.append("EL ATACANTE COBRÓ LA CLAVE DE OTRO CLIENTE")
            if jbody(report(tv, ov["id"], tracking=k)).get("status") != "paid": bad.append("la víctima debe poder pagar con su clave")
            live_restart(livecfg("uniqueCents: { enabled: true, max: 2 }")); _, tc = mkuser()
            r = [order(tc, amount=55500).status for _i in range(5)]
            if r != [200, 200, 200, 429, 429]: bad.append(f"con max 2 solo caben 3 órdenes abiertas del mismo monto por cuenta: {r}")
        finally:
            live_restart(livecfg())
        return not bad, "; ".join(bad) or "con centavos únicos: montos distintos entre órdenes abiertas (también con 12 creaciones simultáneas), el atacante no puede cobrar la clave de otro cliente y se acota el cupo por monto"
    add("Centavos únicos por orden: sin montos repetidos y sin robo de clave", "El monto distingue a cada cliente", unique_cents)


    def no_squatting(_):
        bad = []; f = S["fake"]; f.clear(); _, tv = mkuser(); _, ov = mkorder(tv); _, tx = mkuser(); _, oa = mkorder(tx, amount=99999); k = trk("MBAN"); addop(k, row(ov["id"]), emisor="40012")
        ja = jbody(report(tx, oa["id"], tracking=k))    # el atacante conoce la clave (sale en el comprobante) y la reporta PRIMERO en una orden suya
        if ja.get("status") == "paid": bad.append("el atacante no debe cobrar con otro monto")
        if row(oa["id"])["tracking_u"] != "": bad.append("reportar una clave no debe quemarla")
        jv = jbody(report(tv, ov["id"], tracking=k))
        if jv.get("status") != "paid": bad.append(f"la víctima debe poder pagar aunque otro reportara antes su clave: {jv.get('status')} {row(ov['id'])['note']!r}")
        jx = jbody(report(tx, oa["id"], tracking=k + "x"))   # ya con la clave quemada, otra orden va a revisión sin consultar
        f.clear(); _, tz = mkuser(); _, oz = mkorder(tz); jz = jbody(report(tz, oz["id"], tracking=k))
        if jz.get("status") != "review" or f.posts() or "ya acredita" not in row(oz["id"])["note"]: bad.append(f"una clave ya pagada va a revisión sin consultar: {jz.get('status')} posts={len(f.posts())}")
        return not bad, "; ".join(bad) or "reportar una clave ajena no la acapara: la víctima puede pagar; una clave ya pagada manda cualquier otro reporte a revisión sin consultar a Banxico"
    add("Acaparar claves: reportar la clave de otro no bloquea su pago", "La clave se quema solo al pagar", no_squatting)


    def cli_all(_):
        bad = []; f = S["fake"]; f.clear(); import subprocess as sp
        _, tok = mkuser(); _, o1 = mkorder(tok); pid = o1["id"]; k1 = trk(); addop(k1, row(pid)); report(tok, pid, tracking=k1)
        _, o2 = mkorder(tok); rid = o2["id"]; jbody(report(tok, rid, tracking=trk("XTRK"), emisor="40072"))   # mismo banco => revisión
        _, o3 = mkorder(tok); fid = o3["id"]; jbody(report(tok, fid, tracking=trk("XTRK"), emisor="40072"))
        if row(pid)["status"] != "paid" or row(rid)["status"] != "review": return False, f"preparación: {row(pid)['status']} / {row(rid)['status']}"
        kc = "SPIN-" + str(int(time.time() * 1000))[-11:] + "CLICHECK"
        f.add(kc, fecha=mxdate(), emisor="40638", receptor="40012", cuenta=BBVA, monto=300.0, status="Liquidado", account=BBVA, processed=bxtime(1), received=bxtime(1))
        S["pb"].stop(); root, full = S["root"], S["env"]; n0 = len(f.posts())
        def cli(*a):
            r = sp.run([EXE, "pbmini:spei", *a, f"--dir={root}/pb_data", f"--hooksDir={root}/pb_hooks", f"--publicDir={root}/pb_public"], capture_output=True, text=True, timeout=90, cwd=root, env=dict(os.environ, **full), encoding="utf-8", errors="replace")
            return r.returncode, r.stdout + r.stderr
        def jout(o):
            i, j = o.find("{"), o.rfind("}")
            try: return json.loads(o[i:j + 1])
            except Exception: return {}
        try:
            rc, o = cli("status"); st = jout(o)
            if rc != 0 or not st.get("enabled") or st.get("orders", {}).get("paid", 0) < 1 or st.get("orders", {}).get("review", 0) < 1: bad.append(f"status: rc={rc} {o[-220:]!r}")
            if BBVA in o or BNTE in o or VKEY in o: bad.append("status muestra una cuenta completa o un secreto")
            if not any(a.get("account", "").startswith("…") for a in st.get("accounts", [])): bad.append("las cuentas deben verse enmascaradas (…últimos 4)")
            rc, o = cli("show", pid); sh = jout(o)
            if rc != 0 or sh.get("status") != "paid" or sh.get("tracking") != k1 or BNTE in o or not sh.get("account", "").startswith("…"): bad.append(f"show: rc={rc} {o[-200:]!r}")
            if cli("show", "zzzzzzzzzzzzzzz")[0] == 0 or cli("show")[0] == 0 or cli("nada")[0] == 0 or cli()[0] == 0: bad.append("show de una orden inexistente, sin argumentos o un subcomando desconocido deben fallar")
            rc, o = cli("review", rid, "paid")
            if rc != 2 or "confirm" not in o: bad.append(f"review sin `confirm` debe salir con 2 sin tocar nada: rc={rc}")
            if cli("review", rid, "talvez", "confirm")[0] == 0: bad.append("destino inválido debe fallar")
            if cli("review", pid, "failed", "confirm")[0] == 0: bad.append("solo las órdenes en revisión se resuelven")
            rc, o = cli("review", rid, "paid", "confirm")
            if rc != 0: bad.append(f"review paid confirm: rc={rc} {o[-160:]!r}")
            rc, o = cli("review", fid, "failed", "confirm")
            if rc != 0: bad.append(f"review failed confirm: rc={rc} {o[-160:]!r}")
            if cli("purge", "dry")[0] != 0 or cli("reconcile")[0] not in (0, 1): bad.append("purge dry y reconcile deben funcionar")
            rc, o = cli("check", kc, "40638", "300"); ch = jout(o)
            if rc != 0 or ch.get("encontrada") is not True or ch.get("estado") != "Liquidado" or BBVA in o: bad.append(f"check de una transferencia existente: rc={rc} {o[-220:]!r}")
            if cli("check", kc.lower(), "40638", "300")[0] == 0: bad.append("check con la clave en minúsculas debe decir «no encontrada» (Banxico busca exacto)")
            if cli("check", kc, "40638", "999")[0] == 0: bad.append("check con otro monto no debe encontrarla")
            if cli("check", "corta", "40638", "300")[0] == 0 or cli("check", kc, "40638", "abc")[0] == 0 or cli("check", kc, "40638", "300", "31-02-2026")[0] == 0 or cli("check", kc, "40638", "300", "01-01-2026", "9")[0] == 0 or cli("check", kc)[0] == 0: bad.append("check con argumentos inválidos debe fallar sin consultar")
            if len(f.posts()) - n0 != 3: bad.append(f"check debía consultar a Banxico 3 veces (la buena y dos con datos erróneos): {len(f.posts()) - n0}")
        finally:
            live_boot()
        if row(rid)["status"] != "paid" or row(fid)["status"] != "failed" or row(pid)["status"] != "paid": bad.append(f"estados tras el CLI: {row(rid)['status']} {row(fid)['status']} {row(pid)['status']}")
        return not bad, "; ".join(bad) or "CLI: status y show sin cuentas completas ni secretos, review exige `confirm` y solo mueve órdenes en revisión, check consulta a Banxico sin tocar órdenes y rechaza argumentos inválidos sin consultar"
    add("CLI pbmini:spei: status, show, reconcile, purge, review y check", "`confirm` obligatorio; sin cuentas completas", cli_all)

    # ------------------------------------------------------------------ núcleo puro (node, sin PocketBase)
    NODE = {"res": None}
    def unit():
        if NODE["res"] is None:
            node = shutil.which("node")
            if not node: NODE["res"] = ("skip", "no hay Node en este sistema (instálalo para correr las pruebas del núcleo puro)")
            else:
                r = subprocess.run([node, os.path.join(L.HERE, "unit_spei.js"), os.path.join(L.ROOT, "pb_hooks")], capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
                try: NODE["res"] = ("ok", json.loads(r.stdout.strip().splitlines()[-1]))
                except Exception: NODE["res"] = ("err", (r.stdout + r.stderr)[-400:])
        return NODE["res"]
    def unit_case(group, obj, meta):
        def run(_):
            kind, res = unit()
            if kind == "skip": return None, "OMITIDO: " + res
            if kind == "err": return False, "no se pudo ejecutar unit_spei.js: " + res
            g = res["groups"].get(group)
            if g is None: return False, f"el grupo «{group}» no existe en unit_spei.js"
            return not g["fail"], ("; ".join(g["fail"][:6]) + (f" (+{len(g['fail']) - 6})" if len(g["fail"]) > 6 else "")) or f"{g['pass']} comprobaciones"
        add(obj, meta, run)
    unit_case("CLABE y tarjeta", "CLABE (dígito verificador) y tarjeta (Luhn)", "Solo cuentas matemáticamente válidas; basura de cualquier tipo => no válida")
    unit_case("cuenta receptora", "Cuenta receptora: CLABE o tarjeta, banco comprobado, titular y etiqueta sin HTML", "Banco declarado distinto del de la CLABE, tarjeta sin banco, claves extra y textos peligrosos => error")
    unit_case("archivo de cuentas", "Archivo de cuentas: 1 a 10, sin repetidas, JSON estricto", "Cualquier defecto aborta; una cuenta mala invalida todo el archivo")
    unit_case("elegir cuenta", "Elegir la cuenta: siempre de otro banco que el del cliente si es posible", "Sin banco, banco inválido o solo cuentas del mismo banco => primera cuenta y bandera")
    unit_case("clave de rastreo, fechas y montos", "Clave de rastreo, fechas dd-mm-aaaa (hora de México) y montos de Banxico", "Solo 8..30 alfanuméricos; fechas inexistentes, texto o futuras => inválido; montos con más de 2 decimales => inválido")
    unit_case("bancos", "Catálogo de bancos de Banxico (97) y pistas por prefijo", "Sin prefijos repetidos; __proto__ y constructor no son bancos")
    unit_case("transiciones", "Máquina de estados: matriz de transiciones", "Solo las permitidas; revisión solo por operador")
    unit_case("decisión (decide)", "decide(): `paid` solo si TODO coincide con lo nuestro", "Cualquier anomalía => review; Banxico caído => reintento; ninguna mutación de un campo da paid")
    unit_case("lectura del comprobante", "Lectura del comprobante: validación de lo que propone el modelo, tipo de imagen y prompt", "Solo campos válidos; texto libre, hostil o enorme => nulo; el prompt no lleva cuentas ni datos de la orden")
    unit_case("parseo de Banxico", "Parseo de la respuesta de Banxico (Latin-1, tabla, no encontrada, errores)", "Solo la tabla con estado o el aviso exacto; cualquier otra página es error y nunca «no encontrada»")

    # ------------------------------------------------------------------ fail-closed
    def bad_boot_case(label, env, speicfg, accounts):
        def run(_):
            root, full = sandbox("speibad", env, CFG % speicfg, accounts=accounts)
            full = {**full, "PBMINI_ON_ERROR": ""}
            pb = L.PB(EXE, root, BADPORT, env=full); pb.serve(); died, end = False, time.time() + 14
            while time.time() < end:
                if pb.proc.poll() is not None: died = True; break
                time.sleep(0.25)
            log = pb.log(); pb.stop()
            leaked = [n for n, v in (("la clave del enrutador", VKEY), ("una CLABE", BBVA)) if v in log]
            return died and ("pbmini" in log) and not leaked, ("abortó el arranque (fail-closed)" if died else "ARRANCÓ con configuración inválida") + (f"; el log contiene {leaked}" if leaked else "")
        add(f"Fail-closed: {label}", "El servidor NO arranca; el mensaje nombra la opción, no el valor", run)
    for lab_, env_, cfg_, acc_ in cfgs(): bad_boot_case(lab_, env_, cfg_, acc_)

    def live_teardown(_):
        try:
            if S["pb"]: S["pb"].stop()
        finally:
            if S["fake"]: S["fake"].stop()
            if S.get("omni"): S["omni"].stop()
        return True, "servidor, Banxico falso y enrutador falso detenidos"
    add("Limpieza: se detienen el servidor y el Banxico falso", "Listo", live_teardown)

    return cases
