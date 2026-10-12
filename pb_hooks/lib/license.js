// Licencia de la instancia (UNA fila `license`, escrita por el panel de control) y topes.
// Se usa con require() DENTRO de los handlers.

const GRACE_DAYS = 3; // días de gracia tras vencer el pago antes de pasar a solo lectura
const DAY = 86400000;

// Licencia con la que arranca una instancia nueva si el panel no la creó antes (el panel puede sobrescribirla)
const DEFAULT_TRIAL = {
  plan_code: 'trial', plan_name: 'Prueba', status: 'trial', trial_days: 14,
  max_users: 3, max_branches: 1, max_warehouses: 1,
  features: ['manufacturing', 'bank_reconciliations', 'whatsapp_sales_channel', 'catalog_plus'],
};

function parseDate(v) {
  const s = String(v || '');
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function getLicense(app) {
  try { return app.findFirstRecordByFilter('license', 'id != ""'); } catch (_) { return null; }
}

// full = todo | read_only = solo lectura (puede ver y exportar, no escribir) | blocked = sin acceso
function accessLevel(lic, now) {
  if (!lic) return { level: 'blocked', reason: 'no_license' };
  const t = (now || new Date()).getTime();
  const status = lic.getString('status');
  if (status === 'suspended' || status === 'cancelled') return { level: 'blocked', reason: status };
  if (status === 'trial') {
    const ends = parseDate(lic.getString('trial_ends_at'));
    return !ends || t <= ends.getTime() ? { level: 'full', reason: 'trial' } : { level: 'read_only', reason: 'trial_expired' };
  }
  if (status === 'active') {
    const until = parseDate(lic.getString('paid_until'));
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
  no_license: 'La instancia no tiene licencia.',
};

// PocketBase reemplaza los valores de `data` de un ApiError, así que el código de máquina va como
// NOMBRE de la clave:  { "message": "...", "status": 402, "data": { "trial_expired": {...} } }
function assertWritable(app) {
  const a = accessLevel(getLicense(app));
  if (a.level !== 'full') throw new ApiError(402, MESSAGES[a.reason] || 'La suscripción no permite registrar información.', { [a.reason]: a.reason });
  return a;
}

function countActive(app, collection, extra) {
  return app.countRecords(collection, $dbx.hashExp(Object.assign({ deleted_at: '' }, extra || {})));
}

function limits(app) {
  const lic = getLicense(app);
  return {
    license: lic,
    max: lic ? { users: lic.getInt('max_users'), branches: lic.getInt('max_branches'), warehouses: lic.getInt('max_warehouses') } : { users: 0, branches: 0, warehouses: 0 },
    used: {
      users: countActive(app, 'users'),
      branches: countActive(app, 'locations', { type: 'branch' }),
      warehouses: countActive(app, 'locations', { type: 'warehouse' }),
    },
  };
}

const LIMIT_LABEL = { users: 'usuarios', branches: 'sucursales', warehouses: 'almacenes' };

function assertCanAdd(app, kind) {
  const l = limits(app);
  if (l.used[kind] >= l.max[kind]) {
    throw new ApiError(402, `Tu plan permite ${l.max[kind]} ${LIMIT_LABEL[kind]}. Mejora el plan o compra un add-on.`, { ['plan_limit_' + kind]: 'plan_limit_' + kind });
  }
}

function features(app) {
  return app.findRecordsByFilter('license_features', 'id != ""', '', 100, 0).map((r) => r.getString('feature'));
}

function assertFeature(app, feature) {
  if (features(app).indexOf(feature) === -1) throw new ApiError(402, 'Esta función no está incluida en tu plan.', { feature_not_included: feature });
}

module.exports = { DEFAULT_TRIAL, getLicense, accessLevel, assertWritable, limits, assertCanAdd, features, assertFeature, GRACE_DAYS };
