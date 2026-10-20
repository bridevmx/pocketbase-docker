// Módulo opcional de sesiones revocables (apagado por defecto; ver pbmini.config.js).
//  - Al iniciar sesión (contraseña, OTP, OAuth2...) y al refrescar, el token que emite PocketBase se sustituye por OTRO IGUAL (mismos claims, misma caducidad,
//    firmado con la misma clave) que lleva además un identificador de sesión `sid`. PocketBase y su API nativa lo aceptan; un `refresh` conserva el `sid`.
//  - Revocar = vetar un `sid`. Un middleware GLOBAL (también /api/* y /_/) rechaza con 401 los tokens con `sid` vetado; la lista vive en memoria
//    (sin consultas por petición) y se persiste en `pbmini_sessions` (se recarga al servir). Un `sid` vetado no se puede refrescar: el refresh ya llega bloqueado.
//  - Funciona en proyectos existentes: crea la colección `pbmini_sessions` (solo superusuario). Los tokens emitidos antes de activar el módulo no llevan `sid`:
//    `legacy: "allow"` (por defecto) los respeta hasta que caduquen o se llame a logoutEverywhere(); `legacy: "deny"` los rechaza (los usuarios vuelven a iniciar sesión).
//  - Se guarda el `sid`, nunca el token. Cada token propio se valida en el momento de emitirlo con findAuthRecordByToken; si PocketBase lo rechazara
//    (p. ej. un cambio futuro de su esquema de firma) se entrega el token estándar y se avisa en el log: el inicio de sesión nunca se rompe.
//  - Realtime (SSE): PocketBase autentica la conexión UNA vez (al suscribirse) y no la vuelve a mirar: sin esto, una sesión revocada o un token vencido siguen recibiendo eventos.
//    Con `realtime: true` (por defecto) cada suscripción se etiqueta con su sid/caducidad; al revocar (sesión, cerrar todo, bloqueo, cambio de contraseña/correo, borrado) se corta la conexión
//    y, además, cada mensaje saliente se comprueba contra la lista de vetos y la caducidad del token (red de seguridad).
//  - Límites: el veto vive en un solo proceso (PocketBase es un solo nodo); apagar el módulo deja de aplicar los vetos
//    (los tokens revocados no vencidos vuelven a valer): usa logoutEverywhere() si necesitas cerrar todo.
const cfg = () => require(`${__hooks}/lib/config.js`).load().sessions;
const COLL = "pbmini_sessions";
const DENY = "pbmini:deny:";
const SID = /^[A-Za-z0-9]{16}$/;
const JWT = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{0,2048}$/;
const CTRL = /[\x00-\x1f\x7f]/g;
const dt = (ms) => new Date(ms).toISOString().replace("T", " ");

function claimsOf(token) { // claims SIN verificar (solo para decidir veto/identidad; la firma la comprueba PocketBase)
  if (typeof token !== "string" || !JWT.test(token)) return null;
  try { const c = $security.parseUnverifiedJWT(token); return c && typeof c === "object" ? c : null; } catch (_) { return null; }
}
let _collId = null; // por runtime
function collectionId() { if (_collId === null) { try { _collId = $app.findCollectionByNameOrId(cfg().collection).id; } catch (_) { _collId = ""; } } return _collId; }

function ensure(app) { // idempotente: crea la colección solo si no existe
  try {
    const c = app.findCollectionByNameOrId(COLL);
    if (!c.fields.getByName("sid")) throw new Error(`la colección ${COLL} tiene el esquema antiguo (sin "sid"): elimínala desde el panel y reinicia`);
    return;
  } catch (err) { if (String(err).indexOf("esquema antiguo") >= 0) throw err; }
  app.save(new Collection({
    type: "base", name: COLL, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "sid", type: "text", required: true, max: 16 }, { name: "rid", type: "text", required: true, max: 30 }, { name: "coll", type: "text", max: 64 },
      { name: "ip", type: "text", max: 64 }, { name: "ua", type: "text", max: 200 }, { name: "expires", type: "date" }, { name: "seen", type: "date" },
      { name: "revoked", type: "bool" }, { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [`CREATE UNIQUE INDEX idx_${COLL}_sid ON ${COLL} (sid)`, `CREATE INDEX idx_${COLL}_rid ON ${COLL} (rid)`],
  }));
}
const expMs = (row) => new Date(String(row.get("expires")).replace(" ", "T")).getTime() || Date.now() + 86400000;
// Al servir: recarga en memoria los sid revocados que aún no han vencido.
function loadDeny(app) {
  if (!cfg().enabled) return 0;
  const rows = app.findRecordsByFilter(COLL, "revoked = true && expires > {:n}", "", 100000, 0, { n: dt(Date.now()) });
  rows.forEach((r) => app.store().set(DENY + r.getString("sid"), String(expMs(r))));
  return rows.length;
}

function sidDenied(sid) { // ¿este sid está vetado (y su veto sigue vigente)?
  const v = $app.store().get(DENY + sid);
  if (!v) return false;
  if (Number(v) < Date.now()) { $app.store().remove(DENY + sid); return false; } // vencido: el token ya no vale por sí solo
  return true;
}
// ¿Este token está vetado? (memoria; sin consultas a la base)
function denied(token) {
  const c = cfg();
  if (!c.enabled) return false;
  const cl = claimsOf(token);
  if (!cl || cl.type !== "auth") return false;
  if (typeof cl.sid === "string" && SID.test(cl.sid)) return sidDenied(cl.sid);
  return c.legacy === "deny" && cl.collectionId === collectionId(); // sin sid: solo los de la colección configurada
}
const bearer = (e) => String(e.request.header.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
// Middleware GLOBAL (-1015): la cabecera Authorization de CUALQUIER ruta, nativa incluida.
function guard(e) {
  const t = bearer(e);
  if (t && !verify(e, t)) return e.json(401, { status: 401, message: "The request requires valid record authorization token.", data: {} });
  return e.next();
}
// Desde cookieAuth (token de la cookie `pb_auth` ya validado por PocketBase): false => anónimo. Fija el sid de la petición.
function verify(e, token) {
  if (!cfg().enabled) return true;
  if (denied(token)) return false;
  const cl = claimsOf(token);
  if (cl && typeof cl.sid === "string" && SID.test(cl.sid)) e.set("pbmini_sid", cl.sid);
  return true;
}

// Hook nativo onRecordAuthRequest: sustituye el token por uno con `sid` y registra/renueva la sesión.
function issue(e) {
  const c = cfg();
  if (!c.enabled || e.record.collection().name !== c.collection || !e.token) return;
  try {
    const re = e.requestEvent || e, claims = claimsOf(e.token);
    if (!claims) throw new Error("token estándar ilegible");
    const col = e.record.collection(), now = Date.now(), exp = Number(claims.exp) * 1000;
    let sid = null, row = null;
    if (!e.authMethod) { // refresh: se conserva el sid del token con el que se refresca, si es de esta misma persona
      const oc = claimsOf(bearer(re));
      if (oc && SID.test(oc.sid || "") && oc.id === e.record.id) { try { row = $app.findFirstRecordByFilter(COLL, "sid = {:s} && rid = {:r} && revoked = false", { s: oc.sid, r: e.record.id }); sid = oc.sid; } catch (_) { row = null; } }
    }
    if (!sid) sid = $security.randomString(16);
    const token = $security.createJWT(Object.assign({}, claims, { sid }), e.record.tokenKey() + col.authToken.secret, Math.max(1, Math.floor((exp - now) / 1000)));
    const back = $app.findAuthRecordByToken(token, "auth"); // autoverificación: PocketBase debe aceptar el token propio
    if (!back || back.id !== e.record.id) throw new Error("PocketBase rechazó el token propio");
    if (!row) {
      row = new Record($app.findCollectionByNameOrId(COLL));
      row.set("sid", sid); row.set("rid", e.record.id); row.set("coll", c.collection); row.set("revoked", false);
      row.set("ip", String(re.realIP() || "").replace(CTRL, "").slice(0, 64));
      row.set("ua", String(re.request.header.get("User-Agent") || "").replace(CTRL, " ").slice(0, 200));
    }
    row.set("expires", dt(isFinite(exp) ? exp : now + 14 * 86400000)); row.set("seen", dt(now));
    $app.save(row);
    e.token = token; // solo si todo lo anterior salió bien
  } catch (err) { $app.logger().error("pbmini sessions: se entrega el token estándar de PocketBase (sin sid)", "error", String(err)); } // nunca rompe el inicio de sesión
}

function requireWrite(route) { if (route.method === "GET") throw new Error("pbmini: esta operación no se permite en GET (CSRF)"); }
const on = () => { if (!cfg().enabled) throw new Error("pbmini: sessions está apagado (pbmini.config.js)"); };
function list(e) {
  on();
  if (!e.auth) return [];
  const cur = e.get("pbmini_sid");
  return $app.findRecordsByFilter(COLL, "rid = {:r} && revoked = false && expires > {:n}", "-created", 50, 0, { r: e.auth.id, n: dt(Date.now()) })
    .map((r) => ({ id: r.getString("sid"), ip: r.getString("ip"), userAgent: r.getString("ua"), created: String(r.get("created")), lastSeen: String(r.get("seen")), current: r.getString("sid") === cur }));
}
function revokeRow(app, row) { row.set("revoked", true); app.save(row); app.store().set(DENY + row.getString("sid"), String(expMs(row))); kick(app, { sid: row.getString("sid") }); }
function revoke(e, route, sid) { // solo sesiones propias; ajenas o inexistentes => false sin distinguirlas
  requireWrite(route); on();
  if (!e.auth || typeof sid !== "string" || !SID.test(sid)) return false;
  let row; try { row = $app.findFirstRecordByFilter(COLL, "sid = {:s} && rid = {:r}", { s: sid, r: e.auth.id }); } catch (_) { return false; }
  revokeRow($app, row); return true;
}
// Todas las sesiones activas de un usuario (p. ej. al bloquearlo): las veta en memoria y en la base.
function revokeAll(app, rid) {
  if (!cfg().enabled) return 0;
  const rows = app.findRecordsByFilter(COLL, "rid = {:r} && revoked = false && expires > {:n}", "", 1000, 0, { r: rid, n: dt(Date.now()) });
  rows.forEach((r) => revokeRow(app, r));
  kick(app, { rid }); // conexiones realtime con tokens sin sid (anteriores a activar el módulo)
  return rows.length;
}
const clearCookie = (e) => e.response.header().set("Set-Cookie", "pb_auth=; Path=/; Max-Age=0; SameSite=Lax");
function logout(e, route) { // cierra la sesión actual: veta el sid (si el módulo está activo) y expira la cookie
  requireWrite(route);
  const sid = e.get("pbmini_sid");
  if (cfg().enabled && sid) revoke(e, route, sid);
  clearCookie(e);
}
function logoutEverywhere(e, route) { // invalida TODOS los tokens del usuario (nativo: cambia su tokenKey) y veta sus sesiones
  requireWrite(route);
  if (!e.auth || e.hasSuperuserAuth()) throw new Error("pbmini: logoutEverywhere requiere un usuario autenticado");
  const rec = e.auth;
  rec.refreshTokenKey(); $app.save(rec);
  revokeAll($app, rec.id);
  clearCookie(e);
}
// ---- realtime ------------------------------------------------------------------------------------------------------------------------
const realtimeOn = () => { const c = cfg(); return c.enabled && c.realtime !== false; };
// Corta (discard) las conexiones realtime de una sesión (sid) o de un usuario (rid). El cliente del SDK se reconecta y su nuevo POST /api/realtime ya llega vetado (401).
function kick(app, who) {
  if (!realtimeOn()) return 0;
  let n = 0;
  try {
    const cl = app.subscriptionsBroker().clients();
    for (const id in cl) {
      const c = cl[id];
      let hit = !!who.sid && c.get("pbmini_sid") === who.sid;
      if (!hit && who.rid) { hit = c.get("pbmini_rid") === who.rid; if (!hit) { try { const a = c.get("auth"); hit = !!a && a.id === who.rid; } catch (_) { /* sin auth */ } } }
      if (hit) { c.discard(); n++; }
    }
  } catch (err) { app.logger().error("pbmini sessions: no se pudo cortar el realtime", "error", String(err)); }
  return n;
}
// Hook onRealtimeSubscribeRequest: etiqueta la conexión con la identidad del token con el que se suscribe (la cabecera es la única fuente fiable en este momento).
function tagClient(e) {
  if (!realtimeOn()) return;
  const cl = claimsOf(bearer(e.requestEvent || e));
  if (!cl || cl.type !== "auth") return; // anónima: nada que vigilar
  e.client.set("pbmini_sid", typeof cl.sid === "string" && SID.test(cl.sid) ? cl.sid : ""); e.client.set("pbmini_rid", String(cl.id || "")); e.client.set("pbmini_exp", Number(cl.exp) * 1000);
}
// Hook onRealtimeMessageSend: red de seguridad. false => no se envía el mensaje y se corta la conexión (sesión vetada o token vencido).
function allowMessage(e) {
  if (!realtimeOn()) return true;
  const c = e.client, exp = c.get("pbmini_exp"), sid = c.get("pbmini_sid");
  if ((typeof exp === "number" && exp > 0 && exp < Date.now()) || (sid && sidDenied(sid))) { c.discard(); return false; }
  return true;
}
// Hook onRecordAfterUpdateSuccess: si cambió la tokenKey (contraseña, correo, cerrar todo) los tokens ya no valen: sesiones vetadas y conexiones cortadas.
function onUserUpdated(e) {
  let changed = false;
  try { changed = e.record.original().tokenKey() !== e.record.tokenKey(); } catch (_) { changed = false; }
  if (changed) revokeAll($app, e.record.id);
}
function onUserDeleted(e) { revokeAll($app, e.record.id); }

function gc(app) { // sesiones vencidas (su token ya no vale) y vetos en memoria caducados
  if (!cfg().enabled) return;
  app.db().newQuery(`DELETE FROM ${COLL} WHERE expires < {:n}`).bind({ n: dt(Date.now()) }).execute();
  const st = app.store(), ks = st.keys(), now = Date.now();
  for (let i = 0; i < ks.length; i++) if (ks[i].indexOf(DENY) === 0 && Number(st.get(ks[i])) < now) st.remove(ks[i]);
}
// Login externo (p. ej. Mini App de Telegram): emite el token del usuario, con `sid` y sesión registrada si el módulo está activo. Nunca lanza por el registro de la sesión.
function issueFor(app, record, e) {
  const c = cfg(), std = record.newAuthToken();
  if (!c.enabled || record.collection().name !== c.collection) return std;
  try {
    const claims = claimsOf(std);
    if (!claims) throw new Error("token estándar ilegible");
    const col = record.collection(), now = Date.now(), exp = Number(claims.exp) * 1000, sid = $security.randomString(16);
    const token = $security.createJWT(Object.assign({}, claims, { sid }), record.tokenKey() + col.authToken.secret, Math.max(1, Math.floor((exp - now) / 1000)));
    const back = app.findAuthRecordByToken(token, "auth");
    if (!back || back.id !== record.id) throw new Error("PocketBase rechazó el token propio");
    const row = new Record(app.findCollectionByNameOrId(COLL));
    row.set("sid", sid); row.set("rid", record.id); row.set("coll", c.collection); row.set("revoked", false);
    row.set("ip", String(e.realIP() || "").replace(CTRL, "").slice(0, 64)); row.set("ua", String(e.request.header.get("User-Agent") || "").replace(CTRL, " ").slice(0, 200));
    row.set("expires", dt(isFinite(exp) ? exp : now + 14 * 86400000)); row.set("seen", dt(now));
    app.save(row);
    return token;
  } catch (err) { app.logger().error("pbmini sessions: login externo con el token estándar de PocketBase (sin sid)", "error", String(err)); return std; }
}
module.exports = { issueFor, ensure, loadDeny, issue, guard, verify, denied, list, revoke, revokeAll, logout, logoutEverywhere, gc, kick, tagClient, allowMessage, onUserUpdated, onUserDeleted, COLL };
