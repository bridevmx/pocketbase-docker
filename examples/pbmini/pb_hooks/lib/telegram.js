// Módulo opcional de Telegram (apagado por defecto; ver pbmini.config.js). Alertas a usuarios, grupos y operadores, vinculación por enlace,
// botones inline con acciones declaradas y login por Mini App. Todo entra y sale por la Bot API oficial (https://core.telegram.org/bots/api).
//  - Secretos SOLO en variables de entorno: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (+ opcionales). El token se redacta de cualquier error/log y nunca se guarda en la base.
//  - El destinatario sale del registro vinculado (nunca de la petición); el texto va escapado (HTML) y los botones solo apuntan a acciones declaradas en pb_hooks/telegram/actions/.
//  - Todo envío pasa por la cola `pbmini_tg_outbox` (idempotente por `key`): los fallos transitorios se reintentan con espera creciente (429 respeta retry_after),
//    un cron la drena con ritmo (≤25 mensajes/s global, 1/s por chat) y el contenido se borra al enviar (datos personales).
//  - El webhook se autentica con el secret_token que Telegram devuelve en la cabecera X-Telegram-Bot-Api-Secret-Token (comparación en tiempo constante).
//  - Límites: nonces de botones, ids de update y contadores viven en memoria/almacén de UN proceso (PocketBase es un solo nodo).
const cfg = () => require(`${__hooks}/lib/config.js`).load().telegram;
const LINKS = "pbmini_tg_links", CHATS = "pbmini_telegram", OUTBOX = "pbmini_tg_outbox", ACTIONS = "pbmini_tg_actions";
const TOKEN_RE = /^[0-9]{5,20}:[A-Za-z0-9_-]{30,60}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const ID_RE = /^[a-z0-9]{15}$/;
const KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const NAME_RE = /^[a-z0-9][a-z0-9_]{0,31}$/;
const LINK_RE = /^[A-Za-z0-9]{32}$/;
const NONCE_RE = /^[A-Za-z0-9]{24}$/;
const CHAT_RE = /^-?[0-9]{1,16}$/;
const URL_RE = /^https:\/\/[^\s<>"'\\]{4,500}$/;
const MAX_TEXT = 4096, MAX_ATTEMPTS = 8, PACE_MS = 40;
const fail = (m) => { throw new Error("pbmini telegram: " + m); };
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
const dt = (ms) => new Date(ms).toISOString().replace("T", " ");
const msOf = (v) => new Date(String(v).replace(" ", "T")).getTime();
function httpError(status, msg) { const err = new Error(msg); err.pbminiStatus = status; return err; }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- entorno (validado al registrar: fail-closed) ----------------------------------------------------------------------------------------
let _env = null;
function env() {
  if (_env) return _env;
  const get = (n) => String($os.getenv(n) || "");
  const token = get("TELEGRAM_BOT_TOKEN"), secret = get("TELEGRAM_WEBHOOK_SECRET");
  if (!TOKEN_RE.test(token)) fail("TELEGRAM_BOT_TOKEN ausente o con formato inválido (<id>:<texto>)");
  if (!SECRET_RE.test(secret)) fail("TELEGRAM_WEBHOOK_SECRET ausente o inválido (32..256 caracteres [A-Za-z0-9_-])");
  const api = (get("TELEGRAM_API_URL") || "https://api.telegram.org").replace(/\/+$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(api) && !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(api)) fail("TELEGRAM_API_URL debe ser https://host o http://127.0.0.1:puerto");
  const hook = get("TELEGRAM_WEBHOOK_URL").replace(/\/+$/, "");
  if (hook && !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/.test(hook) && !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(hook)) fail("TELEGRAM_WEBHOOK_URL debe ser una URL https base (sin parámetros)");
  const user = get("TELEGRAM_BOT_USERNAME");
  if (user && !USERNAME_RE.test(user)) fail("TELEGRAM_BOT_USERNAME inválido");
  const mini = get("TELEGRAM_MINIAPP_URL");
  if (mini && !URL_RE.test(mini)) fail("TELEGRAM_MINIAPP_URL debe ser una URL https");
  const ops = get("TELEGRAM_OPERATOR_CHATS") ? get("TELEGRAM_OPERATOR_CHATS").split(",").map((x) => x.trim()) : [];
  if (ops.length > 20 || ops.some((x) => !CHAT_RE.test(x)) || new Set(ops).size !== ops.length) fail("TELEGRAM_OPERATOR_CHATS debe ser una lista de hasta 20 ids de chat numéricos separados por comas");
  return (_env = { token, secret, api, hook, user, mini, ops });
}
const redact = (s) => { let t = String(s); try { t = t.split(env().token).join("«token»"); } catch (_) {} return t; };

// ---- cliente de la Bot API ---------------------------------------------------------------------------------------------------------------
// Devuelve {ok, status, json, retryAfter, desc}; nunca lanza (los errores de red se devuelven como status 0, con el token redactado).
function api(method, params) {
  if (!/^[A-Za-z]{1,40}$/.test(method)) fail("método de la Bot API inválido");
  try {
    const e = env();
    const res = $http.send({ url: `${e.api}/bot${e.token}/${method}`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {}), timeout: 10 });
    const j = res.json && typeof res.json === "object" ? res.json : {};
    return { ok: res.statusCode === 200 && j.ok === true, status: res.statusCode, json: j, retryAfter: Number(j.parameters && j.parameters.retry_after) || 0, desc: String(j.description || "").slice(0, 200) };
  } catch (err) { return { ok: false, status: 0, json: {}, retryAfter: 0, desc: redact(err).slice(0, 200) }; }
}

// ---- colecciones internas (solo superusuario) --------------------------------------------------------------------------------------------
function ensure(app) {
  const mk = (name, fields, indexes) => {
    try { app.findCollectionByNameOrId(name); return; } catch (_) { /* no existe: se crea */ }
    app.save(new Collection({ type: "base", name, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields, indexes }));
  };
  mk(CHATS, [
    { name: "rid", type: "text", required: true, max: 30 }, { name: "coll", type: "text", max: 64 }, { name: "tgid", type: "text", required: true, max: 20 }, { name: "chat_id", type: "text", required: true, max: 20 },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "blocked"] }, { name: "last_sent", type: "date" }, { name: "created", type: "autodate", onCreate: true },
  ], [`CREATE UNIQUE INDEX idx_${CHATS}_tgid ON ${CHATS} (tgid)`, `CREATE UNIQUE INDEX idx_${CHATS}_rid ON ${CHATS} (rid)`]);
  mk(LINKS, [
    { name: "hash", type: "text", required: true, max: 64 }, { name: "rid", type: "text", required: true, max: 30 }, { name: "coll", type: "text", max: 64 },
    { name: "expires", type: "date" }, { name: "used", type: "bool" }, { name: "created", type: "autodate", onCreate: true },
  ], [`CREATE UNIQUE INDEX idx_${LINKS}_hash ON ${LINKS} (hash)`, `CREATE INDEX idx_${LINKS}_rid ON ${LINKS} (rid)`]);
  mk(OUTBOX, [
    { name: "rid", type: "text", max: 30 }, { name: "chat_id", type: "text", required: true, max: 20 }, { name: "payload", type: "text", max: 40000 }, { name: "dedupe", type: "text", required: true, max: 120 },
    { name: "state", type: "select", required: true, maxSelect: 1, values: ["pending", "sending", "sent", "dead"] }, { name: "attempts", type: "number" }, { name: "next_try", type: "date" },
    { name: "error", type: "text", max: 300 }, { name: "sent", type: "date" }, { name: "created", type: "autodate", onCreate: true },
  ], [`CREATE UNIQUE INDEX idx_${OUTBOX}_dedupe ON ${OUTBOX} (dedupe)`, `CREATE INDEX idx_${OUTBOX}_state ON ${OUTBOX} (state, next_try)`]);
  mk(ACTIONS, [
    { name: "hash", type: "text", required: true, max: 64 }, { name: "rid", type: "text", required: true, max: 30 }, { name: "action", type: "text", required: true, max: 32 },
    { name: "args", type: "text", max: 600 }, { name: "expires", type: "date" }, { name: "used", type: "bool" }, { name: "created", type: "autodate", onCreate: true },
  ], [`CREATE UNIQUE INDEX idx_${ACTIONS}_hash ON ${ACTIONS} (hash)`]);
}
// Los campos de los grupos deben existir en la colección de usuarios (si no, el grupo quedaría vacío sin avisar).
function validateSchema(app) {
  const c = cfg();
  if (!c.enabled) return;
  const col = app.findCollectionByNameOrId(c.collection);
  if (col.type !== "auth") fail(`la colección "${c.collection}" no es de autenticación`);
  Object.keys(c.groups).forEach((g) => { if (!col.fields.getByName(c.groups[g].field)) fail(`telegram.groups.${g}: la colección "${c.collection}" no tiene el campo "${c.groups[g].field}"`); });
}

// ---- acciones de botones: pb_hooks/telegram/actions/<nombre>.js => module.exports = { run(app, {user, args}) } -----------------------------
let _acts = null;
function actions() {
  if (_acts) return _acts;
  const dir = `${__hooks}/telegram/actions`, out = Object.create(null);
  if (exists(dir)) {
    $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
      if (e.name.charAt(0) === ".") return;
      if (e.dir || e.type !== 0) fail(`telegram/actions/${e.name}: solo archivos .js regulares`);
      const m = /^(.+)\.js$/.exec(e.name);
      if (!m || !NAME_RE.test(m[1])) fail(`telegram/actions/${e.name}: el nombre debe ser <nombre>.js (minúsculas, dígitos y _; máx. 32)`);
      const mod = require(`${dir}/${e.name}`);
      if (!mod || typeof mod !== "object" || typeof mod.run !== "function") fail(`telegram/actions/${e.name} debe exportar { run(app, {user, args}) }`);
      Object.keys(mod).forEach((k) => { if (k !== "run") fail(`telegram/actions/${e.name}: clave desconocida "${k}"`); });
      out[m[1]] = true;
    });
  }
  return (_acts = out);
}
const validate = () => { if (!cfg().enabled) return; env(); actions(); }; // registro: aborta si falta/está mal el entorno o hay acciones inválidas

// ---- contadores por ventana (almacén compartido; patrón de mail.js) -----------------------------------------------------------------------
function bump(key, limit, windowMs) {
  const store = $app.store(), k = "pbmini:tg:" + key + ":" + Math.floor(Date.now() / windowMs);
  const n = (Number(store.get(k)) || 0) + 1;
  if (n > limit) return false;
  store.set(k, String(n)); return true;
}

// ---- construcción del mensaje ------------------------------------------------------------------------------------------------------------
const MSG_KEYS = ["title", "text", "buttons", "silent", "protect", "key"];
function newNonce(app, rid, action, args) {
  const c = cfg(), nonce = $security.randomString(24), row = new Record(app.findCollectionByNameOrId(ACTIONS));
  row.set("hash", $security.sha256(nonce)); row.set("rid", rid); row.set("action", action); row.set("args", JSON.stringify(args || {})); row.set("used", false); row.set("expires", dt(Date.now() + c.actionTtl * 1000));
  app.save(row); return nonce;
}
// msg => parámetros de sendMessage (texto escapado, botones validados). `rid` liga los botones de acción al usuario destinatario (null en alertas de operadores: solo url/webApp).
function build(app, rid, msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) throw new Error("pbmini: el mensaje de Telegram debe ser un objeto");
  Object.keys(msg).forEach((k) => { if (MSG_KEYS.indexOf(k) < 0) throw new Error(`pbmini: opción de Telegram desconocida: ${k}`); });
  const title = msg.title === undefined ? "" : msg.title;
  if (typeof title !== "string" || title.length > 200) throw new Error("pbmini: title debe ser texto de hasta 200 caracteres");
  if (typeof msg.text !== "string" || msg.text.length < 1 || msg.text.length > MAX_TEXT) throw new Error(`pbmini: text debe ser texto de 1..${MAX_TEXT} caracteres`);
  ["silent", "protect"].forEach((k) => { if (msg[k] !== undefined && typeof msg[k] !== "boolean") throw new Error(`pbmini: ${k} debe ser true o false`); });
  const body = (title ? `<b>${esc(title)}</b>\n` : "") + esc(msg.text);
  if (body.length > 20000) throw new Error("pbmini: mensaje demasiado largo");
  const p = { text: body, parse_mode: "HTML", disable_web_page_preview: true };
  if (msg.silent) p.disable_notification = true;
  if (msg.protect) p.protect_content = true;
  if (msg.buttons !== undefined) {
    const rows = msg.buttons;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) throw new Error("pbmini: buttons debe ser una lista de 1..3 filas");
    p.reply_markup = { inline_keyboard: rows.map((row) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 3) throw new Error("pbmini: cada fila de buttons debe tener 1..3 botones");
      return row.map((b) => {
        if (b === null || typeof b !== "object" || typeof b.text !== "string" || b.text.length < 1 || b.text.length > 64) throw new Error("pbmini: cada botón requiere text de 1..64 caracteres");
        const kind = ["action", "url", "webApp"].filter((k) => b[k] !== undefined);
        Object.keys(b).forEach((k) => { if (["text", "action", "args", "url", "webApp"].indexOf(k) < 0) throw new Error(`pbmini: opción de botón desconocida: ${k}`); });
        if (kind.length !== 1) throw new Error("pbmini: cada botón debe tener exactamente uno de action, url o webApp");
        if (b.args !== undefined && kind[0] !== "action") throw new Error("pbmini: args solo se usa con action");
        if (kind[0] === "url") { if (typeof b.url !== "string" || !URL_RE.test(b.url)) throw new Error("pbmini: la url del botón debe ser https"); return { text: b.text, url: b.url }; }
        if (kind[0] === "webApp") { if (b.webApp !== true || !env().mini) throw new Error("pbmini: webApp requiere TELEGRAM_MINIAPP_URL"); return { text: b.text, web_app: { url: env().mini } }; }
        if (typeof b.action !== "string" || !NAME_RE.test(b.action) || !actions()[b.action]) throw new Error(`pbmini: acción de Telegram desconocida: ${b.action}`);
        if (!rid) throw new Error("pbmini: los botones de acción requieren un usuario destinatario");
        const args = b.args === undefined ? {} : b.args;
        if (args === null || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 500) throw new Error("pbmini: args debe ser un objeto pequeño");
        return { text: b.text, callback_data: "a:" + newNonce(app, rid, b.action, args) };
      });
    }) };
  }
  return p;
}

// ---- cola de salida -----------------------------------------------------------------------------------------------------------------------
function enqueue(app, chatId, rid, payload, dedupe) { // false => ya existía (idempotente por dedupe)
  const row = new Record(app.findCollectionByNameOrId(OUTBOX));
  row.set("chat_id", chatId); row.set("rid", rid || ""); row.set("payload", JSON.stringify(payload)); row.set("dedupe", dedupe); row.set("state", "pending"); row.set("attempts", 0); row.set("next_try", dt(Date.now()));
  try { app.save(row); } catch (err) {
    try { app.findFirstRecordByFilter(OUTBOX, "dedupe = {:d}", { d: dedupe }); return false; } catch (_) { throw err; }
  }
  return row.id;
}
function claim(app, id) { // atómico: pasa pending (o sending abandonado) a sending; true si la reclamación es de este proceso
  const now = dt(Date.now()), lease = dt(Date.now() + 120000);
  const r = app.db().newQuery("UPDATE " + OUTBOX + " SET state = 'sending', next_try = {:lease} WHERE id = {:id} AND (state = 'pending' OR (state = 'sending' AND next_try <= {:now}))").bind({ lease, id, now }).execute();
  return r.rowsAffected() === 1;
}
function finish(app, row, state, error) {
  row.set("state", state); row.set("error", String(error || "").slice(0, 300));
  if (state === "sent") row.set("sent", dt(Date.now()));
  if (state === "sent" || state === "dead") row.set("payload", ""); // datos personales: el contenido no se conserva
  app.save(row);
}
function markBlocked(app, chatId) {
  try { const l = app.findFirstRecordByFilter(CHATS, "chat_id = {:c}", { c: chatId }); l.set("status", "blocked"); app.save(l); } catch (_) { /* sin vínculo (operador): nada que marcar */ }
}
// Un intento de entrega de una fila ya reclamada. Devuelve "sent" | "retry" | "dead".
function attempt(app, row) {
  let p; try { p = JSON.parse(row.getString("payload")); } catch (_) { finish(app, row, "dead", "payload ilegible"); return "dead"; }
  const r = api("sendMessage", Object.assign({ chat_id: row.getString("chat_id") }, p));
  if (r.ok) {
    finish(app, row, "sent", "");
    try { const l = app.findFirstRecordByFilter(CHATS, "chat_id = {:c}", { c: row.getString("chat_id") }); l.set("last_sent", dt(Date.now())); app.save(l); } catch (_) {}
    return "sent";
  }
  const n = (Number(row.get("attempts")) || 0) + 1;
  row.set("attempts", n);
  if (r.status === 403) { markBlocked(app, row.getString("chat_id")); finish(app, row, "dead", "bloqueado: " + r.desc); return "dead"; }
  if (r.status === 400 || r.status === 404) { finish(app, row, "dead", `rechazado (${r.status}): ${r.desc}`); return "dead"; }
  if (n >= MAX_ATTEMPTS) { finish(app, row, "dead", `sin éxito tras ${n} intentos (${r.status}): ${r.desc}`); return "dead"; }
  const wait = r.status === 429 ? Math.max(1, Math.min(r.retryAfter || 5, 3600)) * 1000 : Math.min(30000 * Math.pow(2, n - 1), 3600000);
  row.set("state", "pending"); row.set("next_try", dt(Date.now() + wait)); row.set("error", `reintento (${r.status}): ${r.desc}`.slice(0, 300));
  app.save(row); return "retry";
}
// Drena la cola con ritmo (cron cada minuto): ≤25 mensajes/s global y ≥1 s entre mensajes al mismo chat.
function drain(app, opt) {
  const o = opt || {}, budget = o.budgetMs || 50000, max = o.max || 5000, start = Date.now(), lastChat = Object.create(null), res = { sent: 0, retry: 0, dead: 0 };
  if (!cfg().enabled) return res;
  const skip = Object.create(null);
  for (let i = 0; i < max && Date.now() - start < budget; i++) {
    let rows;
    try { rows = app.findRecordsByFilter(OUTBOX, "(state = 'pending' || state = 'sending') && next_try <= {:n}", "next_try", 50, 0, { n: dt(Date.now()) }); } catch (_) { break; }
    rows = rows.filter((r) => !skip[r.id]);
    if (!rows.length) break;
    for (const row of rows) {
      if (Date.now() - start >= budget) return res;
      const chat = row.getString("chat_id"), since = Date.now() - (lastChat[chat] || 0);
      if (since < 1000) { if (lastChat[chat] && since < 1000 && rows.length === 1) { sleep(1000 - since); } else { skip[row.id] = true; continue; } }
      if (!claim(app, row.id)) continue;
      const fresh = app.findRecordById(OUTBOX, row.id);
      lastChat[chat] = Date.now();
      res[attempt(app, fresh)]++;
      sleep(PACE_MS);
    }
  }
  return res;
}

// ---- destinatarios -----------------------------------------------------------------------------------------------------------------------
const isBlockedUser = (rec) => { try { return require(`${__hooks}/lib/access.js`).isBlocked(rec); } catch (_) { return false; } };
function linkOf(app, rid) { // vínculo activo del usuario o null
  const c = cfg();
  try { const l = app.findFirstRecordByFilter(CHATS, "rid = {:r} && coll = {:c}", { r: rid, c: c.collection }); return l; } catch (_) { return null; }
}
function checkRoute(route, what) {
  if (!cfg().enabled) throw new Error(`pbmini: ${what} requiere telegram.enabled en pbmini.config.js`);
  if (route.method === "GET") throw new Error(`pbmini: ${what} no se permite en GET (podría dispararse con un enlace)`);
  if (route.auth === "public") throw new Error(`pbmini: ${what} no se permite en rutas públicas (auth: "user" o "superuser")`);
}
function keyOf(k) { if (k === undefined) return null; if (typeof k !== "string" || !KEY_RE.test(k)) throw new Error("pbmini: key debe ser una cadena [A-Za-z0-9_.:-] de 1..64"); return k; }

// ctx.telegram(destino, mensaje): destino = "me" (usuario autenticado) o el id de un usuario. Devuelve {status: "sent"|"queued"|"duplicate"|"not_linked"|"blocked"}.
function sendUser(e, route, target, msg) {
  checkRoute(route, "ctx.telegram");
  const c = cfg();
  let rid;
  if (target === "me") { if (!e.auth || e.hasSuperuserAuth() || e.auth.collection().name !== c.collection) throw httpError(401, "unauthorized"); rid = e.auth.id; }
  else if (typeof target === "string" && ID_RE.test(target)) rid = target;
  else throw new Error('pbmini: el destino de ctx.telegram debe ser "me" o el id de un usuario');
  const key = keyOf(msg && msg.key);
  return deliverTo($app, rid, msg, key);
}
function deliverTo(app, rid, msg, key) {
  const c = cfg(), l = linkOf(app, rid);
  if (!l) return { status: "not_linked" };
  if (l.getString("status") !== "active") return { status: "blocked" };
  let user; try { user = app.findRecordById(c.collection, rid); } catch (_) { return { status: "not_linked" }; }
  if (isBlockedUser(user)) return { status: "blocked" };
  if (!bump("g", c.limits.perHour, 3600000) || !bump("u:" + rid, c.limits.perUserPerHour, 3600000) || !bump("c:" + l.getString("chat_id"), c.limits.perChatPerMinute, 60000)) throw httpError(429, "too many telegram messages");
  const payload = build(app, rid, msg), id = enqueue(app, l.getString("chat_id"), rid, payload, "u:" + rid + ":" + (key || $security.randomString(20)));
  if (id === false) return { status: "duplicate" };
  if (!claim(app, id)) return { status: "queued" };
  const r = attempt(app, app.findRecordById(OUTBOX, id));
  return { status: r === "sent" ? "sent" : r === "retry" ? "queued" : "failed" };
}
// Alerta a los chats de operadores (TELEGRAM_OPERATOR_CHATS). Utilizable también desde cron/hooks: alert($app, msg).
function alert(app, msg, opt) {
  if (!cfg().enabled) return { queued: 0 };
  const key = keyOf(opt && opt.key), c = cfg();
  if (!bump("g", c.limits.perHour, 3600000)) throw httpError(429, "too many telegram messages");
  const payload = build(app, null, msg); let n = 0;
  env().ops.forEach((chat) => { if (enqueue(app, chat, "", payload, "o:" + chat + ":" + (key || $security.randomString(20)))) n++; });
  return { queued: n };
}
function ctxAlert(e, route, msg, opt) { checkRoute(route, "ctx.telegramAlert"); return alert($app, msg, opt); }
// Un aviso a todos los usuarios vinculados cuyo campo contenga alguno de los valores del grupo (telegram.groups). Se encola; el cron lo reparte con ritmo.
function groupMembers(app, name) {
  const c = cfg(), g = c.groups[name];
  if (!g) throw new Error(`pbmini: grupo de Telegram desconocido: ${name}`);
  const want = g.values, out = [];
  for (let off = 0; off < 100000; off += 200) {
    const links = app.findRecordsByFilter(CHATS, "status = 'active' && coll = {:c}", "created", 200, off, { c: c.collection });
    if (!links.length) break;
    const users = app.findRecordsByIds(c.collection, links.map((l) => l.getString("rid")));
    const byId = Object.create(null); users.forEach((u) => { byId[u.id] = u; });
    links.forEach((l) => {
      const u = byId[l.getString("rid")];
      if (!u || isBlockedUser(u)) return;
      const v = u.get(g.field); let a = [];
      if (Array.isArray(v)) a = v; else if (typeof v === "string" && v) a = v.split(","); else if (v && typeof v === "object" && typeof v.length === "number") { for (let i = 0; i < v.length; i++) a.push(v[i]); }
      const have = a.map((x) => String(x).trim().toLowerCase());
      if (want.some((w) => have.indexOf(w) >= 0)) out.push({ rid: u.id, chat: l.getString("chat_id") });
    });
    if (links.length < 200) break;
  }
  return out;
}
function sendGroup(e, route, name, msg, opt) {
  checkRoute(route, "ctx.telegramGroup");
  return notifyGroup($app, name, msg, opt);
}
// ---- API para hooks y cron (sin petición): require(`${__hooks}/lib/telegram.js`).notify($app, idUsuario, mensaje) ---------------------------------------
// Pensada para eventos de la app (un registro que cambia, un cron). Mismas garantías que ctx.telegram (escape, límites, cola, idempotencia por key),
// pero NUNCA debe romper el guardado: envuélvela en try/catch (lanza si el módulo está apagado, el mensaje es inválido o se superan los límites).
function notify(app, rid, msg, opt) {
  if (!cfg().enabled) throw new Error("pbmini: telegram requiere telegram.enabled en pbmini.config.js");
  if (typeof rid !== "string" || !ID_RE.test(rid)) throw new Error("pbmini: el destino de notify debe ser el id de un usuario");
  return deliverTo(app, rid, msg, keyOf(opt && opt.key !== undefined ? opt.key : msg && msg.key));
}
function notifyGroup(app, name, msg, opt) {
  if (!cfg().enabled) throw new Error("pbmini: telegram requiere telegram.enabled en pbmini.config.js");
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("pbmini: nombre de grupo inválido");
  const c = cfg(), key = keyOf(opt && opt.key !== undefined ? opt.key : msg && msg.key) || $security.randomString(20);
  const members = groupMembers($app, name);
  if (!bump("g", c.limits.perHour, 3600000)) throw httpError(429, "too many telegram messages");
  let queued = 0, skipped = 0;
  members.forEach((m) => {
    if (!bump("u:" + m.rid, c.limits.perUserPerHour, 3600000)) { skipped++; return; }
    const payload = build($app, m.rid, msg);
    if (enqueue($app, m.chat, m.rid, payload, "g:" + name + ":" + key + ":" + m.rid)) queued++;
  });
  return { queued, skipped, members: members.length };
}

// ---- vinculación (enlace t.me/<bot>?start=<token> de un solo uso) ------------------------------------------------------------------------
const MSG = {
  ok: "Cuenta vinculada. Recibirás aquí tus avisos. /stop para desactivarlos.", invalid: "El enlace no es válido o ya caducó. Genera uno nuevo desde la aplicación.",
  taken: "Este Telegram ya está vinculado a otra cuenta. Usa /stop desde esa cuenta y vuelve a intentarlo.", hello: "Para vincular tu cuenta abre el enlace que te muestra la aplicación.",
  stopped: "Avisos desactivados.", none: "No hay ninguna cuenta vinculada a este Telegram.", linked: "Cuenta vinculada: los avisos están activos.", expired: "Esta acción ya caducó o ya se usó.",
};
const botName = () => { try { return env().user || String($app.store().get("pbmini:tg:bot") || ""); } catch (_) { return ""; } };
function link(e, route) { // ctx.telegramLink(): enlace de vinculación para el usuario autenticado
  checkRoute(route, "ctx.telegramLink");
  const c = cfg();
  if (!e.auth || e.hasSuperuserAuth() || e.auth.collection().name !== c.collection) throw httpError(401, "unauthorized");
  const bot = botName();
  if (!bot) throw httpError(503, "telegram bot unavailable");
  const rid = e.auth.id;
  if (!bump("l:" + rid, 5, 3600000)) throw httpError(429, "too many link requests");
  try { $app.findRecordsByFilter(LINKS, "rid = {:r} && used = false", "", 50, 0, { r: rid }).forEach((r) => $app.delete(r)); } catch (_) {}
  const token = $security.randomString(32), row = new Record($app.findCollectionByNameOrId(LINKS)), exp = Date.now() + c.linkTtl * 1000;
  row.set("hash", $security.sha256(token)); row.set("rid", rid); row.set("coll", c.collection); row.set("expires", dt(exp)); row.set("used", false);
  $app.save(row);
  return { url: `https://t.me/${bot}?start=${token}`, expires: new Date(exp).toISOString() };
}
function consumeLink(app, token, tgid, chatId) { // transacción: un solo uso, caducidad y un Telegram por cuenta
  if (!LINK_RE.test(token)) return MSG.invalid;
  const c = cfg();
  let result = MSG.invalid;
  app.runInTransaction((tx) => {
    let row; try { row = tx.findFirstRecordByFilter(LINKS, "hash = {:h} && used = false && expires > {:n}", { h: $security.sha256(token), n: dt(Date.now()) }); } catch (_) { return; }
    if (tx.db().newQuery("UPDATE " + LINKS + " SET used = 1 WHERE id = {:id} AND used = 0").bind({ id: row.id }).execute().rowsAffected() !== 1) return;
    const rid = row.getString("rid");
    try { tx.findRecordById(c.collection, rid); } catch (_) { return; } // la cuenta ya no existe
    let other = null, mine = null;
    try { other = tx.findFirstRecordByFilter(CHATS, "tgid = {:t}", { t: tgid }); } catch (_) {}
    if (other && other.getString("rid") !== rid) { result = MSG.taken; return; }
    try { mine = tx.findFirstRecordByFilter(CHATS, "rid = {:r}", { r: rid }); } catch (_) {}
    const rec = mine || other || new Record(tx.findCollectionByNameOrId(CHATS));
    rec.set("rid", rid); rec.set("coll", c.collection); rec.set("tgid", tgid); rec.set("chat_id", chatId); rec.set("status", "active");
    tx.save(rec); result = MSG.ok;
  });
  return result;
}
function reply(chatId, text) { api("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }); }

// ---- botones: un nonce de un solo uso por pulsación -------------------------------------------------------------------------------------
function runAction(app, linkRec, nonce) { // texto para answerCallbackQuery
  if (!NONCE_RE.test(nonce)) return MSG.expired;
  let row, ok = false;
  app.runInTransaction((tx) => {
    try { row = tx.findFirstRecordByFilter(ACTIONS, "hash = {:h} && used = false && expires > {:n}", { h: $security.sha256(nonce), n: dt(Date.now()) }); } catch (_) { return; }
    if (row.getString("rid") !== linkRec.getString("rid")) return; // el botón es de otra cuenta
    ok = tx.db().newQuery("UPDATE " + ACTIONS + " SET used = 1 WHERE id = {:id} AND used = 0").bind({ id: row.id }).execute().rowsAffected() === 1;
  });
  if (!ok) return MSG.expired;
  const name = row.getString("action");
  if (!actions()[name]) return MSG.expired;
  try {
    let args = {}; try { args = JSON.parse(row.getString("args")); } catch (_) {}
    const user = app.findRecordById(cfg().collection, row.getString("rid"));
    if (isBlockedUser(user)) return MSG.expired;
    const r = require(`${__hooks}/telegram/actions/${name}.js`).run(app, { user, args });
    return typeof r === "string" ? r.slice(0, 200) : "Listo";
  } catch (err) { app.logger().error("pbmini telegram: la acción falló", "action", name, "error", redact(err)); return "Error"; }
}

// ---- webhook ------------------------------------------------------------------------------------------------------------------------------
const intId = (v) => typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 9007199254740991;
function seenUpdate(id) { // anillo de los últimos ids (los manejadores además son idempotentes)
  const store = $app.store(); let ring = [];
  try { ring = JSON.parse(String(store.get("pbmini:tg:seen") || "[]")); } catch (_) {}
  if (ring.indexOf(id) >= 0) return true;
  ring.push(id); if (ring.length > 2000) ring = ring.slice(-2000);
  store.set("pbmini:tg:seen", JSON.stringify(ring)); return false;
}
function onMessage(app, m) {
  if (!m || typeof m !== "object" || !m.chat || m.chat.type !== "private" || !m.from || m.from.is_bot === true || !intId(m.from.id) || m.chat.id !== m.from.id) return; // solo chats privados
  if (typeof m.text !== "string" || m.text.length > 256) return;
  const tgid = String(m.from.id), chat = String(m.chat.id);
  const cmd = /^\/(start|stop|status)(?:@[A-Za-z0-9_]{5,32})?(?: +([A-Za-z0-9]{1,64}))?$/.exec(m.text.trim());
  if (!cmd) return;
  if (cmd[1] === "start") return reply(chat, cmd[2] ? consumeLink(app, cmd[2], tgid, chat) : MSG.hello);
  let l = null; try { l = app.findFirstRecordByFilter(CHATS, "tgid = {:t}", { t: tgid }); } catch (_) {}
  if (cmd[1] === "stop") { if (l) app.delete(l); return reply(chat, l ? MSG.stopped : MSG.none); }
  if (l && l.getString("status") === "blocked") { l.set("status", "active"); app.save(l); } // si escribe, está accesible
  reply(chat, l ? MSG.linked : MSG.none);
}
function onCallback(app, q) {
  if (!q || typeof q !== "object" || typeof q.id !== "string" || q.id.length > 64 || !q.from || q.from.is_bot === true || !intId(q.from.id) || typeof q.data !== "string" || q.data.length > 64) return;
  let l = null; try { l = app.findFirstRecordByFilter(CHATS, "tgid = {:t}", { t: String(q.from.id) }); } catch (_) {}
  const m = /^a:([A-Za-z0-9]{24})$/.exec(q.data);
  const text = !l || !m ? MSG.expired : runAction(app, l, m[1]);
  api("answerCallbackQuery", { callback_query_id: q.id, text });
}
function onMyChatMember(app, u) {
  if (!u || !u.chat || u.chat.type !== "private" || !u.new_chat_member || !intId(u.chat.id)) return;
  const st = u.new_chat_member.status;
  let l = null; try { l = app.findFirstRecordByFilter(CHATS, "tgid = {:t}", { t: String(u.chat.id) }); } catch (_) {}
  if (!l) return;
  if (st === "kicked" || st === "left") { l.set("status", "blocked"); app.save(l); } else if (st === "member" && l.getString("status") === "blocked") { l.set("status", "active"); app.save(l); }
}
function webhook(e) {
  const h = e.response.header();
  h.set("Cache-Control", "no-store"); h.set("X-Content-Type-Options", "nosniff");
  if (!$security.equal(String(e.request.header.get("X-Telegram-Bot-Api-Secret-Token") || ""), env().secret)) return e.json(403, { error: "forbidden" });
  let up;
  try { up = JSON.parse(toString(e.request.body)); } catch (_) { return e.json(400, { error: "invalid body" }); }
  if (up === null || typeof up !== "object" || Array.isArray(up) || !intId(up.update_id) || up.update_id < 0) return e.json(400, { error: "invalid body" });
  if (seenUpdate(up.update_id)) return e.json(200, { ok: true });
  try {
    if (up.message) onMessage($app, up.message); else if (up.callback_query) onCallback($app, up.callback_query); else if (up.my_chat_member) onMyChatMember($app, up.my_chat_member);
  } catch (err) { $app.logger().error("pbmini telegram: error procesando una actualización", "error", redact(err)); } // 200 igualmente: un reintento infinito de Telegram no ayuda
  return e.json(200, { ok: true });
}
function routes() {
  routerAdd("POST", "/_telegram/webhook", (e) => require(`${__hooks}/lib/telegram.js`).webhook(e), $apis.bodyLimit(65536));
  if (cfg().login.enabled) routerAdd("POST", "/_telegram/login", (e) => require(`${__hooks}/lib/telegram.js`).login(e), $apis.bodyLimit(16384));
}
// Al servir: nombre del bot (getMe) y registro del webhook (setWebhook) si hay TELEGRAM_WEBHOOK_URL. Un fallo de red solo se registra: el resto sigue funcionando.
function boot() {
  const en = env();
  const me = api("getMe", {});
  if (me.ok && me.json.result && USERNAME_RE.test(String(me.json.result.username || ""))) $app.store().set("pbmini:tg:bot", String(me.json.result.username));
  else console.log(`pbmini: telegram getMe falló (${me.status}) ${me.desc}`);
  if (en.hook) {
    const r = api("setWebhook", { url: en.hook + "/_telegram/webhook", secret_token: en.secret, allowed_updates: ["message", "callback_query", "my_chat_member"], max_connections: 20 });
    console.log(r.ok ? "pbmini: telegram webhook registrado" : `pbmini: telegram setWebhook falló (${r.status}) ${r.desc}`);
  } else console.log("pbmini: telegram sin TELEGRAM_WEBHOOK_URL: registra el webhook a mano (setWebhook) o no llegarán /start ni botones");
}
// Limpieza diaria: contenido y filas caducadas (datos personales).
function gc(app) {
  const c = cfg();
  if (!c.enabled) return;
  const old = dt(Date.now() - c.retention.sentDays * 86400000), oldLinks = dt(Date.now() - c.retention.linksDays * 86400000);
  const sweep = (coll, filter, params) => { try { app.findRecordsByFilter(coll, filter, "", 5000, 0, params).forEach((r) => app.delete(r)); } catch (_) {} };
  sweep(OUTBOX, "(state = 'sent' || state = 'dead') && next_try < {:d}", { d: old }); // next_try = última actividad de la fila
  try { app.findRecordsByFilter(OUTBOX, "(state = 'pending' || state = 'sending') && next_try < {:d}", "", 5000, 0, { d: old }).forEach((r) => { r.set("state", "dead"); r.set("payload", ""); r.set("error", "caducado sin enviar"); app.save(r); }); } catch (_) {}
  sweep(LINKS, "expires < {:d}", { d: oldLinks }); // caducó hace más de linksDays (usados o no)
  sweep(ACTIONS, "expires < {:d}", { d: oldLinks });
}
function onUserDeleted(e) { // sin cuenta no hay destinatario: se retira el vínculo y lo pendiente
  const rid = e.record.id, app = $app;
  [CHATS, LINKS, ACTIONS, OUTBOX].forEach((coll) => { try { app.findRecordsByFilter(coll, "rid = {:r}", "", 5000, 0, { r: rid }).forEach((r) => app.delete(r)); } catch (_) {} });
}

// ---- login por Mini App (initData firmado por Telegram) ----------------------------------------------------------------------------------
// HMAC-SHA256 con clave BINARIA (la clave es HMAC("WebAppData", token)): $security.hs256 solo admite claves de texto, así que se usa SHA-256 en JS puro.
const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function sha256(bytes) { // arreglo de bytes -> arreglo de 32 bytes
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], n = bytes.length, m = bytes.slice();
  m.push(0x80); while (m.length % 64 !== 56) m.push(0);
  const hi = Math.floor(n / 0x20000000), lo = (n << 3) >>> 0;
  m.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const w = new Array(64), rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = []; h.forEach((x) => out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255)); return out;
}
function hmac256(key, msg) { // key, msg: arreglos de bytes
  let k = key.length > 64 ? sha256(key) : key.slice(); while (k.length < 64) k.push(0);
  const ip = k.map((b) => b ^ 0x36), op = k.map((b) => b ^ 0x5c);
  return sha256(op.concat(sha256(ip.concat(msg))));
}
function utf8(s) { // texto -> bytes UTF-8 (null si hay sustitutos sueltos)
  let e; try { e = unescape(encodeURIComponent(String(s))); } catch (_) { return null; }
  const out = []; for (let i = 0; i < e.length; i++) out.push(e.charCodeAt(i)); return out;
}
const hex = (b) => b.map((x) => (x < 16 ? "0" : "") + x.toString(16)).join("");
function decodeComponent(v) { try { return decodeURIComponent(String(v).replace(/\+/g, " ")); } catch (_) { return null; } }
// Valida initData con la clave del bot. Devuelve {user, hash} o null (nunca explica por qué falló).
function verifyInitData(raw, maxAge) {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 8192) return null;
  const f = Object.create(null), keys = [];
  const parts = raw.split("&");
  if (parts.length > 40) return null;
  for (let i = 0; i < parts.length; i++) {
    const j = parts[i].indexOf("=");
    if (j <= 0) return null;
    const k = decodeComponent(parts[i].slice(0, j)), v = decodeComponent(parts[i].slice(j + 1));
    if (k === null || v === null || !/^[A-Za-z_]{1,32}$/.test(k) || f[k] !== undefined) return null; // sin claves repetidas ni raras
    f[k] = v; if (k !== "hash") keys.push(k);
  }
  if (!/^[0-9a-f]{64}$/.test(f.hash || "") || !/^[0-9]{1,12}$/.test(f.auth_date || "") || typeof f.user !== "string") return null;
  keys.sort();
  const chk = utf8(keys.map((k) => k + "=" + f[k]).join("\n")), name = utf8("WebAppData"), tok = utf8(env().token);
  if (!chk || !name || !tok) return null;
  const calc = hex(hmac256(hmac256(name, tok), chk));
  if (!$security.equal(calc, f.hash)) return null;
  const now = Date.now() / 1000, at = Number(f.auth_date);
  if (at > now + 60 || now - at > maxAge) return null; // futura (reloj) o demasiado vieja
  let user; try { user = JSON.parse(f.user); } catch (_) { return null; }
  if (user === null || typeof user !== "object" || !intId(user.id) || user.id <= 0 || user.is_bot === true) return null;
  return { user, hash: f.hash };
}
function usedHash(h) { // un initData sirve una sola vez (anillo de los últimos 2000 hashes verificados)
  const store = $app.store(); let ring = [];
  try { ring = JSON.parse(String(store.get("pbmini:tg:iw") || "[]")); } catch (_) {}
  if (ring.indexOf(h) >= 0) return true;
  ring.push(h); if (ring.length > 2000) ring = ring.slice(-2000);
  store.set("pbmini:tg:iw", JSON.stringify(ring)); return false;
}
function login(e) { // POST /_telegram/login {initData}
  const hd = e.response.header();
  hd.set("Cache-Control", "no-store"); hd.set("X-Content-Type-Options", "nosniff");
  const c = cfg(), ip = String(e.realIP() || "");
  if (!bump("lg:ip:" + ip, c.login.perMinute, 60000) || !bump("lg:all", Math.max(600, c.login.perMinute * 10), 60000)) return e.json(429, { error: "too many requests" });
  let body;
  try { body = JSON.parse(toString(e.request.body)); } catch (_) { return e.json(400, { error: "invalid body" }); }
  if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.initData !== "string") return e.json(400, { error: "invalid body" });
  const v = verifyInitData(body.initData, c.login.maxAge);
  if (!v) return e.json(401, { error: "unauthorized" });
  if (c.login.singleUse && usedHash(v.hash)) return e.json(401, { error: "unauthorized" });
  const tgid = String(v.user.id);
  let linkRec = null, user = null;
  try { linkRec = $app.findFirstRecordByFilter(CHATS, "tgid = {:t}", { t: tgid }); } catch (_) {}
  if (!linkRec && c.login.autoprovision) {
    try {
      $app.runInTransaction((tx) => {
        const u = new Record(tx.findCollectionByNameOrId(c.collection)), pw = $security.randomString(40);
        u.set("email", `tg${tgid}@telegram.invalid`); u.set("emailVisibility", false); u.set("verified", false); u.setPassword(pw); u.set("passwordConfirm", pw);
        tx.save(u);
        const l = new Record(tx.findCollectionByNameOrId(CHATS));
        l.set("rid", u.id); l.set("coll", c.collection); l.set("tgid", tgid); l.set("chat_id", tgid); l.set("status", "active"); tx.save(l);
      });
    } catch (_) { /* carrera: otra petición ya lo creó */ }
    try { linkRec = $app.findFirstRecordByFilter(CHATS, "tgid = {:t}", { t: tgid }); } catch (_) {}
  }
  if (!linkRec) return e.json(403, { error: "not linked", code: "not_linked" });
  try { user = $app.findRecordById(c.collection, linkRec.getString("rid")); } catch (_) { return e.json(401, { error: "unauthorized" }); }
  if (isBlockedUser(user)) return e.json(403, { error: "forbidden" });
  let token;
  try { token = require(`${__hooks}/lib/sessions.js`).issueFor($app, user, e); } catch (err) { $app.logger().error("pbmini telegram: no se pudo emitir el token", "error", redact(err)); return e.json(500, { error: "internal error" }); }
  return e.json(200, { token, record: user.publicExport() });
}

// Envío simple (lo usa lib/notify.js): to = { user } | { group } | { ops: true }; msg = texto o mensaje completo.
function send(app, to, msg, opt) {
  const m = typeof msg === "string" ? { text: msg } : msg;
  if (to.user) return notify(app, to.user, m, opt);
  if (to.group) return notifyGroup(app, to.group, m, opt);
  if (to.ops) return alert(app, m, opt);
  throw new Error("pbmini telegram: destino inválido");
}
module.exports = { send, notify, notifyGroup, login, verifyInitData, hmac256, sha256, utf8, hex, webhook, routes, boot, gc, onUserDeleted, link, consumeLink, runAction, env, validate, ensure, validateSchema, api, actions, build, esc, enqueue, claim, attempt, drain, deliverTo, sendUser, sendGroup, groupMembers, alert, ctxAlert, linkOf, bump, redact, COLL: { CHATS, LINKS, OUTBOX, ACTIONS } };
