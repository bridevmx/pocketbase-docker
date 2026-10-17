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
  return a.map((x) => String(x).trim().toLowerCase()).filter((x) => NAME.test(x)).slice(0, 64); // sin distinguir mayúsculas: igual que ~ en las reglas de PocketBase
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
// ---- cuenta bloqueada (statusField) ------------------------------------------------------------------------------------------------
const isBlocked = (rec) => { const c = cfg(); return !!(c.enabled && c.statusField && c.blocked.indexOf(String(rec.get(c.statusField) || "").toLowerCase()) >= 0); };
// Hook onRecordAuthRequest (login por cualquier método y refresh): una cuenta bloqueada no obtiene token. Equivale a un authRule de PocketBase.
function guardAuth(e) { if (isBlocked(e.record)) throw new ForbiddenError("This account is blocked."); }
// Hook onRecordAfterUpdateSuccess: al bloquear una cuenta se vetan todas sus sesiones (rutas de pbmini y API nativa; requiere el módulo sessions).
function onUserSaved(e) { if (isBlocked(e.record)) { try { require(`${__hooks}/lib/sessions.js`).revokeAll($app, e.record.id); } catch (err) { $app.logger().error("pbmini access: no se pudieron vetar las sesiones", "error", String(err)); } } }

// ---- reglas equivalentes de PocketBase (para la API nativa, que no pasa por `access`) ---------------------------------------------
// Formas elegidas tras MEDIRLAS contra PocketBase (lab, sección A):
//   · `@request.auth.<select> ?= "x"` NO funciona (siempre falso). Un select múltiple se guarda como JSON ["a","b"]: se usa `~ '"x"'` (token exacto entre comillas).
//   · `=` sobre texto distingue mayúsculas; `~` no. Las listas en campos de texto ("a,b") se comparan por token exacto con `:lower` y comas SIN espacios.
//   · PocketBase solo tiene @yesterday/@now: la gracia de vencimiento se expresa como máximo con 1 día.
// Devuelve líneas de texto. Es una AYUDA: revísala antes de pegarla. Las reglas nunca deben ser MÁS permisivas que `access` (la prueba del laboratorio lo comprueba).
function rules(table) {
  const c = cfg(), out = [], warn = [];
  if (!c.enabled) return ["# access está apagado (pbmini.config.js): no hay reglas que generar."];
  const A = (f) => "@request.auth." + f, q = (v) => JSON.stringify(v);
  const fieldType = (name) => { // tipo real del campo si hay base de datos; si no, suposiciones prudentes
    try { const f = $app.findCollectionByNameOrId(c.collection).fields.getByName(name); return f ? { type: f.type(), multi: Number(f.maxSelect || 1) > 1 } : null; } catch (_) { return null; }
  };
  const textList = (f, token) => { const F = A(f) + ":lower"; return `(${F} = ${q(token)} || ${F} ~ ${q(token + ",%")} || ${F} ~ ${q("%," + token)} || ${F} ~ ${q("%," + token + ",%")})`; };
  const listHas = (f, token, assume) => { // ¿el campo f contiene el token? según su tipo
    const t = fieldType(f) || { type: assume, multi: true };
    if (t.type === "select") return t.multi ? `${A(f)} ~ '${q(token)}'` : `${A(f)}:lower = ${q(token)}`;
    warn.push(`El campo ${f} es de texto: la regla exige la lista como «a,b» (comas sin espacios); pbmini también acepta espacios, así que la regla es más estricta. Recomendado: un select múltiple.`);
    return textList(f, token);
  };
  const roleCond = (r) => (c.mode === "role" ? listHas(c.field, r, "text") : listHas(c.rolesField, r, "select"));
  const blockedCond = c.statusField ? c.blocked.map((b) => `${A(c.statusField)}:lower != ${q(b)}`).join(" && ") : "";
  const base = [`${A("id")} != ""`, `${A("collectionName")} = ${q(c.collection)}`].concat(blockedCond ? [blockedCond] : []);
  const permCond = (p) => {
    const parts = c.roles.filter((r) => (c.permissions[r] || []).some((x) => x === "*" || x === p)).map(roleCond);
    if (c.permissionsField) parts.push(listHas(c.permissionsField, p, "text"));
    return parts.length ? "(" + parts.join(" || ") + ")" : "false";
  };
  const planCond = (p) => {
    const i = c.planOrder.indexOf(p), ok = "(" + c.planOrder.slice(i).map((x) => `${A(c.planField)} = ${q(x)}`).join(" || ") + ")";
    if (i === 0) return "true"; // el plan base lo cumple cualquier usuario autenticado (un plan desconocido cuenta como base)
    if (!c.expiresField) return ok;
    if (c.grace > 1) warn.push(`grace=${c.grace}: las reglas de PocketBase solo permiten 1 día de gracia (@yesterday); la regla es más estricta que pbmini.`);
    return `${ok} && ${A(c.expiresField)} > ${c.grace >= 1 ? "@yesterday" : "@now"}`;
  };
  const cond = (spec) => {
    const k = Object.keys(spec)[0], v = spec[k];
    if (k === "role") return roleCond(v);
    if (k === "permission") return permCond(v);
    if (k === "plan") return planCond(v);
    return "(" + v.map(cond).join(k === "any" ? " || " : " && ") + ")";
  };
  const full = (spec) => base.concat([cond(spec)]).filter((x) => x !== "true").join(" && ");
  out.push(`# pbmini access -> reglas de PocketBase equivalentes (AYUDA: revísalas antes de pegarlas en list/view/create/update/deleteRule de las colecciones que expongan los mismos datos por /api/*).`);
  out.push(`# Los superusuarios saltan todas las reglas en PocketBase, igual que en pbmini.`, "");
  if (c.statusField) out.push(`# authRule de la colección "${c.collection}" (opcional: pbmini ya impide el inicio de sesión de cuentas bloqueadas con un hook. AVISO: en PocketBase 0.40.5 cambiar el authRule INVALIDA todos los tokens de la colección: todos tendrían que volver a iniciar sesión):`, c.blocked.map((b) => `${c.statusField}:lower != ${q(b)}`).join(" && "), "");
  out.push("# Condiciones reutilizables (para reglas de OTRAS colecciones):");
  c.roles.forEach((r) => out.push(`role ${r}: ${full({ role: r })}`));
  if (c.mode === "membership") {
    c.known.forEach((p) => out.push(`permission ${p}: ${full({ permission: p })}`));
    if (c.planField) c.planOrder.forEach((p) => out.push(`plan ${p}: ${full({ plan: p })}`));
  }
  const routes = (table || []).filter((r) => r.access);
  if (routes.length) { out.push("", "# Rutas de pbmini con `access`:"); routes.forEach((r) => out.push(`${r.key}: ${full(r.access)}`)); }
  if (warn.length) { out.push("", "# Avisos:"); warn.filter((w, i) => warn.indexOf(w) === i).forEach((w) => out.push("# - " + w)); }
  return out;
}
module.exports = { validateSpec, check, can, hasRole, membership, validateSchema, isBlocked, guardAuth, onUserSaved, rules };
