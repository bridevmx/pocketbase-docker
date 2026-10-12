// Sincronización para el POS sin conexión.
//  · Bajada: lecturas por cambios (cursor = updated|id) para mantener un caché local. Los borrados lógicos viajan
//    como registros con deleted_at. Precios, combos y costos cambian el `updated` del producto (ver sync.pb.js),
//    así que un producto trae todo lo suyo y basta un cursor.
//  · Subida: ventas hechas sin conexión, en lote, cada una idempotente por request_id.
const U = require(`${__hooks}/lib/util.js`);
const O = require(`${__hooks}/lib/orders.js`);
const LIC = require(`${__hooks}/lib/license.js`);

const MAX_LIMIT = 500, MAX_PUSH = 50;

// Bumpea `updated` del producto cuando cambia algo que viaja embebido en él
function touchProduct(app, productId) {
  if (!productId) return;
  try { const p = app.findRecordById('products', productId); p.set('updated', U.nowStr()); app.save(p); } catch (_) {}
}

function locFilter(ctx, field, params) {
  if (ctx.isAdmin) return '';
  const ids = ctx.user.getStringSlice('locations');
  if (!ids.length) return 'id = ""';
  ids.forEach((id, i) => { params['l' + i] = id; });
  return '(' + ids.map((_, i) => `${field} = {:l${i}}`).join(' || ') + ')';
}

function productOut(app, ctx, p) {
  const o = p.publicExport();
  o.photos = p.getStringSlice('photos').map((f) => `/api/files/${p.collection().id}/${p.id}/${f}`);
  o.prices = U.all(app, 'product_prices', 'product = {:p}', { p: p.id }, 'min_quantity').filter((r) => ctx.canUsePriceList(r.getString('price_list'))).map((r) => ({ price_list: r.getString('price_list'), min_quantity: r.getFloat('min_quantity'), price: r.getFloat('price') }));
  o.combo_items = U.all(app, 'combo_items', 'combo = {:p}', { p: p.id }).map((r) => ({ item: r.getString('item'), quantity: r.getFloat('quantity') }));
  if (ctx.has('product.read_cost')) { const c = U.first(app, 'product_costs', 'product = {:p}', { p: p.id }); o.cost = c ? c.getFloat('cost') : 0; }
  return o;
}
function promotionOut(app, p) {
  const o = p.publicExport();
  o.targets = U.all(app, 'promotion_targets', 'promotion = {:p}', { p: p.id }).map((t) => ({ role: t.getString('role'), product: t.getString('product'), category: t.getString('category') }));
  o.days = U.all(app, 'promotion_days', 'promotion = {:p}', { p: p.id }).map((d) => d.getString('weekday'));
  o.clients = U.all(app, 'promotion_clients', 'promotion = {:p}', { p: p.id }).map((c) => c.getString('client'));
  return o;
}

// entidad → { col, any: permisos (cualquiera), loc: campo de sucursal, out: serializador }
const ENTITIES = {
  products: { col: 'products', out: productOut },
  product_categories: { col: 'product_categories' },
  product_brands: { col: 'product_brands' },
  clients: { col: 'clients', any: ['order.create', 'client.read', 'quotation.create'] },
  promotions: { col: 'promotions', out: (app, ctx, p) => promotionOut(app, p) },
  product_stocks: { col: 'product_stocks', any: ['order.create', 'product.read', 'quotation.create'], loc: 'location' },
  batches: { col: 'batches', any: ['order.create', 'product.read'] },
  batch_stocks: { col: 'batch_stocks', any: ['order.create', 'product.read'], loc: 'location' },
};

function pull(app, user, entity, q) {
  const ctx = U.userCtx(app, user);
  const ent = ENTITIES[entity];
  if (!ent) throw U.fail(404, 'Entidad desconocida', 'unknown_entity');
  if (ent.any && !ent.any.some((k) => ctx.has(k))) throw U.fail(403, 'No tienes permiso para sincronizar esto', 'permission_denied');
  const limit = Math.min(Math.max(parseInt(q.limit) || 200, 1), MAX_LIMIT);
  const params = {};
  const parts = [];
  const cursor = String(q.cursor || '');
  if (cursor) {
    const i = cursor.indexOf('|');
    if (i < 1) throw U.fail(400, 'Cursor inválido', 'invalid_cursor');
    params.cu = cursor.substring(0, i); params.ci = cursor.substring(i + 1);
    parts.push('(updated > {:cu} || (updated = {:cu} && id > {:ci}))');
  }
  if (ent.loc) { const f = locFilter(ctx, ent.loc, params); if (f) parts.push(f); }
  const rows = app.findRecordsByFilter(ent.col, parts.length ? parts.join(' && ') : 'id != ""', 'updated,id', limit + 1, 0, params);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    entity, items: page.map((r) => (ent.out ? ent.out(app, ctx, r) : r.publicExport())),
    cursor: last ? `${last.getString('updated')}|${last.id}` : cursor, has_more: more, server_time: U.nowStr(),
  };
}

// Configuración chica y siempre completa: lo que el POS necesita para operar sin conexión
function config(app, user) {
  const ctx = U.userCtx(app, user);
  const exp = (col, filter, params) => U.all(app, col, filter || 'id != ""', params || {}).map((r) => r.publicExport());
  const locIds = ctx.isAdmin ? null : user.getStringSlice('locations');
  const locs = exp('locations', 'deleted_at = ""').filter((l) => ctx.canUseLocation(l.id));
  const lic = LIC.accessLevel(LIC.getLicense(app));
  const prog = U.first(app, 'loyalty_programs', 'deactivated_at = ""');
  return {
    server_time: U.nowStr(), license: lic,
    user: { id: user.id, name: user.getString('name'), role: user.getString('role'), permissions: ctx.isAdmin ? ['*'] : user.getStringSlice('permissions').map((id) => { try { return app.findRecordById('permissions', id).getString('key'); } catch (_) { return null; } }).filter((k) => k) },
    business: exp('business')[0] || null,
    settings: exp('pos_settings')[0] || null,
    locations: locs,
    cashiers: exp('cashiers', 'deleted_at = ""').filter((c) => ctx.canUseLocation(c.location) && ctx.canUseCashier(c.id)),
    order_series: exp('order_series', 'deleted_at = ""'),
    sellers: exp('sellers', 'deleted_at = ""'),
    price_lists: exp('price_lists', 'deleted_at = ""').filter((l) => ctx.canUsePriceList(l.id)),
    taxes: exp('taxes'),
    measure_units: exp('enabled_units').map((u) => u),
    payment_methods: exp('enabled_payment_methods', 'enabled = true'),
    custom_payment_methods: exp('custom_payment_methods', 'deleted_at = "" && hidden = false'),
    loyalty: prog ? { reward_percentage: prog.getFloat('reward_percentage'), min_cart_total: prog.getFloat('min_cart_total'), price_lists: prog.getStringSlice('price_lists'), locations: prog.getStringSlice('locations') } : null,
  };
}

// Ventas hechas sin conexión. body.orders = [cuerpo de POST /api/tpv/orders con request_id]; en lote, por orden de made_at.
// Cada una se procesa por separado: ok (nueva), duplicate (ya estaba, idempotente) o error.
// retry=true → error transitorio (licencia, servidor); false → no se arregla reintentando (hay que revisar la venta).
function pushOrders(app, user, body) {
  const list = Array.isArray(body.orders) ? body.orders : null;
  if (!list || !list.length) throw U.fail(400, 'Faltan ventas (orders)', 'orders_required');
  if (list.length > MAX_PUSH) throw U.fail(400, `Máximo ${MAX_PUSH} ventas por envío`, 'batch_too_large');
  const ts = (o) => { const d = new Date(String((o && o.made_at) || '').replace(' ', 'T')); return isNaN(d.getTime()) ? Date.now() : d.getTime(); };
  const sorted = list.slice().sort((a, b) => ts(a) - ts(b));
  const results = [];
  for (const o of sorted) {
    const requestId = String((o && o.request_id) || '');
    try {
      const out = O.createOrder(app, user, Object.assign({}, o), { offlineSync: true });
      results.push({ request_id: requestId, status: out.idempotent ? 'duplicate' : 'ok', order: out.order ? { id: out.order.id, order_number: out.order.order_number, friendly_id: out.order.friendly_id, total: out.order.total } : undefined });
    } catch (err) {
      const v = (err && err.value) || err;
      const status = (v && v.status) || 500;
      const data = (v && v.data) || {};
      results.push({ request_id: requestId, status: 'error', http_status: status, code: Object.keys(data)[0] || 'error', message: String((v && v.message) || err), retry: status >= 500 || status === 402 || status === 503 });
    }
  }
  return { results, ok: results.filter((r) => r.status !== 'error').length, errors: results.filter((r) => r.status === 'error').length };
}

module.exports = { pull, config, pushOrders, touchProduct, ENTITIES };
