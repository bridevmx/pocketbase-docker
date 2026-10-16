// Módulo opcional de sesiones revocables (apagado por defecto; ver pbmini.config.js). Alcance: rutas de pbmini y cookie `pb_auth`.
//  - Funciona sobre un proyecto ya existente: al activarlo crea (de forma idempotente) la colección `pbmini_sessions` (reglas null = solo superuser)
//    y no toca tu colección de usuarios. Apagarlo devuelve el comportamiento anterior; no borra datos.
//  - Guarda sha256(token), nunca el token. El registro lo hace el hook nativo onRecordAuthRequest (contraseña, OTP, OAuth2 y refresh).
//  - Límite explícito: la API nativa /api/* sigue aceptando un token revocado hasta que expire. Para invalidar TODOS los tokens: ctx.logoutEverywhere().
//  - legacy: "allow" (por defecto) respeta los tokens emitidos antes de activar el módulo (no cierra la sesión a todo el mundo); "deny" los rechaza.
const cfg = () => require(`${__hooks}/lib/config.js`).load().sessions;
const COLL = "pbmini_sessions";
const CTRL = /[\x00-\x1f\x7f]/g;
const hashOf = (t) => $security.sha256(t);
const dt = (ms) => new Date(ms).toISOString().replace("T", " ");

function ensure(app) { // idempotente: crea la colección solo si no existe
  try { app.findCollectionByNameOrId(COLL); return; } catch (_) { /* no existe */ }
  const c = new Collection({
    type: "base", name: COLL, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "rid", type: "text", required: true, max: 30 }, { name: "coll", type: "text", max: 64 }, { name: "hash", type: "text", required: true, max: 64 },
      { name: "ip", type: "text", max: 64 }, { name: "ua", type: "text", max: 200 }, { name: "expires", type: "date" }, { name: "seen", type: "date" },
      { name: "revoked", type: "bool" }, { name: "olds", type: "text", max: 2000 }, { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [`CREATE UNIQUE INDEX idx_${COLL}_hash ON ${COLL} (hash)`, `CREATE INDEX idx_${COLL}_rid ON ${COLL} (rid)`],
  });
  app.save(c);
}

// Hook nativo: registra (o rota, en un refresh) la sesión asociada al token recién emitido.
function track(e) {
  const c = cfg();
  if (!c.enabled || e.record.collection().name !== c.collection || !e.token) return;
  try {
    const re = e.requestEvent || e; // el evento de autenticación envuelve al RequestEvent
    const claims = $security.parseUnverifiedJWT(e.token), exp = Number(claims.exp) * 1000;
    const old = String(re.request.header.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const now = Date.now(), fields = { hash: hashOf(e.token), expires: dt(isFinite(exp) ? exp : now + 14 * 86400000), seen: dt(now) };
    let row = null;
    if (old) { try { row = $app.findFirstRecordByFilter(COLL, "(hash = {:h} || olds ~ {:h}) && rid = {:r}", { h: hashOf(old), r: e.record.id }); } catch (_) { row = null; } }
    if ($os.getenv("PBMINI_DEBUG") === "1") console.log("pbmini sessions track:", e.record.id, "old=" + (old ? old.slice(-8) : "-"), "found=" + !!row);
    if (!row) {
      row = new Record($app.findCollectionByNameOrId(COLL));
      row.set("rid", e.record.id); row.set("coll", c.collection); row.set("revoked", false);
      row.set("ip", String(re.realIP() || "").replace(CTRL, "").slice(0, 64));
      row.set("ua", String(re.request.header.get("User-Agent") || "").replace(CTRL, " ").slice(0, 200));
    }
    if (old) { // refresh: el token anterior sigue asociado a la misma sesión (si se revoca, se revocan todos)
      const prev = row.getString("hash");
      if (prev && prev !== fields.hash) row.set("olds", (row.getString("olds") + " " + prev).trim().split(" ").slice(-20).join(" "));
    }
    Object.keys(fields).forEach((k) => row.set(k, fields[k]));
    $app.save(row);
  } catch (err) { $app.logger().error("pbmini sessions: no se pudo registrar la sesión", "error", String(err)); } // nunca rompe el inicio de sesión
}

// true => el token sigue siendo válido para pbmini. Se llama desde cookieAuth con el token ya validado por PocketBase.
function verify(e, token) {
  const c = cfg();
  if (!c.enabled || !e.auth || e.hasSuperuserAuth() || e.auth.collection().name !== c.collection) return true;
  const h = hashOf(token); e.set("pbmini_token_hash", h);
  let row = null;
  try { row = $app.findFirstRecordByFilter(COLL, "hash = {:h} || olds ~ {:h}", { h }); } catch (_) { row = null; }
  if (!row) return c.legacy === "allow";
  if (row.getBool("revoked") || row.getString("rid") !== e.auth.id) return false;
  try { if (Date.now() - new Date(String(row.get("seen")).replace(" ", "T")).getTime() > 300000) { row.set("seen", dt(Date.now())); $app.save(row); } } catch (_) { /* es solo informativo */ }
  return true;
}

function requireWrite(route) { if (route.method === "GET") throw new Error("pbmini: esta operación no se permite en GET (CSRF)"); }
function list(e) {
  if (!cfg().enabled) throw new Error("pbmini: sessions está apagado (pbmini.config.js)");
  if (!e.auth) return [];
  const cur = e.get("pbmini_token_hash");
  return $app.findRecordsByFilter(COLL, "rid = {:r} && revoked = false && expires > {:n}", "-created", 50, 0, { r: e.auth.id, n: dt(Date.now()) })
    .map((r) => ({ id: r.id, ip: r.getString("ip"), userAgent: r.getString("ua"), created: String(r.get("created")), lastSeen: String(r.get("seen")), current: r.getString("hash") === cur }));
}
function revoke(e, route, id) { // solo sesiones propias; ajenas o inexistentes => false sin distinguirlas
  requireWrite(route);
  if (!cfg().enabled) throw new Error("pbmini: sessions está apagado (pbmini.config.js)");
  if (!e.auth || typeof id !== "string" || !/^[a-z0-9]{15}$/.test(id)) return false;
  let row; try { row = $app.findRecordById(COLL, id); } catch (_) { return false; }
  if (row.getString("rid") !== e.auth.id) return false;
  row.set("revoked", true); $app.save(row); return true;
}
const clearCookie = (e) => e.response.header().set("Set-Cookie", "pb_auth=; Path=/; Max-Age=0; SameSite=Lax");
function logout(e, route) { // cierra la sesión actual: marca la fila (si el módulo está activo) y expira la cookie
  requireWrite(route);
  const h = e.get("pbmini_token_hash");
  if (cfg().enabled && h) { try { const row = $app.findFirstRecordByFilter(COLL, "hash = {:h} || olds ~ {:h}", { h }); row.set("revoked", true); $app.save(row); } catch (_) { /* sin fila */ } }
  clearCookie(e);
}
function logoutEverywhere(e, route) { // invalida TODOS los tokens del usuario (nativo: cambia su tokenKey) y marca sus sesiones
  requireWrite(route);
  if (!e.auth || e.hasSuperuserAuth()) throw new Error("pbmini: logoutEverywhere requiere un usuario autenticado");
  const rec = e.auth;
  rec.refreshTokenKey(); $app.save(rec);
  if (cfg().enabled) { try { $app.db().newQuery(`UPDATE ${COLL} SET revoked = 1 WHERE rid = {:r}`).bind({ r: rec.id }).execute(); } catch (_) { /* sin tabla */ } }
  clearCookie(e);
}
function gc(app) { // filas vencidas (el token ya no sirve) o revocadas hace más de 30 días
  if (!cfg().enabled) return;
  app.db().newQuery(`DELETE FROM ${COLL} WHERE expires < {:n}`).bind({ n: dt(Date.now() - 30 * 86400000) }).execute();
}
module.exports = { ensure, track, verify, list, revoke, logout, logoutEverywhere, gc, COLL };
