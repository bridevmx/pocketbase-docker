// Utilidades compartidas por las rutas transaccionales (se cargan con require() dentro del handler).

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = (x) => Math.round((x + Number.EPSILON) * 10000) / 10000;
const near = (a, b) => Math.abs(a - b) < 0.005;
const hasMoreThan2Decimals = (x) => Math.abs(x * 100 - Math.round(x * 100)) > 1e-6;

// Errores: PocketBase reemplaza los valores de `data`, así que el código de máquina va como NOMBRE de la clave.
function fail(status, message, code) {
  return new ApiError(status, message, { [code]: code });
}

function nowStr(d) { return (d || new Date()).toISOString().replace('T', ' '); }

function first(app, collection, filter, params) {
  try { return app.findFirstRecordByFilter(collection, filter, params || {}); } catch (_) { return null; }
}

function all(app, collection, filter, params, sort) {
  return app.findRecordsByFilter(collection, filter, sort || '', 1000, 0, params || {});
}

// Contexto del usuario: permisos finos, sucursales, cajas y listas de precio a las que tiene acceso
function userCtx(app, user) {
  const isAdmin = user.getString('role') === 'admin';
  let keys = null;
  const load = () => {
    if (keys) return keys;
    keys = {};
    for (const id of user.getStringSlice('permissions')) {
      try { keys[app.findRecordById('permissions', id).getString('key')] = true; } catch (_) {}
    }
    return keys;
  };
  const set = (f) => { const o = {}; for (const id of user.getStringSlice(f)) o[id] = true; return o; };
  const locs = set('locations'), cashiers = set('cashiers'), lists = set('price_lists');
  return {
    user, isAdmin,
    has: (key) => isAdmin || !!load()[key],
    canUseLocation: (id) => isAdmin || !!locs[id],
    // un usuario sin cajas asignadas puede usar cualquiera de sus sucursales
    canUseCashier: (id) => isAdmin || Object.keys(cashiers).length === 0 || !!cashiers[id],
    canUsePriceList: (id) => isAdmin || Object.keys(lists).length === 0 || !!lists[id],
  };
}
function need(ctx, key, message) {
  if (!ctx.has(key)) throw fail(403, message || `Falta el permiso ${key}`, 'permission_denied');
}

function settings(app) {
  return first(app, 'pos_settings', 'id != ""');
}

const FRIENDLY = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
function friendlyId(app, collection) {
  for (let i = 0; i < 20; i++) {
    let s = '';
    for (let k = 0; k < 7; k++) s += FRIENDLY.charAt(Math.floor(Math.random() * FRIENDLY.length));
    if (!first(app, collection, 'friendly_id = {:f}', { f: s })) return s;
  }
  throw fail(500, 'No se pudo generar el folio corto', 'friendly_id_failed');
}

// Consecutivo por clave (compras, traspasos…); debe llamarse dentro de una transacción
function nextCounter(app, key) {
  let c = first(app, 'counters', 'key = {:k}', { k: key });
  if (!c) { c = new Record(app.findCollectionByNameOrId('counters')); c.set('key', key); c.set('value', 0); }
  c.set('value', c.getInt('value') + 1);
  app.save(c);
  return c.getInt('value');
}

function create(app, collection, data) {
  const r = new Record(app.findCollectionByNameOrId(collection));
  for (const k of Object.keys(data)) if (data[k] !== undefined) r.set(k, data[k]);
  app.save(r);
  return r;
}

module.exports = { r2, r4, near, hasMoreThan2Decimals, fail, nowStr, first, all, userCtx, need, settings, friendlyId, nextCounter, create };
