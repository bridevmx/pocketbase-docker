// Estado de la suscripción, topes del plan y funciones habilitadas.
// Se usa con require() DENTRO de los handlers.

const GRACE_DAYS = 3; // días de gracia tras vencer el pago antes de pasar a solo lectura
const DAY = 86400000;

function parseDate(v) {
  const s = String(v || '');
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

// full = todo | read_only = solo lectura (la cuenta puede ver y exportar, no escribir) | blocked = sin acceso
function accessLevel(account, now) {
  const t = (now || new Date()).getTime();
  const status = account.getString('status');
  if (status === 'suspended' || status === 'cancelled') return { level: 'blocked', reason: status };
  if (status === 'trial') {
    const ends = parseDate(account.getString('trial_ends_at'));
    return !ends || t <= ends.getTime() ? { level: 'full', reason: 'trial' } : { level: 'read_only', reason: 'trial_expired' };
  }
  if (status === 'active') {
    const until = parseDate(account.getString('paid_until'));
    return !until || t <= until.getTime() + GRACE_DAYS * DAY ? { level: 'full', reason: 'active' } : { level: 'read_only', reason: 'payment_overdue' };
  }
  return { level: 'read_only', reason: status || 'unknown' }; // past_due u otro
}

const MESSAGES = {
  trial_expired: 'La prueba terminó. Elige un plan para volver a registrar información.',
  payment_overdue: 'El pago de la suscripción está vencido. Regulariza para volver a registrar información.',
  past_due: 'La cuenta tiene un pago pendiente. Regulariza para volver a registrar información.',
  suspended: 'La cuenta está suspendida.',
  cancelled: 'La cuenta está cancelada.',
};

function loadAccount(app, accountId) {
  return app.findRecordById('accounts', accountId);
}

// Lanza 402 si la cuenta no puede escribir.
// PocketBase reemplaza los valores de `data`, así que el código de máquina va como NOMBRE de la clave:
//   { "message": "...", "status": 402, "data": { "trial_expired": {...} } }
function assertWritable(app, accountId) {
  const a = accessLevel(loadAccount(app, accountId));
  if (a.level !== 'full') throw new ApiError(402, MESSAGES[a.reason] || 'La suscripción no permite registrar información.', { [a.reason]: a.reason });
  return a;
}

function planOf(app, account) {
  const id = account.getString('plan');
  return id ? app.findRecordById('plans', id) : null;
}

function addOnQuantity(app, accountId, feature) {
  try {
    const r = app.findFirstRecordByFilter('account_features', 'account = {:a} && feature = {:f} && enabled = true', { a: accountId, f: feature });
    return Math.max(r.getInt('quantity'), 0);
  } catch (_) { return 0; }
}

function countActive(app, collection, accountId, extra) {
  const exp = Object.assign({ account: accountId, deleted_at: '' }, extra || {});
  return app.countRecords(collection, $dbx.hashExp(exp));
}

// Topes efectivos (plan + add-ons) y uso actual
function limits(app, accountId) {
  const account = loadAccount(app, accountId);
  const plan = planOf(app, account);
  const base = { users: plan ? plan.getInt('max_users') : 1, branches: plan ? plan.getInt('max_branches') : 1, warehouses: plan ? plan.getInt('max_warehouses') : 0 };
  const max = {
    users: base.users + addOnQuantity(app, accountId, 'extra_user'),
    branches: base.branches + addOnQuantity(app, accountId, 'extra_branch'),
    warehouses: base.warehouses,
  };
  const used = {
    users: countActive(app, 'users', accountId),
    branches: countActive(app, 'locations', accountId, { type: 'branch' }),
    warehouses: countActive(app, 'locations', accountId, { type: 'warehouse' }),
  };
  return { account, plan, max, used };
}

const LIMIT_LABEL = { users: 'usuarios', branches: 'sucursales', warehouses: 'almacenes' };

function assertCanAdd(app, accountId, kind) {
  const l = limits(app, accountId);
  if (l.used[kind] >= l.max[kind]) {
    throw new ApiError(402, `Tu plan permite ${l.max[kind]} ${LIMIT_LABEL[kind]}. Mejora el plan o compra un add-on.`, { ['plan_limit_' + kind]: 'plan_limit_' + kind });
  }
}

// Función habilitada por plan o por add-on comprado
function features(app, accountId) {
  const account = loadAccount(app, accountId);
  const set = {};
  const plan = account.getString('plan');
  if (plan) for (const pf of app.findRecordsByFilter('plan_features', 'plan = {:p}', '', 100, 0, { p: plan })) set[pf.getString('feature')] = true;
  for (const f of app.findRecordsByFilter('account_features', 'account = {:a} && enabled = true', '', 100, 0, { a: accountId })) set[f.getString('feature')] = true;
  return Object.keys(set);
}

function assertFeature(app, accountId, feature) {
  if (features(app, accountId).indexOf(feature) === -1) {
    throw new ApiError(402, 'Esta función no está incluida en tu plan.', { feature_not_included: feature });
  }
}

module.exports = { accessLevel, assertWritable, limits, assertCanAdd, features, assertFeature, GRACE_DAYS };
