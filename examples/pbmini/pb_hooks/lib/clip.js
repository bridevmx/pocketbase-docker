// Módulo opcional de pagos con links de Clip (apagado por defecto; ver pbmini.config.js). Basado en el plugin probado clip-payment-links.
// Regla de oro: un pago NUNCA se da por bueno por lo que diga el webhook ni la URL de retorno; solo cuando Clip responde COMPLETED con NUESTRA referencia, monto, moneda y un recibo.
//  - Secretos solo en entorno: CLIP_API_TOKEN ("Basic <base64>" tal cual, Clip tiene un generador), CLIP_WEBHOOK_TOKEN (va en la URL del webhook y por eso queda en logs: no firma nada).
//  - La referencia (external_reference) se firma con CLIP_API_TOKEN, que nunca viaja en una URL.
//  - Colección interna pbmini_clip_payments (reglas null: solo superusuario).
const cfg = () => require(`${__hooks}/lib/config.js`).load().clip;
const COLL = "pbmini_clip_payments";
const TOKEN_RE = /^Basic [A-Za-z0-9+\/]{8,2000}={0,2}$/;
const WEBHOOK_RE = /^[A-Za-z0-9_-]{32,256}$/;
const fail = (m) => { throw new Error("pbmini clip: " + m); };

// ---- entorno (validado al registrar: fail-closed; los mensajes nombran la variable, nunca su valor) ------------------------------------------
let _env = null;
function env() {
  if (_env) return _env;
  const get = (n) => String($os.getenv(n) || "");
  const token = get("CLIP_API_TOKEN"), hook = get("CLIP_WEBHOOK_TOKEN"), prev = get("CLIP_WEBHOOK_TOKEN_PREV");
  if (!TOKEN_RE.test(token)) fail('CLIP_API_TOKEN ausente o inválido (debe ser "Basic <base64 de API_KEY:SECRET>", generado en developer.clip.mx)');
  if (!WEBHOOK_RE.test(hook)) fail("CLIP_WEBHOOK_TOKEN ausente o inválido (32..256 caracteres [A-Za-z0-9_-])");
  if (prev && (!WEBHOOK_RE.test(prev) || prev === hook)) fail("CLIP_WEBHOOK_TOKEN_PREV inválido (como CLIP_WEBHOOK_TOKEN y distinto de él)");
  const api = (get("CLIP_API_URL") || "https://api.payclip.com").replace(/\/+$/, "");
  if (api !== "https://api.payclip.com" && !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(api)) fail("CLIP_API_URL solo puede ser https://api.payclip.com (o http://127.0.0.1:puerto en el laboratorio)");
  const pub = (get("CLIP_PUBLIC_URL") || cfg().publicUrl || "").replace(/\/+$/, "");
  if (!pub) fail("falta la URL pública: clip.publicUrl en pbmini.config.js o la variable CLIP_PUBLIC_URL (https, sin ruta)");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(pub) && !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(pub)) fail("la URL pública de Clip debe ser https://host (sin ruta, parámetros ni credenciales)");
  return (_env = { token, hook, prev, api, pub });
}
const redact = (s) => { let t = String(s); try { const e = env(); [e.token, e.hook, e.prev].forEach((x) => { if (x) t = t.split(x).join("«secreto»"); }); } catch (_) {} return t; };
const validate = () => { if (!cfg().enabled) return; env(); };

// ---- colección interna -----------------------------------------------------------------------------------------------------------------------
function ensure(app) {
  try { app.findCollectionByNameOrId(COLL); return; } catch (_) { /* no existe: se crea */ }
  const c = cfg(), ro = c.readRules, hid = (name, extra) => Object.assign({ name, hidden: ro }, extra);
  app.save(new Collection({
    type: "base", name: COLL, listRule: ro ? "user = @request.auth.id" : null, viewRule: ro ? "user = @request.auth.id" : null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "reference", type: "text", required: true, max: 36 }, hid("clip_id", { type: "text", max: 36 }), { name: "user", type: "text", max: 30 },
      { name: "subject_kind", type: "text", max: 32 }, { name: "subject_id", type: "text", max: 64 },
      { name: "amount", type: "number", required: true, onlyInt: true, min: 100 }, { name: "currency", type: "text", required: true, max: 8 }, { name: "description", type: "text", max: 250 },
      { name: "url", type: "text", max: 500 }, hid("qr_url", { type: "text", max: 500 }),
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["created", "pending", "paid", "failed", "expired", "review", "refunded"] },
      { name: "receipt_no", type: "text", max: 64 }, hid("note", { type: "text", max: 255 }), hid("idem_key", { type: "text", max: 64 }),
      { name: "expires_at", type: "date" }, { name: "paid_at", type: "date" }, { name: "closed_at", type: "date" }, { name: "activated_at", type: "date" }, hid("checked_at", { type: "date" }),
      hid("refund_id", { type: "text", max: 64 }), { name: "refund_receipt_no", type: "text", max: 64 }, { name: "refunded_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      `CREATE UNIQUE INDEX idx_${COLL}_reference ON ${COLL} (reference)`,
      `CREATE UNIQUE INDEX idx_${COLL}_clip_id ON ${COLL} (clip_id) WHERE clip_id != ''`,
      `CREATE UNIQUE INDEX idx_${COLL}_receipt ON ${COLL} (receipt_no) WHERE receipt_no != ''`,
      `CREATE UNIQUE INDEX idx_${COLL}_idem ON ${COLL} (user, idem_key) WHERE idem_key != ''`,
      `CREATE UNIQUE INDEX idx_${COLL}_refund ON ${COLL} (refund_id) WHERE refund_id != ''`,
      `CREATE INDEX idx_${COLL}_status ON ${COLL} (status, created)`,
    ],
  }));
}
// Al servir: la colección de usuarios configurada debe existir y ser de autenticación.
function validateSchema(app) {
  const c = cfg();
  if (!c.enabled) return;
  const col = app.findCollectionByNameOrId(c.collection);
  if (col.type !== "auth") fail(`la colección "${c.collection}" no es de autenticación`);
}

// ================================================================ NÚCLEO PURO (sin base de datos ni red: se prueba aparte, ver lab/unit_clip.js) ================================
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isClipId = (v) => typeof v === "string" && UUID.test(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Estados oficiales de Clip -> estado interno. Mapeo EXACTO (sin mayúsculas/minúsculas ni regex): cualquier otro valor es `pending`, nunca `paid`.
const STATUS = { CHECKOUT_COMPLETED: "paid", CHECKOUT_CANCELLED: "failed", CHECKOUT_EXPIRED: "expired", CHECKOUT_CREATED: "pending", CHECKOUT_PENDING: "pending" };
const mapStatus = (raw) => (typeof raw === "string" && hasOwn(STATUS, raw) ? STATUS[raw] : "pending");

// Dinero: el sistema usa CENTAVOS enteros; Clip habla en pesos con hasta 2 decimales. Sin aritmética flotante en las comparaciones.
const MAX_CENTS = 100000000000; // 1,000 millones de pesos: tope de cordura
function toCents(v) { // pesos (número o texto "123.45") -> centavos enteros, o null si no es un monto válido con ≤2 decimales
  if (typeof v === "string") { if (!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(v)) return null; const [i, d] = v.split("."), c = Number(i) * 100 + Number(((d || "") + "00").slice(0, 2)); return c > MAX_CENTS ? null : c; }
  if (typeof v !== "number" || !isFinite(v) || v < 0 || v > MAX_CENTS / 100) return null;
  const c = Math.round(v * 100);
  return Math.abs(v * 100 - c) < 1e-6 ? c : null; // más de 2 decimales => inválido
}
const fromCents = (c) => { if (!Number.isInteger(c) || c < 0 || c > MAX_CENTS) throw new Error("pbmini clip: monto en centavos inválido"); return Number((c / 100).toFixed(2)); };

// Referencia propia (external_reference de Clip, <= 36): PREFIJO-<id 15>-<firma 8>. La firma NO es seguridad frente a Clip: descarta referencias inventadas sin tocar la base.
// La clave es CLIP_API_TOKEN (nunca viaja en una URL); la comparación es en tiempo constante.
const PREFIX_RE = /^[A-Z]{2,6}$/, ID_RE = /^[a-z0-9]{15}$/;
const signature = (key, id) => $security.hs256("payref:v1:" + id, key).slice(0, 8);
function makeReference(prefix, key, id) {
  if (!PREFIX_RE.test(String(prefix))) throw new Error("pbmini clip: prefijo de referencia inválido");
  if (typeof key !== "string" || key.length < 8) throw new Error("pbmini clip: falta la clave para firmar la referencia");
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("pbmini clip: id de pago inválido");
  return prefix + "-" + id + "-" + signature(key, id);
}
function parseReference(prefix, key, ref) { // id del pago si la referencia es nuestra (formato y firma válidos); si no, null. Nunca lanza.
  if (typeof ref !== "string" || ref.length > 64 || typeof key !== "string" || key.length < 8 || !PREFIX_RE.test(String(prefix))) return null;
  const m = new RegExp("^" + prefix + "-([a-z0-9]{15})-([a-f0-9]{8})$").exec(ref);
  return m && $security.equal(m[2], signature(key, m[1])) ? m[1] : null;
}

// Transiciones permitidas (`*` = solo por acción explícita del operador). Un pago tardío (failed/expired -> paid) SÍ se registra: el cliente pagó.
const TRANSITIONS = {
  created: ["pending", "failed"], pending: ["paid", "failed", "expired", "review"], failed: ["paid", "review"], expired: ["paid", "review"], review: ["paid", "failed"], paid: ["refunded"], refunded: [],
};
const OPERATOR_ONLY = { "review>paid": 1, "review>failed": 1, "paid>refunded": 1 };
const canTransition = (from, to) => hasOwn(TRANSITIONS, from) && TRANSITIONS[from].indexOf(to) >= 0;
const needsOperator = (from, to) => hasOwn(OPERATOR_ONLY, from + ">" + to);
const fromStates = (to) => Object.keys(TRANSITIONS).filter((f) => TRANSITIONS[f].indexOf(to) >= 0 && !needsOperator(f, to)); // estados desde los que el SISTEMA puede llegar a `to` (para el UPDATE ... WHERE status IN (...))

// Decide, SIN efectos, qué hacer con lo que Clip dijo. Es la pieza más importante: `paid` solo si TODO coincide con lo nuestro.
//   payment = { id, reference, amount (centavos) }   remote = { status (ya mapeado), amountCents, currency, reference, receiptNo }
//   ctx = { prefix, key, receiptUsedByOther(receiptNo) -> bool }
const RECEIPT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const clip255 = (t) => String(t).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 255);
function decide(payment, remote, ctx) {
  if (!remote || typeof remote !== "object") return { to: "pending" };
  if (remote.status === "failed" || remote.status === "expired") return { to: remote.status };
  if (remote.status !== "paid") return { to: "pending" };
  const problems = [];
  if (parseReference(ctx.prefix, ctx.key, remote.reference) !== payment.id || remote.reference !== payment.reference) problems.push("referencia distinta");
  if (!Number.isInteger(remote.amountCents) || remote.amountCents !== payment.amount) problems.push(Number.isInteger(remote.amountCents) ? "monto distinto" : "monto ilegible");
  if (remote.currency !== "MXN") problems.push("moneda distinta");
  if (problems.length) return { to: "review", note: clip255("Clip completó el pago pero no coincide: " + problems.join("; ")) };
  if (!remote.receiptNo) return { to: "pending" }; // el recibo aún no aparece: se reintenta
  if (typeof remote.receiptNo !== "string" || !RECEIPT_RE.test(remote.receiptNo)) return { to: "review", note: "recibo con formato inválido" };
  if (ctx.receiptUsedByOther(remote.receiptNo)) return { to: "review", note: "recibo ya usado por otro pago" };
  return { to: "paid", receiptNo: remote.receiptNo };
}

// ================================================================ CLIENTE DE CLIP =====================================================================================
//   POST {api}/v2/checkout        crea el link (amount en PESOS con 2 decimales, currency, purchase_description, redirection_url{success,error,default}, metadata.external_reference, webhook_url, custom_payment_options)
//   GET  {api}/v2/checkout/{id}   estado: status, amount, currency, metadata.external_reference y, SOLO si está completado, receipt_no
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LINK_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(clip\.mx|payclip\.com)(\/|$)/i; // el comprador solo es llevado a dominios de Clip (aunque la respuesta venga manipulada)
const CTRL = /[\x00-\x1f\x7f]/;
function httpError(status, msg) { const err = new Error(msg); err.pbminiStatus = status; return err; }
class ClipError extends Error { constructor(message, status, code) { super(message); this.name = "ClipError"; this.status = status; this.code = code || null; } }
const HINTS = { 401: "credenciales de Clip incorrectas", 403: "Clip bloquea solicitudes fuera de México y EE. UU.", 412: "límite de peticiones de Clip" };
function describe(status, body) { // `message` o `code_message` según el endpoint; recortado y sin controles (nunca el cuerpo crudo)
  const detail = String((body && (body.message || body.code_message)) || "").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120);
  return `Clip respondió ${status}${HINTS[status] ? " (" + HINTS[status] + ")" : ""}${detail ? ": " + detail : ""}`;
}
function call(method, path, body, extra) {
  const e = env();
  let res;
  try {
    res = $http.send({ url: e.api + path, method, headers: Object.assign({ authorization: e.token, "content-type": "application/json", accept: "application/json" }, extra || {}), body: body ? JSON.stringify(body) : "", timeout: cfg().timeoutSeconds });
  } catch (err) { throw new ClipError("no se pudo conectar con Clip: " + redact(err).slice(0, 120), 0); }
  const j = res.json && typeof res.json === "object" && !Array.isArray(res.json) ? res.json : null;
  if (res.statusCode < 200 || res.statusCode >= 300) throw new ClipError(describe(res.statusCode, j), res.statusCode, j && (j.code || j.error_code) ? String(j.code || j.error_code).slice(0, 16) : null);
  if (!j) throw new ClipError("Clip devolvió una respuesta inválida", null);
  return j;
}
function linkOk(url, local) { return typeof url === "string" && url.length <= 500 && !/[\s\x00-\x1f\x7f\\]/.test(url) && (LINK_HOSTS.test(url) || (local && /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\//.test(url))); }
function createCheckout(a) { // { amountCents, description, reference, urls{success,error,default}, webhookUrl } -> { id, url, qrUrl, expiresAt }
  const c = cfg(), local = env().api !== "https://api.payclip.com";
  const options = { payment_method_types: c.methods };
  if (c.international) options.international_enabled = true;
  if (c.installmentsMsi) options.installments_msi = c.installmentsMsi;
  const payload = { amount: fromCents(a.amountCents), currency: "MXN", purchase_description: a.description, redirection_url: { success: a.urls.success, error: a.urls.error, default: a.urls.default },
    metadata: { external_reference: a.reference }, webhook_url: a.webhookUrl, custom_payment_options: options };
  if (c.expiresInMinutes) payload.expires_at = new Date(Date.now() + c.expiresInMinutes * 60000).toISOString();
  const body = call("POST", "/v2/checkout", payload);
  if (!isClipId(body.payment_request_id)) throw new ClipError("Clip no devolvió un id de solicitud válido", null);
  if (!linkOk(body.payment_request_url, local)) throw new ClipError("Clip devolvió un link de pago no válido", null);
  const card = c.openOnCardForm && c.methods.every((m) => m === "credit" || m === "debit");
  const t = Date.parse(body.expires_at);
  return { id: String(body.payment_request_id), url: card ? body.payment_request_url.replace(/\/+$/, "") + "/card" : body.payment_request_url,
    qrUrl: linkOk(body.qr_image_url, local) ? body.qr_image_url : "", expiresAt: isFinite(t) ? new Date(t).toISOString().replace("T", " ") : "" };
}
function getCheckout(id) { // { id, status (mapeado), rawStatus, amountCents, currency, reference, receiptNo }
  if (!isClipId(id)) throw new ClipError("id de solicitud de pago inválido", null);
  const body = call("GET", "/v2/checkout/" + encodeURIComponent(id));
  return { id, status: mapStatus(body.status), rawStatus: typeof body.status === "string" ? body.status : "", amountCents: toCents(body.amount), currency: typeof body.currency === "string" ? body.currency : "",
    reference: body.metadata && typeof body.metadata.external_reference === "string" ? body.metadata.external_reference : "", receiptNo: body.receipt_no ? String(body.receipt_no) : "" };
}

// ================================================================ CREAR PAGOS ==========================================================================================
const KIND_RE = /^[a-z][a-z0-9_]{0,31}$/, SID_RE = /^[A-Za-z0-9_-]{1,64}$/, IDEM_RE = /^[A-Za-z0-9_.:-]{1,64}$/, PATH_RE = /^\/(?!\/)[^\s\\\x00-\x1f\x7f]{0,299}$/;
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keysOnly = (o, allowed, where) => { Object.keys(o).forEach((k) => { if (allowed.indexOf(k) < 0) throw httpError(400, `invalid payment: unknown option "${k}" in ${where}`); }); };
function validateOpts(o) { // todo fail-closed: monto entero en centavos del SERVIDOR, descripción sin controles, sujeto y URLs RELATIVAS (nunca un destino libre)
  const c = cfg(), bad = (f) => httpError(400, "invalid payment: " + f);
  if (!isPlain(o)) throw bad("options must be an object");
  keysOnly(o, ["amount", "description", "subject", "urls", "idemKey"], "options");
  if (typeof o.amount !== "number" || !Number.isInteger(o.amount) || o.amount < c.amount.min || o.amount > c.amount.max) throw bad("amount (integer cents within the configured range)");
  if (typeof o.description !== "string") throw bad("description");
  const description = o.description.trim();
  if (description.length < 1 || description.length > c.descriptionMax || CTRL.test(description)) throw bad("description (1.." + c.descriptionMax + " characters, no control characters)");
  if (!isPlain(o.subject)) throw bad("subject");
  keysOnly(o.subject, ["kind", "id"], "subject");
  if (typeof o.subject.kind !== "string" || !KIND_RE.test(o.subject.kind)) throw bad("subject.kind");
  if (typeof o.subject.id !== "string" || !SID_RE.test(o.subject.id)) throw bad("subject.id");
  if (!isPlain(o.urls)) throw bad("urls");
  keysOnly(o.urls, ["success", "error", "default"], "urls");
  ["success", "error", "default"].forEach((k) => { if (typeof o.urls[k] !== "string" || !PATH_RE.test(o.urls[k])) throw bad(`urls.${k} (relative path starting with a single /)`); });
  if (o.idemKey !== undefined && (typeof o.idemKey !== "string" || !IDEM_RE.test(o.idemKey))) throw bad("idemKey");
  return { amount: o.amount, description, subject: { kind: o.subject.kind, id: o.subject.id }, urls: { success: o.urls.success, error: o.urls.error, default: o.urls.default }, idemKey: o.idemKey || "" };
}
function bump(key, limit, windowMs) { // contador por ventana en el almacén compartido; solo cuentan los intentos PERMITIDOS (un bloqueo no extiende la espera)
  const store = $app.store(), k = "pbmini:clip:" + key + ":" + Math.floor(Date.now() / windowMs), n = (Number(store.get(k)) || 0) + 1;
  if (n > limit) return false;
  store.set(k, String(n)); return true;
}
const dt = (ms) => new Date(ms).toISOString().replace("T", " ");
function view(r) { return { id: r.id, reference: r.getString("reference"), url: r.getString("url"), status: r.getString("status"), amount: r.getInt("amount"), currency: r.getString("currency") }; }
function markFailed(app, rec, note) { // el intento no llegó a existir en Clip: queda `failed` con la causa (sin secretos) y sin pendientes colgados
  try { rec.set("status", "failed"); rec.set("note", String(note).replace(CTRL, " ").slice(0, 255)); rec.set("closed_at", dt(Date.now())); app.save(rec); } catch (err) { app.logger().error("pbmini clip: no se pudo marcar el pago como fallido", "id", rec.id, "error", redact(err)); }
}
function checkRoute(route, what) {
  if (!cfg().enabled) throw new Error(`pbmini: ${what} requiere clip.enabled en pbmini.config.js`);
  if (route.method === "GET") throw new Error(`pbmini: ${what} no se permite en GET (podría dispararse con un enlace)`);
  if (route.auth === "public") throw new Error(`pbmini: ${what} no se permite en rutas públicas (auth: "user")`);
}
const blocked = (rec) => { try { return require(`${__hooks}/lib/access.js`).isBlocked(rec); } catch (_) { return false; } };

// ctx.clip.createPayment(opts) -> { id, reference, url, status, amount, currency }. Requiere sesión de la colección de usuarios; el monto lo decide SIEMPRE el servidor (centavos enteros).
function createPayment(e, route, opts) {
  checkRoute(route, "ctx.clip.createPayment");
  const c = cfg(), en = env();
  if (!e.auth || e.hasSuperuserAuth() || e.auth.collection().name !== c.collection) throw httpError(401, "unauthorized");
  if (blocked(e.auth)) throw httpError(403, "forbidden");
  const o = validateOpts(opts), uid = e.auth.id;
  if (o.idemKey) { const ex = byIdem(uid, o.idemKey); if (ex) return waitSettled(ex); } // misma llave => el MISMO pago (un reintento no gasta cupo)
  if (!bump("new:" + uid, c.create.perUserPerMin, 60000)) { // con peticiones simultáneas de la misma llave, la ganadora ya está creando el pago: se devuelve ese
    const ex = o.idemKey ? waitIdem(uid, o.idemKey, 600) : null;
    if (ex) return waitSettled(ex);
    throw httpError(429, "too many payment requests");
  }
  if ($app.countRecords(COLL, $dbx.exp("user = {:u} AND (status = 'created' OR status = 'pending')", { u: uid })) >= c.create.maxPendingPerUser) throw httpError(429, "too many pending payments");
  const id = $security.randomStringWithAlphabet(15, ALPHABET), reference = makeReference(c.referencePrefix, en.token, id), rec = new Record($app.findCollectionByNameOrId(COLL));
  rec.set("id", id); rec.set("reference", reference); rec.set("user", uid); rec.set("subject_kind", o.subject.kind); rec.set("subject_id", o.subject.id); rec.set("amount", o.amount); rec.set("currency", "MXN");
  rec.set("description", o.description); rec.set("status", "created"); if (o.idemKey) rec.set("idem_key", o.idemKey);
  try { $app.save(rec); } catch (err) { // carrera por la misma idemKey: ganó otra petición (índice único (user, idem_key))
    const ex = o.idemKey ? byIdem(uid, o.idemKey) : null;
    if (ex) return waitSettled(ex);
    throw err;
  }
  // la referencia ya está guardada ANTES de llamar a Clip: si el webhook llega muy rápido, ya existe
  const webhook = `${en.pub}${c.webhook.path}?token=${encodeURIComponent(en.hook)}`;
  let made;
  try { made = createCheckout({ amountCents: o.amount, description: o.description, reference, urls: { success: en.pub + o.urls.success, error: en.pub + o.urls.error, default: en.pub + o.urls.default }, webhookUrl: webhook }); }
  catch (err) {
    markFailed($app, rec, err instanceof ClipError ? err.message : "error inesperado al crear el link");
    $app.logger().error("pbmini clip: Clip no creó el link", "id", id, "error", redact(err));
    throw httpError(502, "payment provider error");
  }
  rec.set("clip_id", made.id); rec.set("url", made.url); rec.set("qr_url", made.qrUrl); rec.set("status", "pending"); if (made.expiresAt) rec.set("expires_at", made.expiresAt);
  try { $app.save(rec); } catch (err) { // el link existe en Clip pero no se pudo guardar: se anota para el operador (el conciliador no lo verá: sin clip_id)
    markFailed($app, rec, "link creado en Clip pero no guardado: " + made.id);
    $app.logger().error("pbmini clip: no se pudo guardar el link creado", "id", id, "error", redact(err));
    throw httpError(500, "internal error");
  }
  return view(rec);
}
function waitIdem(uid, key, ms) { const end = Date.now() + ms; let r = byIdem(uid, key); while (!r && Date.now() < end) { sleep(50); r = byIdem(uid, key); } return r; }
function byIdem(uid, key) { try { return $app.findFirstRecordByFilter(COLL, "user = {:u} && idem_key = {:k}", { u: uid, k: key }); } catch (_) { return null; } }
function waitSettled(rec) { // si otra petición la está creando todavía (`created` sin link), se espera a que termine o falle
  const end = Date.now() + cfg().timeoutSeconds * 1000 + 1000;
  let r = rec;
  while (r.getString("status") === "created" && Date.now() < end) { sleep(150); try { r = $app.findRecordById(COLL, rec.id); } catch (_) { break; } }
  return view(r);
}

// ================================================================ VERIFICAR: el ÚNICO camino a `paid` ===================================================================
// El webhook, la URL de retorno, el usuario y el conciliador solo DISPARAN esta verificación; nunca prueban nada. Se pregunta a Clip y `decide()` compara con lo NUESTRO.
const isUnique = (err) => /unique/i.test(String(err));
const FINAL = ["paid", "refunded", "review"]; // no se vuelven a consultar (review espera al operador; así una anomalía no repite la alarma en cada cron)
const payload = (r) => ({ id: r.id, reference: r.getString("reference"), amount: r.getInt("amount") });
const receiptTaken = (app, id, receipt) => { try { app.findFirstRecordByFilter(COLL, "receipt_no = {:r} && id != {:i}", { r: receipt, i: id }); return true; } catch (_) { return false; } };

// Cambia el estado de forma atómica e idempotente: dentro de una transacción se relee y solo se cambia si el estado ACTUAL permite la transición (fromStates).
// Se guarda con la API de registros (no con SQL crudo) para que los hooks nativos `onRecordAfterUpdateSuccess("pbmini_clip_payments")` se disparen UNA vez.
function transition(app, id, to, apply, opt) { // -> { changed, status, record }; opt.operator: transiciones que solo mueve un operador (revisión, reembolso)
  const from = opt && opt.from ? opt.from : opt && opt.operator ? Object.keys(TRANSITIONS).filter((f) => TRANSITIONS[f].indexOf(to) >= 0) : fromStates(to);
  let changed = false, result = null;
  try {
    app.runInTransaction((tx) => {
      const fresh = tx.findRecordById(COLL, id); result = fresh;
      const prev = fresh.getString("status");
      if (from.indexOf(prev) < 0) return;
      fresh.set("status", to); apply(fresh, prev); tx.save(fresh); changed = true;
    });
  } catch (err) {
    let again = null; try { again = app.findRecordById(COLL, id); } catch (_) {}
    if (again && again.getString("status") === to && !isUnique(err)) return { changed: false, status: to, record: again }; // otra transacción ganó la carrera
    throw err;
  }
  const rec = changed ? app.findRecordById(COLL, id) : result;
  return { changed, status: rec.getString("status"), record: rec };
}
function onReview(app, rec) { // anomalía nueva: log UNA vez y alerta a los operadores si hay un canal (nunca rompe nada)
  app.logger().error("pbmini clip: pago en revisión", "id", rec.id, "reference", rec.getString("reference"), "note", rec.getString("note"));
  try { const n = require(`${__hooks}/lib/notify.js`); if (n.channels().length) n.send(app, { ops: true }, { title: "Pago en revisión", text: `${rec.getString("reference")}: ${rec.getString("note")}`, key: "clip-review-" + rec.id }); } catch (err) { app.logger().error("pbmini clip: no se pudo avisar a los operadores", "error", redact(err)); }
}
function applyDecision(app, rec, d) {
  const now = dt(Date.now()), cur = rec.getString("status");
  if (d.to === "pending") return { status: cur, changed: false };
  let r;
  try {
    if (d.to === "failed" || d.to === "expired") r = transition(app, rec.id, d.to, (x) => { x.set("closed_at", now); });
    else if (d.to === "paid") r = transition(app, rec.id, "paid", (x, prev) => { x.set("receipt_no", d.receiptNo); x.set("paid_at", now); x.set("closed_at", now); x.set("note", prev === "failed" || prev === "expired" ? "pago tardío: confirmado después de quedar " + prev : ""); });
    else r = transition(app, rec.id, "review", (x) => { x.set("note", d.note || "revisión manual"); }); // una anomalía NO es un cierre: espera al operador
  } catch (err) {
    if (d.to === "paid" && isUnique(err)) { // carrera por el recibo: otro pago lo registró primero => anomalía, no excepción
      r = transition(app, rec.id, "review", (x) => { x.set("note", "recibo ya usado por otro pago"); });
      d = { to: "review" };
    } else throw err;
  }
  if (r.changed && d.to === "review") onReview(app, r.record);
  return { status: r.status, changed: r.changed };
}
function throttle(id, wait) { // 1 consulta cada verify.minIntervalMs por pago; solo cuentan las consultas que SÍ se hacen (un sondeo constante no extiende la espera)
  const store = $app.store(), k = "pbmini:clip:chk:" + id, last = Number(store.get(k)) || 0, gap = cfg().verify.minIntervalMs, left = gap - (Date.now() - last);
  if (left > 0) { if (!wait) return false; sleep(left); }
  store.set(k, String(Date.now())); return true;
}
function verify(app, rec, opt) { // -> { status, changed, skipped?, error? }
  const o = opt || {}, c = cfg(), status = rec.getString("status");
  if (FINAL.indexOf(status) >= 0) return { status, changed: false, skipped: "final" };
  const cid = rec.getString("clip_id");
  if (!isClipId(cid)) return { status, changed: false, skipped: "no_link" };
  if (!throttle(rec.id, !!o.wait)) return { status, changed: false, skipped: "throttled" };
  let remote;
  try { remote = getCheckout(cid); }
  catch (err) { app.logger().warn("pbmini clip: no se pudo consultar a Clip (se reintenta)", "id", rec.id, "error", redact(err)); return { status, changed: false, error: true }; }
  const d = decide(payload(rec), remote, { prefix: c.referencePrefix, key: env().token, receiptUsedByOther: (r) => receiptTaken(app, rec.id, r) });
  return applyDecision(app, rec, d);
}

// ================================================================ API PARA RUTAS: ctx.clip.verify / get / list =============================================================
const ID15 = /^[a-z0-9]{15}$/;
function pubView(r) { // lo que ve el dueño: sin `note`, `clip_id` ni datos internos; el link de pago solo mientras se puede pagar
  const st = r.getString("status");
  return { id: r.id, reference: r.getString("reference"), status: st, amount: r.getInt("amount"), currency: r.getString("currency"), description: r.getString("description"), subject: { kind: r.getString("subject_kind"), id: r.getString("subject_id") },
    url: st === "pending" ? r.getString("url") : "", receiptNo: r.getString("receipt_no"), paidAt: r.getString("paid_at"), expiresAt: r.getString("expires_at"), created: r.getString("created") };
}
function actor(e, route, what) { // usuario de la colección (o superusuario); no en rutas públicas; las cuentas bloqueadas no consultan
  if (!cfg().enabled) throw new Error(`pbmini: ${what} requiere clip.enabled en pbmini.config.js`);
  if (route.auth === "public") throw new Error(`pbmini: ${what} no se permite en rutas públicas (auth: "user")`);
  if (!e.auth) throw httpError(401, "unauthorized");
  if (e.hasSuperuserAuth()) return { su: true, uid: "" };
  if (e.auth.collection().name !== cfg().collection) throw httpError(401, "unauthorized");
  if (blocked(e.auth)) throw httpError(403, "forbidden");
  return { su: false, uid: e.auth.id };
}
function owned(a, id) { // pago propio o 404 (no se revela si existe)
  if (typeof id !== "string" || !ID15.test(id)) throw httpError(404, "not found");
  let r; try { r = $app.findRecordById(COLL, id); } catch (_) { throw httpError(404, "not found"); }
  if (!a.su && r.getString("user") !== a.uid) throw httpError(404, "not found");
  return r;
}
function ctxGet(e, route, id) { return pubView(owned(actor(e, route, "ctx.clip.get"), id)); }
function ctxVerify(e, route, id) { // pregunta a Clip (con intervalo mínimo y límite por usuario); se puede usar desde rutas GET: es una consulta
  const a = actor(e, route, "ctx.clip.verify"), r = owned(a, id);
  if (!a.su && !bump("ver:" + a.uid, cfg().verify.perUserPerMin, 60000)) throw httpError(429, "too many verification requests");
  verify($app, r, {});
  return pubView($app.findRecordById(COLL, r.id));
}
function ctxList(e, route, q) {
  const a = actor(e, route, "ctx.clip.list");
  if (!isPlain(q)) throw httpError(400, "invalid query");
  keysOnly(q, ["subjectKind", "subjectId"], "query");
  if (typeof q.subjectKind !== "string" || !KIND_RE.test(q.subjectKind) || typeof q.subjectId !== "string" || !SID_RE.test(q.subjectId)) throw httpError(400, "invalid query: subjectKind / subjectId");
  const filter = "subject_kind = {:k} && subject_id = {:s}" + (a.su ? "" : " && user = {:u}");
  return $app.findRecordsByFilter(COLL, filter, "-created", 50, 0, { k: q.subjectKind, s: q.subjectId, u: a.uid }).map(pubView);
}

// ================================================================ WEBHOOK Y CONCILIADOR ====================================================================================
// POST {webhook.path}?token=...   { id, origin, event_type }: Clip no firma el aviso, así que SOLO se usa `id` (UUID) para saber qué consultar. Responde 200 {"ok":true} sea cual sea el resultado.
function webhook(e) {
  const hd = e.response.header();
  hd.set("Cache-Control", "no-store"); hd.set("X-Content-Type-Options", "nosniff");
  const c = cfg(), en = env();
  let ip = ""; try { ip = String(e.realIP() || ""); } catch (_) {}
  if (!bump("wh:" + ip, c.webhook.perIpPerMin, 60000)) return e.json(429, { error: "too many requests" }); // antes del token: adivinarlo no sale gratis
  const given = String(e.request.url.query().get("token") || "");
  const a = $security.equal(given, en.hook), b = en.prev ? $security.equal(given, en.prev) : false;
  if (!(a || b)) return e.json(403, { error: "forbidden" });
  let body;
  try { body = JSON.parse(toString(e.request.body)); } catch (_) { return e.json(400, { error: "invalid body" }); }
  if (!isPlain(body) || typeof body.id !== "string" || !isClipId(body.id)) return e.json(400, { error: "invalid body" }); // las claves extra se ignoran: jamás se usan
  let rec = null; try { rec = $app.findFirstRecordByFilter(COLL, "clip_id = {:c}", { c: body.id.toLowerCase() }); } catch (_) {}
  if (rec) { // un id desconocido no provoca NINGUNA llamada a Clip
    try { verify($app, rec, { wait: true }); } catch (err) { $app.logger().error("pbmini clip: el webhook no pudo verificar (lo recupera el conciliador)", "id", rec.id, "error", redact(err)); }
  }
  return e.json(200, { ok: true });
}
function routes() { routerAdd("POST", cfg().webhook.path, (e) => require(`${__hooks}/lib/clip.js`).webhook(e), $apis.bodyLimit(cfg().webhook.maxBytes)); }

// Respaldo del webhook (Clip no documenta reintentos): verifica los pagos `pending` de la ventana, cierra los `created` colgados y vence los muy viejos. Reentrante (un candado evita ejecuciones solapadas).
function reconcile(app) {
  const c = cfg(), r = c.reconcile, res = { checked: 0, paid: 0, failed: 0, expired: 0, review: 0, pending: 0, skipped: 0, errors: 0, stale: 0, old: 0 };
  if (!c.enabled) return res;
  const store = app.store(), LK = "pbmini:clip:rc:lock", t0 = Date.now();
  if (Number(store.get(LK)) > t0 - 300000) return Object.assign(res, { running: true });
  store.set(LK, String(t0));
  try {
    const stale = dt(t0 - r.staleCreatedMinutes * 60000), oldest = dt(t0 - r.windowHours * 3600000), newest = dt(t0 - r.minAgeMinutes * 60000);
    const find = (filter, sort, params) => { try { return app.findRecordsByFilter(COLL, filter, sort, r.batch, 0, params); } catch (_) { return []; } };
    find("status = 'created' && created < {:t}", "created", { t: stale }).forEach((x) => { // la creación no terminó (el proceso cayó): no existe link
      try { const t = transition(app, x.id, "failed", (y) => { y.set("note", "la creación del link no se completó"); y.set("closed_at", dt(Date.now())); }); if (t.changed) res.stale++; } catch (err) { res.errors++; }
    });
    find("status = 'pending' && clip_id != '' && created >= {:o} && created <= {:n}", "-created", { o: oldest, n: newest }).forEach((x) => {
      res.checked++;
      try { const v = verify(app, x, {}); if (v.skipped) res.skipped++; else if (v.error) res.errors++; else if (v.changed || v.status !== "pending") res[v.status] = (res[v.status] || 0) + 1; else res.pending++; }
      catch (err) { res.errors++; app.logger().error("pbmini clip: el conciliador falló con un pago", "id", x.id, "error", redact(err)); } // un error no detiene a los demás
    });
    find("status = 'pending' && created < {:o}", "created", { o: oldest }).forEach((x) => { // fuera de la ventana: ya no se consulta (un pago tardío aún se registra si llega su webhook)
      try { const t = transition(app, x.id, "expired", (y) => { y.set("note", "ventana de conciliación agotada"); y.set("closed_at", dt(Date.now())); }); if (t.changed) res.old++; } catch (err) { res.errors++; }
    });
  } finally { store.remove(LK); }
  return res;
}

// ================================================================ REEMBOLSOS, ENTREGA, RETENCIÓN Y OPERADOR ==============================================================
// Reembolso TOTAL por API (POST /refunds por recibo; Clip recuerda la idempotency-key 1 minuto). Los parciales no se ofrecen: la documentación de Clip se contradice. Solo lo mueve un operador (CLI/superusuario).
// Pendiente de validar con dinero real: que reference.type = "receipt" acepte el receipt_no del checkout.
const REFUND_ERRORS = {
  AI1400: "No hay saldo suficiente en Clip para reembolsar (se descuenta de las ventas del día aún no depositadas)", AI1800: "Clip no considera aprobado este pago", AI1801: "El monto es mayor al del pago original",
  AI1802: "El monto más reembolsos anteriores supera el pago original (¿ya se reembolsó?)", AI1803: "Pasaron más de 180 días: Clip ya no permite reembolsarlo", AI1804: "El pago está en disputa: Clip no permite reembolsarlo",
  AI1805: "Los reembolsos están deshabilitados en tu cuenta de Clip", AI1806: "Clip no permite reembolsar pagos a meses (MSI/MCI)", AI1807: "Ya hay un reembolso en proceso para este pago; intenta de nuevo en un momento",
  AI1300: "Clip no encontró la transacción (¿el recibo no es válido como referencia? prueba con el id de transacción del panel)", CL301: "Clip no encontró el pago", AI4040: "Clip no encontró ese reembolso",
  CL2200: "Faltan datos obligatorios en la solicitud de reembolso", CL1500: "Clip no autoriza la solicitud (credenciales o permisos)", AI1899: "Error interno de Clip: reintenta más tarde",
};
const REFUND_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
function createRefund(a) { // { receiptNo, amountCents, reason, idempotencyKey } -> { id, status: approved|declined|unknown, message, receiptNo }
  if (!a.receiptNo) throw new ClipError("el pago no tiene recibo de Clip: no se puede reembolsar", null);
  const body = call("POST", "/refunds", { reference: { type: "receipt", id: String(a.receiptNo) }, amount: fromCents(a.amountCents), reason: String(a.reason || "Reembolso").replace(CTRL, " ").slice(0, 200) }, { "idempotency-key": String(a.idempotencyKey || "").slice(0, 64) });
  const st = typeof body.status === "string" ? body.status.toLowerCase() : "";
  return { id: typeof body.id === "string" && REFUND_ID_RE.test(body.id) ? body.id : "", status: st === "approved" || st === "declined" ? st : "unknown", message: String(body.status_message || "").replace(CTRL, " ").slice(0, 200),
    receiptNo: body.receipt_no && REFUND_ID_RE.test(String(body.receipt_no)) ? String(body.receipt_no) : "" };
}
const refundMsg = (err) => (err && err.code && REFUND_ERRORS[err.code]) || (err && err.message) || "error de Clip";
const claimAge = (v) => { const m = /^rq:([0-9]{10,14}):/.exec(String(v)); return m ? Date.now() - Number(m[1]) : null; };
function find(app, id) { if (typeof id !== "string" || !ID15.test(id)) throw httpError(404, "not found"); try { return app.findRecordById(COLL, id); } catch (_) { throw httpError(404, "not found"); } }
const sql = (app, q, p) => app.db().newQuery(q).bind(p).execute().rowsAffected();
const OPNOTE = (by, what) => clip255(`${what} por ${String(by || "operador").replace(CTRL, " ").slice(0, 40)}`);

// Reembolsa un pago `paid` pidiéndoselo PRIMERO a Clip; solo si lo aprueba pasa a `refunded`. No se reembolsa dos veces: un candado atómico (refund_id) + la idempotency-key + el propio Clip (AI1802).
function refund(app, id, by) {
  const c = cfg(); if (!c.enabled) throw new Error("pbmini: el reembolso requiere clip.enabled en pbmini.config.js");
  let rec = find(app, id), st = rec.getString("status");
  if (st === "refunded") return { status: "refunded", changed: false };
  if (st !== "paid") throw httpError(409, "only paid payments can be refunded");
  const receipt = rec.getString("receipt_no");
  if (!receipt) throw httpError(409, "the payment has no Clip receipt: refund it in the Clip panel and register it with refunded");
  const prev = rec.getString("refund_id"), age = claimAge(prev);
  if (prev && age === null) throw httpError(409, "a refund is already registered for this payment");
  if (prev && age < 120000) throw httpError(409, "a refund is already in progress");
  const claim = "rq:" + Date.now() + ":" + $security.randomStringWithAlphabet(12, ALPHABET);
  if (sql(app, `UPDATE ${COLL} SET refund_id = {:k} WHERE id = {:i} AND status = 'paid' AND refund_id = {:p}`, { k: claim, i: id, p: prev }) !== 1) throw httpError(409, "a refund is already in progress");
  const release = () => { try { sql(app, `UPDATE ${COLL} SET refund_id = '' WHERE id = {:i} AND refund_id = {:k}`, { i: id, k: claim }); } catch (_) {} };
  let r;
  try { r = createRefund({ receiptNo: receipt, amountCents: rec.getInt("amount"), reason: "Reembolso " + rec.getString("reference"), idempotencyKey: "refund-" + id }); }
  catch (err) { release(); app.logger().error("pbmini clip: Clip rechazó el reembolso", "id", id, "error", redact(err)); throw httpError(err && err.status >= 400 && err.status < 500 ? 409 : 502, refundMsg(err)); }
  if (r.status !== "approved") { release(); app.logger().error("pbmini clip: reembolso no aprobado", "id", id, "status", r.status); throw httpError(409, r.status === "declined" ? "Clip rechazó el reembolso: " + (r.message || "sin motivo") : "Clip no confirmó el reembolso (estado desconocido): revísalo en el panel de Clip"); }
  const rid = r.id || "manual-" + id, now = dt(Date.now());
  const t = transition(app, id, "refunded", (x, p) => { x.set("refund_id", rid); x.set("refund_receipt_no", r.receiptNo); x.set("refunded_at", now); if (!x.getString("closed_at")) x.set("closed_at", now); x.set("note", OPNOTE(by, "reembolsado en Clip")); }, { operator: true, from: ["paid"] });
  return { status: t.status, changed: t.changed };
}
function markRefunded(app, id, by) { // el reembolso se hizo a mano en el panel de Clip: solo se registra (no llama a Clip)
  const c = cfg(); if (!c.enabled) throw new Error("pbmini: markRefunded requiere clip.enabled en pbmini.config.js");
  const rec = find(app, id);
  if (rec.getString("status") === "refunded") return { status: "refunded", changed: false };
  if (rec.getString("status") !== "paid") throw httpError(409, "only paid payments can be marked as refunded");
  const now = dt(Date.now());
  const t = transition(app, id, "refunded", (x) => { x.set("refund_id", "manual-" + id); x.set("refunded_at", now); if (!x.getString("closed_at")) x.set("closed_at", now); x.set("note", OPNOTE(by, "reembolso hecho a mano en Clip, registrado")); }, { operator: true, from: ["paid"] });
  return { status: t.status, changed: t.changed };
}
// Resuelve una anomalía (`review`) a mano: pagado (con el recibo si se conoce) o fallido. Solo desde review.
function reviewResolve(app, id, to, by, receipt) {
  const c = cfg(); if (!c.enabled) throw new Error("pbmini: la revisión requiere clip.enabled en pbmini.config.js");
  if (to !== "paid" && to !== "failed") throw httpError(400, "to must be paid or failed");
  const rec = find(app, id);
  if (rec.getString("status") !== "review") throw httpError(409, "only payments in review can be resolved");
  if (to === "failed" && receipt) throw httpError(400, "a receipt only applies when resolving as paid");
  if (receipt !== undefined && receipt !== "" && (typeof receipt !== "string" || !RECEIPT_RE.test(receipt))) throw httpError(400, "invalid receipt");
  if (receipt && receiptTaken(app, id, receipt)) throw httpError(409, "that receipt already credits another payment");
  const now = dt(Date.now());
  const t = transition(app, id, to, (x) => { x.set("closed_at", now); if (to === "paid") { x.set("paid_at", now); if (receipt) x.set("receipt_no", receipt); } x.set("note", OPNOTE(by, to === "paid" ? "anomalía resuelta como pagada" : "anomalía resuelta como fallida")); }, { operator: true, from: ["review"] });
  return { status: t.status, changed: t.changed };
}
// Marca la entrega del servicio. claimActivation: true SOLO para quien la reclama (como máximo una vez; si el proceso cae entre reclamar y entregar, se pierde).
// La alternativa recomendada es entregar de forma IDEMPOTENTE (llave = id del pago) y llamar markActivated al terminar (al menos una vez).
function claimActivation(app, id) { return typeof id === "string" && ID15.test(id) && sql(app, `UPDATE ${COLL} SET activated_at = {:n} WHERE id = {:i} AND status = 'paid' AND activated_at = ''`, { n: dt(Date.now()), i: id }) === 1; }
function markActivated(app, id) { return typeof id === "string" && ID15.test(id) && sql(app, `UPDATE ${COLL} SET activated_at = {:n} WHERE id = {:i} AND status IN ('paid', 'refunded') AND activated_at = ''`, { n: dt(Date.now()), i: id }) === 1; }

// Retención por fechas controlables (`closed_at`, nunca `created`): failed/expired tras failedDays; paid/refunded solo si paidDays > 0; NUNCA review, pending ni created.
function purge(app, opt) {
  const c = cfg(), res = { failed: 0, expired: 0, paid: 0, refunded: 0, dryRun: !!(opt && opt.dryRun) };
  if (!c.enabled) return res;
  const run = (status, days) => {
    if (!days) return;
    let rows = []; try { rows = app.findRecordsByFilter(COLL, "status = {:s} && closed_at != '' && closed_at < {:d}", "", 5000, 0, { s: status, d: dt(Date.now() - days * 86400000) }); } catch (_) {}
    rows.forEach((r) => { if (!res.dryRun) { try { app.delete(r); } catch (err) { app.logger().error("pbmini clip: no se pudo purgar un pago", "id", r.id, "error", redact(err)); return; } } res[status]++; });
  };
  run("failed", c.retention.failedDays); run("expired", c.retention.failedDays); run("paid", c.retention.paidDays); run("refunded", c.retention.paidDays);
  return res;
}
// Al borrar un usuario se anonimiza: se pierde el vínculo y los textos libres; se CONSERVAN los campos contables (monto, moneda, estado, recibo, fechas).
function onUserDeleted(e) {
  const app = $app, uid = e.record.id;
  for (let i = 0; i < 20; i++) {
    let rows = []; try { rows = app.findRecordsByFilter(COLL, "user = {:u}", "", 500, 0, { u: uid }); } catch (_) {}
    if (!rows.length) break;
    rows.forEach((r) => { try { r.set("user", ""); r.set("description", ""); r.set("subject_id", ""); app.save(r); } catch (err) { app.logger().error("pbmini clip: no se pudo anonimizar un pago", "id", r.id, "error", redact(err)); } });
  }
}
// ctx.clip.refund(id): solo superusuarios, no desde GET (mueve dinero).
function ctxRefund(e, route, id) {
  if (!cfg().enabled) throw new Error("pbmini: ctx.clip.refund requiere clip.enabled en pbmini.config.js");
  if (route.method === "GET") throw new Error("pbmini: ctx.clip.refund no se permite en GET (movería dinero con un enlace)");
  if (route.auth !== "superuser" || !e.auth || !e.hasSuperuserAuth()) throw httpError(401, "unauthorized");
  const out = refund($app, id, "superusuario");
  return Object.assign({}, out, { payment: pubView($app.findRecordById(COLL, id)) });
}

module.exports = { refund, markRefunded, reviewResolve, claimActivation, markActivated, purge, onUserDeleted, ctxRefund, createRefund, ctxGet, ctxVerify, ctxList, verify, reconcile, webhook, routes, transition, createPayment, createCheckout, getCheckout, validateOpts, ClipError, env, validate, ensure, validateSchema, redact, COLL, isClipId, mapStatus, toCents, fromCents, makeReference, parseReference, signature, TRANSITIONS, canTransition, needsOperator, fromStates, decide, MAX_CENTS };
