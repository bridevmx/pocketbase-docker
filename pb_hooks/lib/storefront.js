// Tienda en línea (pública, sin sesión). Cada instancia es un negocio, así que no hay que resolver el
// "tenant": el subdominio ya apunta a esta instancia. Los precios, costos e impuestos los decide el servidor;
// el visitante solo manda producto y cantidad. El costo nunca sale por aquí.
const U = require(`${__hooks}/lib/util.js`);
const S = require(`${__hooks}/lib/stock.js`);
const L = require(`${__hooks}/lib/loyalty.js`);
const LIC = require(`${__hooks}/lib/license.js`);
const O = require(`${__hooks}/lib/orders.js`);
const CP = require(`${__hooks}/lib/clip_pay.js`);

const MAX_ITEMS = 50, MAX_QTY = 9999;

// ── contexto de la petición: catálogo activo, lista de precios (variante) y cliente por código
function context(app, headers) {
  const lic = LIC.accessLevel(LIC.getLicense(app));
  if (lic.level === 'blocked') throw U.fail(503, 'La tienda no está disponible', 'store_unavailable');
  const catalog = U.first(app, 'catalogs', 'id != ""');
  if (!catalog || catalog.getString('deactivated_at')) throw U.fail(404, 'La tienda no existe o está desactivada', 'store_not_found');
  const defaultList = U.first(app, 'price_lists', 'is_default = true && deleted_at = ""');
  let list = defaultList, client = null, variant = 'public';
  const slug = String(headers['x-catalog-variant-slug'] || '').trim().toLowerCase();
  if (slug && slug !== 'public') {
    list = U.first(app, 'price_lists', 'catalog_path = {:p} && catalog_hidden = false && deleted_at = ""', { p: slug });
    if (!list) throw U.fail(404, 'La tienda no existe', 'store_not_found');
    variant = slug;
  }
  const code = String(headers['x-catalog-client-code'] || '').trim().toUpperCase();
  if (code) {
    if (!catalog.getBool('client_catalogs_enabled')) throw U.fail(404, 'La tienda no existe', 'store_not_found');
    client = U.first(app, 'clients', 'friendly_id = {:c} && type = "account_client" && deleted_at = ""', { c: code });
    if (!client) throw U.fail(404, 'Cliente no encontrado', 'client_not_found');
    if (client.getString('default_price_list')) list = app.findRecordById('price_lists', client.getString('default_price_list'));
  }
  if (!list) throw U.fail(503, 'La tienda no tiene lista de precios', 'no_price_list');
  const locs = U.all(app, 'catalog_stock_locations', 'catalog = {:c}', { c: catalog.id }).map((r) => r.getString('location'));
  const origin = catalog.getString('location_of_origin') || (U.first(app, 'locations', 'type = "branch" && is_default = true && deleted_at = ""') || { id: '' }).id;
  if (!origin) throw U.fail(503, 'La tienda no tiene sucursal de origen', 'no_origin_location');
  return { catalog, list, defaultList, client, variant, stockLocations: locs.length ? locs : [origin], origin, lic };
}

// ── existencias visibles: suma de las sucursales elegidas menos lo ya comprometido; null = sin límite
function availability(app, cx, product) {
  const type = product.getString('type');
  if (type === 'service' || !product.getBool('is_stockable') && type !== 'combo') return null;
  if (type === 'combo') {
    let min = null;
    for (const ci of U.all(app, 'combo_items', 'combo = {:c}', { c: product.id })) {
      const a = availability(app, cx, app.findRecordById('products', ci.getString('item')));
      if (a === null) continue;
      const n = Math.floor(a / Math.max(ci.getFloat('quantity'), 0.0001));
      min = min === null ? n : Math.min(min, n);
    }
    return min;
  }
  let total = 0;
  for (const l of cx.stockLocations) total += S.available(app, product, l);
  return Math.max(0, U.r4(total));
}

function priceRows(app, cx, product) {
  const rows = (listId) => app.findRecordsByFilter('product_prices', 'product = {:p} && price_list = {:l} && price > 0', 'min_quantity', 100, 0, { p: product.id, l: listId });
  let r = rows(cx.list.id);
  if (!r.length && cx.defaultList) r = rows(cx.defaultList.id);
  return r.map((x) => ({ min_quantity: x.getFloat('min_quantity'), price: x.getFloat('price') }));
}

function fileUrls(rec, field) {
  const col = rec.collection().id;
  return rec.getStringSlice(field).map((f) => `/api/files/${col}/${rec.id}/${f}`);
}

function toProduct(app, cx, p, withDetail) {
  const prices = priceRows(app, cx, p);
  if (!prices.length) return null;
  const avail = availability(app, cx, p);
  const unit = app.findRecordById('measure_units', p.getString('sell_unit'));
  const o = {
    id: p.id, name: p.getString('name'), slug: p.getString('slug'), type: p.getString('type'),
    category: p.getString('category'), parent: p.getString('parent'),
    photos: fileUrls(p, 'photos'), unit: { key: unit.getString('key'), singular: unit.getString('name_singular'), plural: unit.getString('name_plural') },
    price: prices[0].price,
    available: avail, in_stock: avail === null || avail > 0,
  };
  if (cx.catalog.getBool('volume_pricing_enabled')) o.price_breakpoints = prices;
  if (withDetail) {
    o.description = p.getString('description');
    o.brand = p.getString('brand') ? app.findRecordById('product_brands', p.getString('brand')).getString('name') : '';
  }
  return o;
}

function visibleFilter(extra) {
  return 'is_sellable = true && display_in_catalog = true && is_variant_group = false && hidden_at = "" && deleted_at = ""' + (extra ? ' && ' + extra : '');
}

function soldCounts(app) {
  const rows = arrayOf(new DynamicModel({ product: '', q: 0.5 }));
  app.db().newQuery("SELECT oi.product AS product, COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.\"order\" WHERE o.deleted_at = '' AND o.payment_status != 'cancelled' AND oi.combo_parent = '' GROUP BY oi.product").all(rows);
  const m = {};
  for (const r of rows) m[r.product] = r.q;
  return m;
}

// ═════════ lectura ═════════
function config(app, headers) {
  const cx = context(app, headers), c = cx.catalog;
  const ways = U.all(app, 'catalog_payment_ways', 'catalog = {:c}', { c: c.id }).map((r) => r.getString('way'));
  const methods = U.all(app, 'catalog_shipping_methods', 'catalog = {:c}', { c: c.id }).map((r) => r.getString('method'));
  const addr = c.getString('pickup_address') ? app.findRecordById('addresses', c.getString('pickup_address')).publicExport() : null;
  const instr = { to_agree_after_purchase: c.getString('agreed_payment_instructions'), bank_transfer: c.getString('bank_transfer_instructions'), credit: c.getString('credit_instructions'), collect_on_delivery: c.getString('collect_on_delivery_instructions') };
  const mp = ways.indexOf('mercadopago') !== -1 && !!U.first(app, 'mercadopago_credentials', 'id != ""');
  return {
    name: c.getString('name'), phone: c.getString('phone'), facebook: c.getString('facebook'), instagram: c.getString('instagram'),
    support_whatsapp: c.getString('support_whatsapp'), email_contact: c.getString('email_contact'),
    ui_variant: c.getString('ui_variant'), products_without_stock: c.getString('products_without_stock'), acquisition_limit: c.getString('acquisition_limit'),
    categories: c.getString('categories'), volume_pricing_enabled: c.getBool('volume_pricing_enabled'),
    variant: cx.variant, price_list: cx.list.getString('name'),
    variants: U.all(app, 'price_lists', 'catalog_path != "" && catalog_hidden = false && deleted_at = ""').map((l) => ({ name: l.getString('name'), path: l.getString('catalog_path') })),
    payment_ways: ways.filter((w) => (w !== 'mercadopago' || mp) && (w !== 'clip' || CP.configured())).map((w) => ({ way: w, instructions: instr[w] || '' })),
    shipping_methods: methods.map((m) => ({ method: m, instructions: m === 'pickup' ? c.getString('pickup_instructions') : m === 'delivery' ? c.getString('delivery_instructions') : c.getString('agreed_shipping_instructions'), price: m === 'delivery' ? c.getFloat('delivery_default_price') : 0 })),
    pickup_address: addr,
    home: { active: c.getBool('home_active'), show_hero: c.getBool('home_show_hero'), title: c.getString('home_title'), main_button_text: c.getString('home_main_button_text'), hero: fileUrls(c, 'home_hero_photo') },
    banners: U.all(app, 'catalog_banners', 'catalog = {:c}', { c: c.id }).map((b) => ({ type: b.getString('type'), images: fileUrls(b, 'image') })),
  };
}

function categories(app, headers) {
  const cx = context(app, headers);
  if (cx.catalog.getString('categories') === 'hide') return { items: [] };
  const counts = arrayOf(new DynamicModel({ category: '', n: 0 }));
  app.db().newQuery("SELECT category AS category, COUNT(*) AS n FROM products WHERE is_sellable = 1 AND display_in_catalog = 1 AND is_variant_group = 0 AND hidden_at = '' AND deleted_at = '' AND category != '' GROUP BY category").all(counts);
  const items = [];
  for (const r of counts) {
    const c = app.findRecordById('product_categories', r.category);
    if (c.getString('deleted_at')) continue;
    items.push({ id: c.id, name: c.getString('name'), photos: fileUrls(c, 'photo'), products: r.n });
  }
  items.sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));
  return { items };
}

// query: q, category, sort (sold_count|name|price|newest), direction (asc|desc), limit, offset
function search(app, headers, query) {
  const cx = context(app, headers);
  const params = {}; let extra = '';
  const q = String(query.q || '').trim();
  if (q) { extra += (extra ? ' && ' : '') + '(name ~ {:q} || sku ~ {:q})'; params.q = q; }
  if (query.category) { extra += (extra ? ' && ' : '') + 'category = {:cat}'; params.cat = String(query.category); }
  let list = app.findRecordsByFilter('products', visibleFilter(extra), '', 5000, 0, params);
  const sort = String(query.sort || 'sold_count'), dir = String(query.direction || (sort === 'name' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const sold = sort === 'sold_count' ? soldCounts(app) : null;
  const hideNoStock = cx.catalog.getString('products_without_stock') === 'hide';
  let rows = list.filter((p) => priceRows(app, cx, p).length).map((p) => ({ p, avail: hideNoStock ? availability(app, cx, p) : undefined }));
  if (hideNoStock) rows = rows.filter((r) => r.avail === null || r.avail > 0);
  const keyOf = (r) => sort === 'name' ? r.p.getString('name').toLowerCase() : sort === 'newest' ? r.p.getString('created') : sort === 'price' ? (priceRows(app, cx, r.p)[0] || { price: 0 }).price : (sold[r.p.id] || 0);
  const keyed = rows.map((r) => ({ r, k: keyOf(r) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.r.p.getString('name').localeCompare(b.r.p.getString('name'))) * dir);
  const limit = Math.min(Math.max(parseInt(query.limit) || 24, 1), 100), offset = Math.max(parseInt(query.offset) || 0, 0);
  const items = keyed.slice(offset, offset + limit).map((x) => toProduct(app, cx, x.r.p, false)).filter((x) => x);
  return { items, total: keyed.length, limit, offset };
}

function product(app, headers, id) {
  const cx = context(app, headers);
  const p = U.first(app, 'products', visibleFilter('id = {:i}'), { i: id });
  const out = p ? toProduct(app, cx, p, true) : null;
  if (!out) throw U.fail(404, 'El producto no existe', 'not_found');
  return out;
}

// ═════════ carrito ═════════
function cleanItems(raw) {
  if (!Array.isArray(raw) || !raw.length) throw U.fail(400, 'El carrito está vacío', 'cart_empty');
  if (raw.length > MAX_ITEMS) throw U.fail(400, `Máximo ${MAX_ITEMS} productos por pedido`, 'cart_too_large');
  const byId = {}, order = [];
  for (const it of raw) {
    const id = String((it.product && it.product.id) || it.product || ''), qty = Number(it.quantity);
    if (!id || !(qty > 0) || qty > MAX_QTY || U.r4(qty) !== qty) throw U.fail(400, 'Producto o cantidad inválidos', 'invalid_cart_item');
    if (!byId[id]) { byId[id] = 0; order.push(id); }
    byId[id] = U.r4(byId[id] + qty);
  }
  return order.map((id) => ({ id, quantity: byId[id] }));
}

function priceCart(app, cx, raw) {
  const items = cleanItems(raw), lines = [];
  for (const it of items) {
    const p = U.first(app, 'products', visibleFilter('id = {:i}'), { i: it.id });
    if (!p) throw U.fail(400, 'Un producto del carrito ya no está disponible', 'product_unavailable');
    const priced = O.priceFor(app, p, cx.list.id, cx.defaultList ? cx.defaultList.id : '', it.quantity);
    if (!priced) throw U.fail(400, `${p.getString('name')} no tiene precio`, 'no_price');
    const avail = availability(app, cx, p);
    lines.push({ product: p, qty: it.quantity, price: priced.price, breakpoint: priced.breakpoint, priceList: priced.list, gross: U.r2(it.quantity * priced.price), available: avail, enough: avail === null || avail >= it.quantity });
  }
  return lines;
}

function validateCart(app, headers, body) {
  const cx = context(app, headers);
  const lines = priceCart(app, cx, body.items);
  const limit = cx.catalog.getString('acquisition_limit') === 'limit_to_stock';
  const subtotal = U.r2(lines.reduce((s, l) => s + l.gross, 0));
  return {
    items: lines.map((l) => ({ product: l.product.id, name: l.product.getString('name'), quantity: l.qty, available: l.available, has_enough_stock: l.enough, unit_price: l.price, price_breakpoint: l.breakpoint, total: l.gross, current_prices: priceRows(app, cx, l.product) })),
    subtotal, valid: !limit || lines.every((l) => l.enough),
  };
}

// ═════════ pedido ═════════
function digits(s) { return String(s || '').replace(/\D/g, ''); }

function findOrCreateClient(tx, cx, c) {
  if (cx.client) return cx.client;
  const name = String((c && c.name) || '').trim();
  const phone = digits(c && c.phone);
  if (!name || name.length > 120) throw U.fail(400, 'Indica tu nombre', 'invalid_client');
  if (phone.length < 10 || phone.length > 15) throw U.fail(400, 'Indica un teléfono válido de 10 dígitos', 'invalid_phone');
  const email = String((c && c.email) || '').trim();
  if (email && (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) throw U.fail(400, 'Correo inválido', 'invalid_email');
  const last10 = phone.slice(-10);
  const cands = U.all(tx, 'clients', 'type = "account_client" && deleted_at = "" && phone ~ {:p}', { p: last10 });
  const found = cands.find((x) => digits(x.getString('phone')).slice(-10) === last10);
  if (found) return found;
  return U.create(tx, 'clients', { type: 'account_client', name, phone: phone.length === 10 ? '+52' + phone : '+' + phone, email, friendly_id: U.friendlyId(tx, 'clients'), uses_default_debt_limit: true });
}

function serializeOrder(app, order) {
  const o = order.publicExport();
  const c = U.first(app, 'catalogs', 'id != ""');
  return {
    id: o.id, friendly_id: o.friendly_id, order_number: o.order_number, subtotal: o.subtotal, delivery_cost: o.delivery_cost, total: o.total,
    payment_status: o.payment_status, shipping_status: o.shipping_status, way_of_payment: o.way_of_payment, shipping_method: o.shipping_method, made_at: o.made_at,
    items: U.all(app, 'order_items', 'order = {:o} && combo_parent = ""', { o: order.id }, 'created').map((i) => ({ name: i.getString('name'), quantity: i.getFloat('quantity'), unit_price: i.getFloat('unit_price'), total: i.getFloat('total') })),
    payment_url: o.way_of_payment === 'clip' && o.payment_status === 'pending' ? (CP.pendingLink(app, order.id) || { getString: () => '' }).getString('url') : '',
    payment_instructions: c ? ({ bank_transfer: c.getString('bank_transfer_instructions'), to_agree_after_purchase: c.getString('agreed_payment_instructions'), credit: c.getString('credit_instructions'), collect_on_delivery: c.getString('collect_on_delivery_instructions') })[o.way_of_payment] || '' : '',
  };
}

function createOrder(app, headers, body) {
  const cx0 = context(app, headers);
  if (cx0.lic.level !== 'full') LIC.assertWritable(app);
  const requestId = String(body.request_id || '').trim();
  if (!requestId || requestId.length > 60) throw U.fail(400, 'Falta request_id (UUID del pedido)', 'request_id_required');
  const dup = () => { const e = U.first(app, 'orders', 'request_id = {:r} && origin = "online_catalog"', { r: requestId }); return e ? Object.assign({ idempotent: true }, serializeOrder(app, e)) : null; };
  const prev = dup(); if (prev) return prev;
  let out;
  try {
    app.runInTransaction((tx) => {
      const cx = context(tx, headers), c = cx.catalog;
      const ways = U.all(tx, 'catalog_payment_ways', 'catalog = {:c}', { c: c.id }).map((r) => r.getString('way'));
      const methods = U.all(tx, 'catalog_shipping_methods', 'catalog = {:c}', { c: c.id }).map((r) => r.getString('method'));
      const way = String(body.way_of_payment || 'to_agree_after_purchase'), method = String(body.shipping_method || 'to_agree_after_purchase');
      if (ways.indexOf(way) === -1 || (way === 'mercadopago' && !U.first(tx, 'mercadopago_credentials', 'id != ""')) || (way === 'clip' && !CP.configured())) throw U.fail(400, 'Forma de pago no disponible', 'payment_way_unavailable');
      if (methods.indexOf(method) === -1) throw U.fail(400, 'Método de envío no disponible', 'shipping_method_unavailable');

      const lines = priceCart(tx, cx, body.items);
      if (c.getString('acquisition_limit') === 'limit_to_stock') {
        const bad = lines.filter((l) => !l.enough).map((l) => l.product.getString('name'));
        if (bad.length) throw U.fail(409, `Algunos productos exceden la existencia: ${bad.join(', ')}`, 'items_exceed_stock');
      }
      const client = findOrCreateClient(tx, cx, body.client);

      let addressId = '';
      if (method === 'delivery') {
        const a = body.delivery_address || {};
        if (!String(a.street || '').trim() || !String(a.postal_code || '').trim() || !String(a.city || '').trim()) throw U.fail(400, 'La dirección de entrega necesita calle, código postal y ciudad', 'address_required');
        const pick = {}; for (const k of ['street', 'ext_number', 'int_number', 'postal_code', 'neighborhood', 'district', 'city', 'state_code']) pick[k] = String(a[k] || '').trim().slice(0, 200);
        addressId = U.create(tx, 'addresses', Object.assign(pick, { country: 'MX' })).id;
      }

      const subtotal = U.r2(lines.reduce((s, l) => s + l.gross, 0));
      const deliveryCost = method === 'delivery' ? c.getFloat('delivery_default_price') : 0;
      const total = U.r2(subtotal + deliveryCost);
      if (!(total > 0)) throw U.fail(400, 'El total debe ser mayor a cero', 'invalid_total');
      if (way === 'clip' && total < CP.MIN_AMOUNT) throw U.fail(400, `Con Clip el total mínimo es $${CP.MIN_AMOUNT}`, 'clip_min_amount');

      const location = tx.findRecordById('locations', cx.origin);
      const series = U.first(tx, 'order_series', 'is_default = true && deleted_at = ""');
      if (!series) throw U.fail(503, 'No hay serie de folios', 'no_series');
      const orderNumber = series.getInt('next_number') || 1;
      series.set('next_number', orderNumber + 1); tx.save(series);

      let loyaltyPct = 0;
      const program = L.activeProgram(tx);
      if (program && L.appliesTo(program, cx.list.id, location.id) && total >= program.getFloat('min_cart_total')) {
        let pts = 0;
        for (const l of lines) pts += l.gross * L.rateFor(tx, program, l.product) / 100;
        loyaltyPct = U.r4(pts / total * 100);
      }

      const order = U.create(tx, 'orders', {
        order_number: orderNumber, friendly_id: U.friendlyId(tx, 'orders'), series: series.id, location: location.id, client: client.id,
        price_list: cx.list.id, origin: 'online_catalog', payment_status: 'pending', shipping_status: 'pending', way_of_payment: way, shipping_method: method,
        subtotal, discounts: 0, original_total: subtotal, total, with_taxes: true, delivery_cost: deliveryCost, loyalty_reward_percentage: loyaltyPct,
        notes: String(body.notes || '').slice(0, 2000), made_at: U.nowStr(), request_id: requestId, is_offline: false, delivery_address: addressId,
      });
      for (const l of lines) {
        const item = U.create(tx, 'order_items', { order: order.id, product: l.product.id, name: l.product.getString('name'), type: l.product.getString('type'), quantity: l.qty, unit: l.product.getString('sell_unit'), unit_price: l.price, total: l.gross, price_type: 'default', price_breakpoint: l.breakpoint, price_list: l.priceList });
        const cost = U.first(tx, 'product_costs', 'product = {:p}', { p: l.product.id });
        U.create(tx, 'order_item_costs', { order_item: item.id, unit_cost: cost ? cost.getFloat('cost') : 0, total_cost: U.r2((cost ? cost.getFloat('cost') : 0) * l.qty) });
        for (const taxId of l.product.getStringSlice('taxes')) {
          const tax = tx.findRecordById('taxes', taxId);
          U.create(tx, 'order_item_taxes', { order_item: item.id, tax: tax.id, type: tax.getString('type'), percentage: tax.getFloat('percentage'), is_withheld: tax.getBool('is_withheld') });
        }
        if (l.product.getString('type') === 'combo') {
          for (const ci of U.all(tx, 'combo_items', 'combo = {:c}', { c: l.product.id })) {
            const child = tx.findRecordById('products', ci.getString('item'));
            const ch = U.create(tx, 'order_items', { order: order.id, product: child.id, name: child.getString('name'), type: child.getString('type'), quantity: U.r4(l.qty * ci.getFloat('quantity')), unit: child.getString('sell_unit'), unit_price: 0, total: 0, price_type: 'default', price_breakpoint: 0, price_list: cx.list.id, combo_parent: item.id });
            U.create(tx, 'order_item_costs', { order_item: ch.id, unit_cost: 0, total_cost: 0 });
          }
        }
      }
      U.create(tx, 'order_events', { order: order.id, type: 'products_committed', location: location.id, content: 'Pedido de la tienda en línea' });
      out = serializeOrder(tx, order);
      out.pickup_instructions = method === 'pickup' ? c.getString('pickup_instructions') : '';
    });
    if (out.way_of_payment === 'clip') { const r = CP.ensureLink(app, out.id); out.payment_url = r.url; if (r.error) out.payment_error = r.error; }
  } catch (err) {
    const again = dup(); if (again) return again;
    throw err;
  }
  return out;
}

// Seguimiento: el folio corto de 7 caracteres hace de "contraseña" del pedido
function trackOrder(app, headers, friendlyId) {
  context(app, headers);
  const o = U.first(app, 'orders', 'friendly_id = {:f} && origin = "online_catalog" && deleted_at = ""', { f: String(friendlyId).toUpperCase() });
  if (!o) throw U.fail(404, 'Pedido no encontrado', 'not_found');
  return serializeOrder(app, o);
}

module.exports = { config, categories, search, product, validateCart, createOrder, trackOrder };
