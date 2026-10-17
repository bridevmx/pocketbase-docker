// Configuración opcional: pb_hooks/pbmini.config.js. Todo apagado por defecto; sin el archivo nada cambia respecto a un proyecto sin estos módulos.
//   module.exports = { access: {...}, sessions: {...}, mail: {...} }
// Claves desconocidas, tipos incorrectos o valores fuera de rango abortan el arranque (una opción ignorada podría desactivar un control).
const NAME = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const COLL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const fail = (m) => { throw new Error("pbmini config: " + m); };
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function only(o, keys, where) { Object.keys(o).forEach((k) => { if (keys.indexOf(k) < 0) fail(`${where}: opción desconocida "${k}"`); }); }
function names(v, where, max) {
  if (!Array.isArray(v) || v.length === 0 || v.length > (max || 32) || v.some((x) => typeof x !== "string" || !NAME.test(x)) || new Set(v).size !== v.length) fail(`${where} debe ser una lista de 1..${max || 32} nombres únicos (minúsculas, dígitos, _ . : -)`);
  return v.slice();
}
function field(v, where) { if (typeof v !== "string" || !FIELD.test(v)) fail(`${where} debe ser un nombre de campo válido`); return v; }

function normalizeAccess(a) {
  if (!isObj(a)) fail("access debe ser un objeto");
  only(a, ["enabled", "mode", "collection", "field", "roles", "rolesField", "permissions", "permissionsField", "extraPermissions", "planField", "planOrder", "expiresField", "grace", "statusField", "blockedStatuses"], "access");
  if (!a.enabled) return { enabled: false };
  if (a.mode !== "role" && a.mode !== "membership") fail('access.mode debe ser "role" o "membership"');
  const out = { enabled: true, mode: a.mode, collection: a.collection === undefined ? "users" : a.collection };
  if (typeof out.collection !== "string" || !COLL.test(out.collection) || out.collection.charAt(0) === "_") fail("access.collection debe ser una colección de autenticación de usuario (no de sistema)");
  out.roles = names(a.roles, "access.roles");
  if (a.mode === "role") {
    ["rolesField", "permissions", "permissionsField", "extraPermissions", "planField", "planOrder", "expiresField", "grace", "statusField", "blockedStatuses"].forEach((k) => { if (a[k] !== undefined) fail(`access.${k} solo existe en mode "membership"`); });
    out.field = field(a.field, "access.field");
    return out;
  }
  if (a.field !== undefined) fail('access.field es del modo "role"; en "membership" usa rolesField');
  out.rolesField = field(a.rolesField, "access.rolesField");
  out.permissions = Object.create(null); out.known = [];
  if (a.permissions !== undefined) {
    if (!isObj(a.permissions)) fail("access.permissions debe ser {rol: [permisos]}");
    Object.keys(a.permissions).forEach((r) => {
      if (out.roles.indexOf(r) < 0) fail(`access.permissions: el rol "${r}" no está en access.roles`);
      const ps = a.permissions[r];
      if (!Array.isArray(ps) || ps.length > 64 || ps.some((x) => x !== "*" && (typeof x !== "string" || !NAME.test(x)))) fail(`access.permissions.${r} debe ser una lista de permisos (o "*")`);
      out.permissions[r] = ps.slice(); ps.forEach((x) => { if (x !== "*" && out.known.indexOf(x) < 0) out.known.push(x); });
    });
  }
  if (a.extraPermissions !== undefined) names(a.extraPermissions, "access.extraPermissions", 64).forEach((x) => { if (out.known.indexOf(x) < 0) out.known.push(x); });
  if (a.permissionsField !== undefined) out.permissionsField = field(a.permissionsField, "access.permissionsField");
  if (a.planField !== undefined) {
    out.planField = field(a.planField, "access.planField"); out.planOrder = names(a.planOrder, "access.planOrder", 16);
    if (a.expiresField !== undefined) out.expiresField = field(a.expiresField, "access.expiresField");
    if (a.grace !== undefined && (!Number.isInteger(a.grace) || a.grace < 0 || a.grace > 365)) fail("access.grace debe ser un entero de días 0..365");
    out.grace = a.grace || 0;
  } else ["planOrder", "expiresField", "grace"].forEach((k) => { if (a[k] !== undefined) fail(`access.${k} requiere access.planField`); });
  if (a.statusField !== undefined) { out.statusField = field(a.statusField, "access.statusField"); out.blocked = a.blockedStatuses === undefined ? ["suspended", "banned", "blocked"] : names(a.blockedStatuses, "access.blockedStatuses", 16); }
  else if (a.blockedStatuses !== undefined) fail("access.blockedStatuses requiere access.statusField");
  return out;
}
function normalizeSessions(s) {
  if (!isObj(s)) fail("sessions debe ser un objeto");
  only(s, ["enabled", "collection", "legacy", "realtime"], "sessions");
  if (!s.enabled) return { enabled: false };
  const out = { enabled: true, collection: s.collection === undefined ? "users" : s.collection, legacy: s.legacy === undefined ? "allow" : s.legacy, realtime: s.realtime === undefined ? true : s.realtime };
  if (typeof out.realtime !== "boolean") fail("sessions.realtime debe ser true o false");
  if (typeof out.collection !== "string" || !COLL.test(out.collection) || out.collection.charAt(0) === "_") fail("sessions.collection debe ser una colección de autenticación de usuario (no de sistema)");
  if (out.legacy !== "allow" && out.legacy !== "deny") fail('sessions.legacy debe ser "allow" o "deny"');
  return out;
}
function normalizeMail(m) {
  if (!isObj(m)) fail("mail debe ser un objeto");
  only(m, ["maxPerRecipientPerHour", "maxPerHour"], "mail");
  const out = { maxPerRecipientPerHour: m.maxPerRecipientPerHour === undefined ? 5 : m.maxPerRecipientPerHour, maxPerHour: m.maxPerHour === undefined ? 200 : m.maxPerHour };
  ["maxPerRecipientPerHour", "maxPerHour"].forEach((k) => { if (!Number.isInteger(out[k]) || out[k] < 1 || out[k] > 100000) fail(`mail.${k} debe ser un entero 1..100000`); });
  return out;
}

let _cfg = null; // por runtime
function load() {
  if (_cfg) return _cfg;
  const f = `${__hooks}/pbmini.config.js`;
  const raw = exists(f) ? require(f) : {};
  if (!isObj(raw)) fail("pbmini.config.js debe exportar un objeto");
  only(raw, ["access", "sessions", "mail"], "pbmini.config.js");
  return (_cfg = {
    access: normalizeAccess(raw.access === undefined ? { enabled: false } : raw.access),
    sessions: normalizeSessions(raw.sessions === undefined ? { enabled: false } : raw.sessions),
    mail: normalizeMail(raw.mail === undefined ? {} : raw.mail),
  });
}
module.exports = { load };
