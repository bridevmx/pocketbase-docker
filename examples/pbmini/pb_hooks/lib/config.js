// Configuración opcional: pb_hooks/pbmini.config.js. Todo apagado por defecto; sin el archivo nada cambia respecto a un proyecto sin estos módulos.
//   module.exports = { access: {...}, sessions: {...}, mail: {...}, telegram: {...}, clip: {...}, spei: {...} }
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
function normalizeTelegram(t) {
  if (!isObj(t)) fail("telegram debe ser un objeto");
  only(t, ["enabled", "collection", "linkTtl", "actionTtl", "login", "groups", "limits", "retention"], "telegram");
  if (!t.enabled) return { enabled: false };
  const out = { enabled: true, collection: t.collection === undefined ? "users" : t.collection, linkTtl: t.linkTtl === undefined ? 600 : t.linkTtl, actionTtl: t.actionTtl === undefined ? 3600 : t.actionTtl };
  if (typeof out.collection !== "string" || !COLL.test(out.collection) || out.collection.charAt(0) === "_") fail("telegram.collection debe ser una colección de autenticación de usuario (no de sistema)");
  if (!Number.isInteger(out.linkTtl) || out.linkTtl < 60 || out.linkTtl > 3600) fail("telegram.linkTtl debe ser un entero de segundos 60..3600");
  if (!Number.isInteger(out.actionTtl) || out.actionTtl < 60 || out.actionTtl > 604800) fail("telegram.actionTtl debe ser un entero de segundos 60..604800");
  const lg = t.login === undefined ? {} : t.login;
  if (!isObj(lg)) fail("telegram.login debe ser un objeto");
  only(lg, ["enabled", "maxAge", "autoprovision", "singleUse", "perMinute"], "telegram.login");
  out.login = { enabled: lg.enabled === undefined ? false : lg.enabled, maxAge: lg.maxAge === undefined ? 600 : lg.maxAge, autoprovision: lg.autoprovision === undefined ? false : lg.autoprovision, singleUse: lg.singleUse === undefined ? true : lg.singleUse, perMinute: lg.perMinute === undefined ? 20 : lg.perMinute };
  if (typeof out.login.enabled !== "boolean" || typeof out.login.autoprovision !== "boolean" || typeof out.login.singleUse !== "boolean") fail("telegram.login.enabled, autoprovision y singleUse deben ser true o false");
  if (!Number.isInteger(out.login.perMinute) || out.login.perMinute < 1 || out.login.perMinute > 10000) fail("telegram.login.perMinute debe ser un entero 1..10000 (intentos por minuto y por IP)");
  if (!Number.isInteger(out.login.maxAge) || out.login.maxAge < 60 || out.login.maxAge > 86400) fail("telegram.login.maxAge debe ser un entero de segundos 60..86400");
  out.groups = Object.create(null);
  if (t.groups !== undefined) {
    if (!isObj(t.groups)) fail("telegram.groups debe ser {nombre: {field, values}}");
    const gk = Object.keys(t.groups);
    if (gk.length > 32) fail("telegram.groups admite como máximo 32 grupos");
    gk.forEach((g) => {
      if (!NAME.test(g)) fail(`telegram.groups: nombre de grupo inválido "${g}"`);
      const d = t.groups[g];
      if (!isObj(d)) fail(`telegram.groups.${g} debe ser {field, values}`);
      only(d, ["field", "values"], `telegram.groups.${g}`);
      out.groups[g] = { field: field(d.field, `telegram.groups.${g}.field`), values: names(d.values, `telegram.groups.${g}.values`, 16) };
    });
  }
  const lm = t.limits === undefined ? {} : t.limits;
  if (!isObj(lm)) fail("telegram.limits debe ser un objeto");
  only(lm, ["perChatPerMinute", "perHour", "perUserPerHour"], "telegram.limits");
  out.limits = { perChatPerMinute: lm.perChatPerMinute === undefined ? 20 : lm.perChatPerMinute, perHour: lm.perHour === undefined ? 3000 : lm.perHour, perUserPerHour: lm.perUserPerHour === undefined ? 30 : lm.perUserPerHour };
  [["perChatPerMinute", 60], ["perHour", 100000], ["perUserPerHour", 1000]].forEach(([k, max]) => { if (!Number.isInteger(out.limits[k]) || out.limits[k] < 1 || out.limits[k] > max) fail(`telegram.limits.${k} debe ser un entero 1..${max}`); });
  const rt = t.retention === undefined ? {} : t.retention;
  if (!isObj(rt)) fail("telegram.retention debe ser un objeto");
  only(rt, ["sentDays", "linksDays"], "telegram.retention");
  out.retention = { sentDays: rt.sentDays === undefined ? 7 : rt.sentDays, linksDays: rt.linksDays === undefined ? 1 : rt.linksDays };
  if (!Number.isInteger(out.retention.sentDays) || out.retention.sentDays < 1 || out.retention.sentDays > 365) fail("telegram.retention.sentDays debe ser un entero de días 1..365");
  if (!Number.isInteger(out.retention.linksDays) || out.retention.linksDays < 1 || out.retention.linksDays > 30) fail("telegram.retention.linksDays debe ser un entero de días 1..30");
  return out;
}
function normalizeClip(c) {
  if (!isObj(c)) fail("clip debe ser un objeto");
  only(c, ["enabled", "collection", "publicUrl", "referencePrefix", "methods", "openOnCardForm", "amount", "descriptionMax", "timeoutSeconds", "expiresInMinutes", "installmentsMsi", "international", "webhook", "create", "verify", "reconcile", "retention", "readRules"], "clip");
  if (typeof c.enabled !== "boolean") fail("clip.enabled debe ser true o false");
  if (!c.enabled) return { enabled: false };
  const sub = (v, keys, where) => { const o = v === undefined ? {} : v; if (!isObj(o)) fail(`${where} debe ser un objeto`); only(o, keys, where); return o; };
  const num = (v, def, lo, hi, where) => { const x = v === undefined ? def : v; if (!Number.isInteger(x) || x < lo || x > hi) fail(`${where} debe ser un entero ${lo}..${hi}`); return x; };
  const bool = (v, def, where) => { const x = v === undefined ? def : v; if (typeof x !== "boolean") fail(`${where} debe ser true o false`); return x; };
  const out = { enabled: true, collection: c.collection === undefined ? "users" : c.collection };
  if (typeof out.collection !== "string" || !COLL.test(out.collection) || out.collection.charAt(0) === "_") fail("clip.collection debe ser una colección de autenticación de usuario (no de sistema)");
  out.publicUrl = c.publicUrl === undefined ? "" : c.publicUrl;
  if (typeof out.publicUrl !== "string" || out.publicUrl.length > 200) fail("clip.publicUrl debe ser una URL https base (o usa la variable CLIP_PUBLIC_URL)");
  out.referencePrefix = c.referencePrefix === undefined ? "PBM" : c.referencePrefix;
  if (typeof out.referencePrefix !== "string" || !/^[A-Z]{2,6}$/.test(out.referencePrefix)) fail("clip.referencePrefix debe ser de 2 a 6 letras mayúsculas");
  out.methods = c.methods === undefined ? ["credit", "debit"] : c.methods;
  if (!Array.isArray(out.methods) || out.methods.length < 1 || out.methods.length > 3 || new Set(out.methods).size !== out.methods.length || out.methods.some((m) => ["credit", "debit", "cash"].indexOf(m) < 0)) fail('clip.methods debe ser una lista sin repetidos de "credit", "debit" o "cash"');
  out.openOnCardForm = bool(c.openOnCardForm, true, "clip.openOnCardForm");
  const am = sub(c.amount, ["min", "max"], "clip.amount");
  out.amount = { min: num(am.min, 100, 100, 100000000, "clip.amount.min (centavos)"), max: num(am.max, 5000000, 100, 100000000, "clip.amount.max (centavos)") };
  if (out.amount.min > out.amount.max) fail("clip.amount.min no puede superar a clip.amount.max");
  out.descriptionMax = num(c.descriptionMax, 250, 1, 250, "clip.descriptionMax");
  out.timeoutSeconds = num(c.timeoutSeconds, 8, 1, 30, "clip.timeoutSeconds");
  out.expiresInMinutes = c.expiresInMinutes === undefined || c.expiresInMinutes === null ? null : num(c.expiresInMinutes, 0, 2, 1440, "clip.expiresInMinutes");
  if (c.installmentsMsi === undefined || c.installmentsMsi === null) out.installmentsMsi = null;
  else {
    if (!Array.isArray(c.installmentsMsi) || c.installmentsMsi.length < 1 || c.installmentsMsi.length > 6 || new Set(c.installmentsMsi).size !== c.installmentsMsi.length || c.installmentsMsi.some((x) => [3, 6, 9, 12, 18, 24].indexOf(x) < 0)) fail("clip.installmentsMsi debe ser una lista sin repetidos de 3, 6, 9, 12, 18 o 24 (o null)");
    out.installmentsMsi = c.installmentsMsi.slice();
  }
  out.international = bool(c.international, false, "clip.international");
  const wh = sub(c.webhook, ["path", "maxBytes", "perIpPerMin"], "clip.webhook");
  out.webhook = { path: wh.path === undefined ? "/_clip/webhook" : wh.path, maxBytes: num(wh.maxBytes, 2048, 256, 16384, "clip.webhook.maxBytes"), perIpPerMin: num(wh.perIpPerMin, 120, 1, 10000, "clip.webhook.perIpPerMin") };
  if (typeof out.webhook.path !== "string" || !/^\/_[a-z0-9][a-z0-9_-]{0,30}(\/[a-z0-9][a-z0-9_-]{0,30}){0,2}$/.test(out.webhook.path) || /^\/_telegram(\/|$)/.test(out.webhook.path)) fail("clip.webhook.path debe empezar por /_ (p. ej. /_clip/webhook), en minúsculas, y no puede ser una ruta de otro módulo");
  const cr = sub(c.create, ["perUserPerMin", "maxPendingPerUser"], "clip.create");
  out.create = { perUserPerMin: num(cr.perUserPerMin, 5, 1, 100, "clip.create.perUserPerMin"), maxPendingPerUser: num(cr.maxPendingPerUser, 10, 1, 100, "clip.create.maxPendingPerUser") };
  const vf = sub(c.verify, ["minIntervalMs", "perUserPerMin"], "clip.verify");
  out.verify = { minIntervalMs: num(vf.minIntervalMs, 2000, 500, 60000, "clip.verify.minIntervalMs"), perUserPerMin: num(vf.perUserPerMin, 30, 1, 1000, "clip.verify.perUserPerMin") };
  const rc = sub(c.reconcile, ["cron", "windowHours", "batch", "staleCreatedMinutes", "minAgeMinutes"], "clip.reconcile");
  out.reconcile = { cron: rc.cron === undefined ? "*/2 * * * *" : rc.cron, windowHours: num(rc.windowHours, 72, 1, 168, "clip.reconcile.windowHours"), batch: num(rc.batch, 50, 1, 500, "clip.reconcile.batch"),
    staleCreatedMinutes: num(rc.staleCreatedMinutes, 10, 1, 1440, "clip.reconcile.staleCreatedMinutes"), minAgeMinutes: num(rc.minAgeMinutes, 1, 0, 60, "clip.reconcile.minAgeMinutes") };
  if (!require(`${__hooks}/lib/cron.js`).valid(out.reconcile.cron)) fail('clip.reconcile.cron inválido (5 campos "m h dom mon dow" o un macro como @hourly)');
  const rt = sub(c.retention, ["failedDays", "paidDays"], "clip.retention");
  out.retention = { failedDays: num(rt.failedDays, 90, 1, 3650, "clip.retention.failedDays"), paidDays: num(rt.paidDays, 0, 0, 3650, "clip.retention.paidDays (0 = conservar)") };
  out.readRules = bool(c.readRules, false, "clip.readRules");
  return out;
}
function normalizeSpei(c) {
  if (!isObj(c)) fail("spei debe ser un objeto");
  only(c, ["enabled", "collection", "accountsFile", "amount", "orderTtlHours", "report", "banxico", "reconcile", "vision", "retention", "readRules", "uniqueCents"], "spei");
  if (typeof c.enabled !== "boolean") fail("spei.enabled debe ser true o false");
  if (!c.enabled) return { enabled: false };
  const sub = (v, keys, where) => { const o = v === undefined ? {} : v; if (!isObj(o)) fail(`${where} debe ser un objeto`); only(o, keys, where); return o; };
  const num = (v, def, lo, hi, where) => { const x = v === undefined ? def : v; if (!Number.isInteger(x) || x < lo || x > hi) fail(`${where} debe ser un entero ${lo}..${hi}`); return x; };
  const bool = (v, def, where) => { const x = v === undefined ? def : v; if (typeof x !== "boolean") fail(`${where} debe ser true o false`); return x; };
  const out = { enabled: true, collection: c.collection === undefined ? "users" : c.collection };
  if (typeof out.collection !== "string" || !COLL.test(out.collection) || out.collection.charAt(0) === "_") fail("spei.collection debe ser una colección de autenticación de usuario (no de sistema)");
  out.accountsFile = c.accountsFile === undefined ? "spei.accounts.json" : c.accountsFile;
  if (typeof out.accountsFile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/.test(out.accountsFile)) fail("spei.accountsFile debe ser un nombre de archivo .json dentro de pb_hooks (sin rutas)");
  const am = sub(c.amount, ["min", "max"], "spei.amount");
  out.amount = { min: num(am.min, 100, 1, 100000000, "spei.amount.min (centavos)"), max: num(am.max, 5000000, 1, 100000000, "spei.amount.max (centavos)") };
  if (out.amount.min > out.amount.max) fail("spei.amount.min no puede superar a spei.amount.max");
  out.orderTtlHours = num(c.orderTtlHours, 24, 1, 168, "spei.orderTtlHours");
  const rp = sub(c.report, ["perUserPerMin", "maxReportsPerOrder", "maxPendingPerUser"], "spei.report");
  out.report = { perUserPerMin: num(rp.perUserPerMin, 6, 1, 1000, "spei.report.perUserPerMin"), maxReportsPerOrder: num(rp.maxReportsPerOrder, 5, 1, 20, "spei.report.maxReportsPerOrder"), maxPendingPerUser: num(rp.maxPendingPerUser, 10, 1, 100, "spei.report.maxPendingPerUser") };
  const bx = sub(c.banxico, ["timeoutSeconds", "minIntervalMs", "perMinute"], "spei.banxico");
  out.banxico = { timeoutSeconds: num(bx.timeoutSeconds, 15, 1, 30, "spei.banxico.timeoutSeconds"), minIntervalMs: num(bx.minIntervalMs, 3000, 500, 60000, "spei.banxico.minIntervalMs"), perMinute: num(bx.perMinute, 20, 1, 600, "spei.banxico.perMinute") };
  const rc = sub(c.reconcile, ["cron", "batch", "maxTries", "retryMinutes"], "spei.reconcile");
  out.reconcile = { cron: rc.cron === undefined ? "*/3 * * * *" : rc.cron, batch: num(rc.batch, 20, 1, 200, "spei.reconcile.batch"), maxTries: num(rc.maxTries, 10, 1, 100, "spei.reconcile.maxTries"), retryMinutes: num(rc.retryMinutes, 5, 1, 1440, "spei.reconcile.retryMinutes") };
  if (!require(`${__hooks}/lib/cron.js`).valid(out.reconcile.cron)) fail('spei.reconcile.cron inválido (5 campos "m h dom mon dow" o un macro como @hourly)');
  const vs = sub(c.vision, ["enabled", "provider", "maxKB", "timeoutSeconds", "perUserPerMin", "maxPerOrder", "minConfidence"], "spei.vision");
  if (vs.provider !== undefined && ["omnirouter", "google"].indexOf(vs.provider) < 0) fail('spei.vision.provider debe ser "omnirouter" o "google" (el plugin ai)');
  out.vision = { enabled: bool(vs.enabled, false, "spei.vision.enabled"), provider: vs.provider === undefined ? "omnirouter" : vs.provider, maxKB: num(vs.maxKB, 4096, 64, 8192, "spei.vision.maxKB"), timeoutSeconds: num(vs.timeoutSeconds, 25, 5, 60, "spei.vision.timeoutSeconds"),
    perUserPerMin: num(vs.perUserPerMin, 4, 1, 100, "spei.vision.perUserPerMin"), maxPerOrder: num(vs.maxPerOrder, 5, 1, 200, "spei.vision.maxPerOrder"), minConfidence: num(vs.minConfidence, 50, 1, 100, "spei.vision.minConfidence (porcentaje)") };
  const rt = sub(c.retention, ["failedDays", "paidDays"], "spei.retention");
  out.retention = { failedDays: num(rt.failedDays, 90, 1, 3650, "spei.retention.failedDays"), paidDays: num(rt.paidDays, 0, 0, 3650, "spei.retention.paidDays (0 = conservar)") };
  out.readRules = bool(c.readRules, false, "spei.readRules");
  const uc = sub(c.uniqueCents, ["enabled", "max"], "spei.uniqueCents"); // centavos únicos por orden (p. ej. $300.37): dos órdenes abiertas de una cuenta nunca tienen el mismo monto
  out.uniqueCents = { enabled: bool(uc.enabled, false, "spei.uniqueCents.enabled"), max: num(uc.max, 99, 1, 99, "spei.uniqueCents.max") };
  return out;
}
function normalizeAi(c) {
  if (!isObj(c)) fail("ai debe ser un objeto");
  only(c, ["enabled", "timeoutSeconds", "perMinute", "perUserPerMin", "maxOutputTokens", "maxInputChars", "maxImageKB"], "ai");
  if (typeof c.enabled !== "boolean") fail("ai.enabled debe ser true o false");
  if (!c.enabled) return { enabled: false };
  const num = (v, def, lo, hi, where) => { const x = v === undefined ? def : v; if (!Number.isInteger(x) || x < lo || x > hi) fail(`${where} debe ser un entero ${lo}..${hi}`); return x; };
  return { enabled: true, timeoutSeconds: num(c.timeoutSeconds, 45, 5, 120, "ai.timeoutSeconds (por modelo)"), perMinute: num(c.perMinute, 30, 1, 600, "ai.perMinute"), perUserPerMin: num(c.perUserPerMin, 6, 1, 100, "ai.perUserPerMin"),
    maxOutputTokens: num(c.maxOutputTokens, 2048, 256, 8192, "ai.maxOutputTokens"), maxInputChars: num(c.maxInputChars, 6000, 1, 20000, "ai.maxInputChars"), maxImageKB: num(c.maxImageKB, 4096, 64, 8192, "ai.maxImageKB") };
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
  only(raw, ["access", "sessions", "mail", "telegram", "clip", "spei", "ai"], "pbmini.config.js");
  return (_cfg = {
    access: normalizeAccess(raw.access === undefined ? { enabled: false } : raw.access),
    sessions: normalizeSessions(raw.sessions === undefined ? { enabled: false } : raw.sessions),
    mail: normalizeMail(raw.mail === undefined ? {} : raw.mail),
    telegram: normalizeTelegram(raw.telegram === undefined ? { enabled: false } : raw.telegram),
    clip: normalizeClip(raw.clip === undefined ? { enabled: false } : raw.clip),
    spei: normalizeSpei(raw.spei === undefined ? { enabled: false } : raw.spei),
    ai: normalizeAi(raw.ai === undefined ? { enabled: false } : raw.ai),
  });
}
module.exports = { load };
