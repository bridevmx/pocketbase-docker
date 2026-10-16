// Módulo opcional de acceso por roles / membresías (apagado por defecto; ver pbmini.config.js).
// Solo LEE campos que ya existen en tu colección de usuarios (no crea tablas ni columnas) y solo protege rutas de pbmini.
// La API nativa de PocketBase no pasa por aquí: espeja las mismas condiciones en las reglas de la colección (`@request.auth.plan = ...`).
// Todo es fail-closed: campo ausente, valor desconocido o fecha inválida => se trata como "sin permiso" / plan base.
const cfg = () => require(`${__hooks}/lib/config.js`).load().access;
const NAME = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const fail = (m) => { throw new Error(m); };
const KINDS = ["role", "permission", "plan", "any", "all"];

// Valida la opción `access` de una ruta al registrar (aborta el arranque si algo no cuadra con pbmini.config.js).
function validateSpec(spec, failFn, depth) {
  const f = failFn || ((m) => fail("pbmini: " + m)), c = cfg();
  if (!c.enabled) f("`access` declarado pero el módulo está apagado (pbmini.config.js: access.enabled)");
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) f("access debe ser un objeto con una sola condición: {role}|{permission}|{plan}|{any:[..]}|{all:[..]}");
  const keys = Object.keys(spec);
  if (keys.length !== 1 || KINDS.indexOf(keys[0]) < 0) f(`access: una sola condición entre ${KINDS.join(", ")} (recibido: ${keys.join(", ") || "nada"})`);
  const k = keys[0], v = spec[k];
  if (k === "any" || k === "all") {
    if ((depth || 0) >= 2) f("access: anidamiento máximo de 2 niveles");
    if (!Array.isArray(v) || v.length === 0 || v.length > 16) f(`access.${k} debe ser una lista de 1..16 condiciones`);
    v.forEach((x) => validateSpec(x, f, (depth || 0) + 1));
    return;
  }
  if (typeof v !== "string" || !NAME.test(v)) f(`access.${k} debe ser un nombre válido`);
  if (k === "role" && c.roles.indexOf(v) < 0) f(`access.role "${v}" no está en access.roles de pbmini.config.js`);
  if (c.mode === "role" && k !== "role") f(`en mode "role" solo se admite {role}; "${k}" requiere mode "membership"`);
  if (k === "permission" && c.known.indexOf(v) < 0) f(`access.permission "${v}" no está declarado en access.permissions / extraPermissions`);
  if (k === "plan" && (!c.planOrder || c.planOrder.indexOf(v) < 0)) f(`access.plan "${v}" no está en access.planOrder`);
}

const list = (v) => { // select múltiple (arreglo) o texto "a, b"; solo cadenas razonables
  let a = [];
  if (Array.isArray(v)) a = v; else if (typeof v === "string" && v) a = v.split(",");
  else if (v && typeof v === "object" && typeof v.length === "number") { for (let i = 0; i < v.length; i++) a.push(v[i]); }
  return a.map((x) => String(x).trim()).filter((x) => NAME.test(x)).slice(0, 64);
};
function dateMs(v) { // campo date de PocketBase => ms, o NaN
  const s = String(v == null ? "" : v);
  if (!s || s === "null") return NaN;
  return new Date(s.replace(" ", "T")).getTime();
}

let _ce = null, _cm = null;
const remember = (e, m) => { _ce = e; _cm = m; return m; };
// Resumen de la membresía del usuario autenticado (se calcula una vez por petición y se guarda en el evento).
function membership(e) {
  const c = cfg();
  if (!c.enabled || !e.auth) return null;
  if (_ce === e) return _cm; // misma petición (cada VM atiende una a la vez; no se usa e.set: convertiría los arreglos a tipos de Go)
  const rec = e.auth, m = { superuser: false, roles: [], permissions: [], plan: null, expired: false, blocked: false, valid: true };
  if (e.hasSuperuserAuth()) { m.superuser = true; return remember(e, m); }
  if (rec.collection().name !== c.collection) { m.valid = false; return remember(e, m); }
  const known = (r) => c.roles.indexOf(r) >= 0;
  if (c.mode === "role") m.roles = list(rec.get(c.field)).filter(known);
  else {
    m.roles = list(rec.get(c.rolesField)).filter(known);
    const perms = [];
    m.roles.forEach((r) => (c.permissions[r] || []).forEach((p) => perms.push(p)));
    if (c.permissionsField) list(rec.get(c.permissionsField)).forEach((p) => { if (c.known.indexOf(p) >= 0) perms.push(p); });
    m.permissions = perms.indexOf("*") >= 0 ? c.known.slice() : perms.filter((p, i) => perms.indexOf(p) === i);
    if (c.statusField && c.blocked.indexOf(String(rec.get(c.statusField) || "").toLowerCase()) >= 0) m.blocked = true;
    if (c.planField) {
      const order = c.planOrder; let plan = String(rec.get(c.planField) || "");
      if (order.indexOf(plan) < 0) plan = order[0]; // valor desconocido o vacío => plan base
      if (order.indexOf(plan) > 0) { // los planes de pago necesitan una fecha de vencimiento vigente; sin fecha válida se consideran vencidos
        const exp = c.expiresField ? dateMs(rec.get(c.expiresField)) : Infinity;
        if (!(exp + c.grace * 86400000 >= Date.now())) { m.expired = true; plan = order[0]; }
      }
      m.plan = plan;
    }
  }
  return remember(e, m);
}

// Evalúa una condición. Devuelve null (permitido) o {status, code}.
function evalCond(c, m, spec) {
  const k = Object.keys(spec)[0], v = spec[k], deny = { status: 403, code: "forbidden" };
  if (k === "role") return m.roles.indexOf(v) >= 0 ? null : deny;
  if (k === "permission") return m.permissions.indexOf(v) >= 0 ? null : deny;
  if (k === "plan") {
    if (m.plan !== null && c.planOrder.indexOf(m.plan) >= c.planOrder.indexOf(v)) return null;
    return { status: 402, code: m.expired ? "membership_expired" : "plan_required" };
  }
  const results = v.map((x) => evalCond(c, m, x));
  if (k === "all") return results.find((r) => r) || null;
  if (results.some((r) => r === null)) return null;
  return results.find((r) => r.status === 402) || deny; // any: si falló por plan, el 402 informa mejor que el 403
}
function check(e, spec) {
  const c = cfg(), m = membership(e);
  if (!m) return { status: 401, code: "unauthorized" };
  if (m.superuser) return null;
  if (!m.valid || m.blocked) return { status: 403, code: m.blocked ? "account_blocked" : "forbidden" };
  return evalCond(c, m, spec);
}
const can = (e, perm) => { const m = membership(e); return !!m && (m.superuser || m.permissions.indexOf(perm) >= 0); };
const hasRole = (e, role) => { const m = membership(e); return !!m && (m.superuser || m.roles.indexOf(role) >= 0); };

// Al servir: los campos configurados deben existir en la colección (si no, el módulo estaría denegando todo sin avisar).
function validateSchema(app) {
  const c = cfg();
  if (!c.enabled) return;
  const col = app.findCollectionByNameOrId(c.collection);
  if (col.type !== "auth") fail(`pbmini access: la colección "${c.collection}" no es de autenticación`);
  [c.field, c.rolesField, c.permissionsField, c.planField, c.expiresField, c.statusField].forEach((f) => { if (f && !col.fields.getByName(f)) fail(`pbmini access: la colección "${c.collection}" no tiene el campo "${f}"`); });
}
module.exports = { validateSpec, check, can, hasRole, membership, validateSchema };
