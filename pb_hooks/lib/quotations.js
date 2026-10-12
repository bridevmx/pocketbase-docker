// Cotizaciones: se calculan igual que una venta (precios por lista y cantidad, descuentos), pero no mueven
// inventario, pagos ni puntos. Convertirla = crear la venta normal con `quotation` (la marca como sold).
const U = require(`${__hooks}/lib/util.js`);
const LIC = require(`${__hooks}/lib/license.js`);
const O = require(`${__hooks}/lib/orders.js`);


function serialize(app, q, ctx) {
  const out = q.publicExport();
  const cart = U.all(app, 'quotation_cart_discounts', 'quotation = {:q}', { q: q.id }, 'created');
  out.cart_discounts = cart.map((r) => r.publicExport());
  out.total = U.r2(q.getFloat('subtotal') - cart.reduce((s, d) => s + d.getFloat('amount'), 0));
  const canCost = ctx && ctx.has('product.read_cost');
  out.items = U.all(app, 'quotation_items', 'quotation = {:q}', { q: q.id }, 'created').map((it) => {
    const o = it.publicExport();
    o.taxes = U.all(app, 'quotation_item_taxes', 'quotation_item = {:i}', { i: it.id }).map((t) => t.publicExport());
    o.discount = it.getString('discount') ? app.findRecordById('quotation_item_discounts', it.getString('discount')).publicExport() : null;
    if (!canCost) delete o.manual_cost;
    return o;
  });
  return out;
}

function wipe(tx, q) {
  for (const it of U.all(tx, 'quotation_items', 'quotation = {:q}', { q: q.id })) {
    for (const t of U.all(tx, 'quotation_item_taxes', 'quotation_item = {:i}', { i: it.id })) tx.delete(t);
    const d = it.getString('discount');
    tx.delete(it);
    if (d) tx.delete(tx.findRecordById('quotation_item_discounts', d));
  }
  for (const d of U.all(tx, 'quotation_cart_discounts', 'quotation = {:q}', { q: q.id })) tx.delete(d);
}

function build(tx, ctx, body, existing) {
  const user = ctx.user, st = U.settings(tx);
  const location = O.must(tx, 'locations', body.location || (existing && existing.getString('location')), 'La sucursal');
  if (location.getString('deleted_at') || location.getString('type') !== 'branch') throw U.fail(400, 'La cotización debe hacerse en una sucursal', 'invalid_location');
  if (!ctx.canUseLocation(location.id)) throw U.fail(403, 'No tienes acceso a esa sucursal', 'location_forbidden');
  let client = null;
  if (body.client) {
    client = O.must(tx, 'clients', body.client, 'El cliente');
    if (client.getString('deleted_at')) throw U.fail(400, 'Cliente inválido', 'invalid_client');
  }
  let seller = null;
  if (body.seller) seller = O.must(tx, 'sellers', body.seller, 'El vendedor');
  const defaultList = U.first(tx, 'price_lists', 'is_default = true && deleted_at = ""');
  const listId = body.price_list || (client && client.getString('default_price_list')) || location.getString('default_price_list') || (defaultList ? defaultList.id : '');
  if (!listId) throw U.fail(400, 'No hay lista de precios', 'no_price_list');
  O.must(tx, 'price_lists', listId, 'La lista de precios');
  if (!ctx.canUsePriceList(listId)) throw U.fail(403, 'No tienes acceso a esa lista de precios', 'price_list_forbidden');

  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length || raw.length > 200) throw U.fail(400, 'La cotización necesita entre 1 y 200 partidas', 'invalid_items');
  const allowPersonalized = st && st.getBool('allow_personalized_prices');
  const lines = [];
  for (const it of raw) {
    const qty = Number(it.quantity);
    if (!(qty > 0) || U.r4(qty) !== qty) throw U.fail(400, 'Cantidad inválida', 'invalid_quantity');
    let line;
    if (it.manual) {
      U.need(ctx, 'quotation.manage_manual_entry', 'No puedes agregar partidas manuales');
      const name = String(it.name || '').trim(), price = Number(it.sell_price);
      if (!name) throw U.fail(400, 'La partida manual necesita nombre', 'invalid_name');
      if (!(price > 0) || U.hasMoreThan2Decimals(price)) throw U.fail(400, `Precio inválido de ${name}`, 'invalid_price');
      const taxes = (Array.isArray(it.taxes) ? it.taxes : []).map((id) => O.must(tx, 'taxes', id, 'El impuesto'));
      line = { manual: true, name, qty, price, manualCost: it.manual_cost ? Number(it.manual_cost) : 0, taxes, type: 'product', priceType: 'default', breakpoint: 0, plist: listId, unit: '' };
    } else {
      const product = O.must(tx, 'products', it.product, 'El producto');
      const name = product.getString('name');
      if (product.getString('deleted_at') || !product.getBool('is_sellable') || product.getBool('is_variant_group')) throw U.fail(400, `${name} no se puede cotizar`, 'product_not_sellable');
      const priced = O.priceFor(tx, product, listId, defaultList ? defaultList.id : '', qty);
      let price, priceType = 'default', breakpoint = 0, plist = listId;
      if (it.unit_price !== undefined && it.unit_price !== null && (!priced || Number(it.unit_price) !== priced.price)) {
        U.need(ctx, 'quotation.apply_personalized_price', 'No puedes cambiar precios');
        if (!allowPersonalized) throw U.fail(403, 'Los precios personalizados están desactivados', 'personalized_prices_disabled');
        price = Number(it.unit_price); priceType = 'personalized';
      } else {
        if (!priced) throw U.fail(400, `${name} no tiene precio en la lista`, 'no_price');
        price = priced.price; breakpoint = priced.breakpoint; plist = priced.list;
      }
      if (!(price > 0) || U.hasMoreThan2Decimals(price)) throw U.fail(400, `Precio inválido de ${name}`, 'invalid_price');
      let taxes;
      if (Array.isArray(it.taxes)) { U.need(ctx, 'quotation.remove_and_add_taxes', 'No puedes cambiar impuestos'); taxes = it.taxes.map((id) => O.must(tx, 'taxes', id, 'El impuesto')); }
      else taxes = product.getStringSlice('taxes').map((id) => tx.findRecordById('taxes', id));
      line = { product, name, qty, price, taxes, type: product.getString('type'), priceType, breakpoint, plist, unit: product.getString('sell_unit'), manualCost: 0 };
    }
    const gross = U.r2(qty * line.price);
    line.gross = gross; line.disc = null; line.discAmount = 0;
    if (it.discount) {
      U.need(ctx, 'quotation.admin_discount', 'No puedes aplicar descuentos');
      const type = it.discount.type, value = Number(it.discount.value);
      if (['percentage', 'fixed'].indexOf(type) === -1 || !(value > 0)) throw U.fail(400, 'Descuento inválido', 'invalid_discount');
      line.discAmount = type === 'percentage' ? U.r2(gross * value / 100) : U.r2(value);
      if ((type === 'percentage' && value > 100) || line.discAmount > gross) throw U.fail(400, 'El descuento excede el importe', 'invalid_discount');
      line.disc = { type, value, title: it.discount.title || '' };
    }
    line.total = U.r2(gross - line.discAmount);
    lines.push(line);
  }
  const subtotal = U.r2(lines.reduce((s, l) => s + l.total, 0));
  const cart = [];
  for (const d of Array.isArray(body.cart_discounts) ? body.cart_discounts : []) {
    U.need(ctx, 'quotation.admin_discount', 'No puedes aplicar descuentos');
    const value = Number(d.value !== undefined ? d.value : d.amount);
    if (['percentage', 'fixed'].indexOf(d.type) === -1 || !(value > 0) || (d.type === 'percentage' && value > 100)) throw U.fail(400, 'Descuento de carrito inválido', 'invalid_discount');
    cart.push({ type: d.type, amount: d.type === 'percentage' ? U.r2(subtotal * value / 100) : U.r2(value), title: d.title || '' });
  }
  const discounts = U.r2(cart.reduce((s, d) => s + d.amount, 0));
  if (discounts >= subtotal) throw U.fail(400, 'Los descuentos exceden el total', 'invalid_discount');

  const now = new Date();
  const days = st ? st.getInt('quotation_default_validity_days') : 7;
  let expires = body.expires_at ? new Date(body.expires_at) : new Date(now.getTime() + days * 86400000);
  if (isNaN(expires.getTime())) throw U.fail(400, 'Fecha de vigencia inválida', 'invalid_date');
  if (expires <= now) throw U.fail(400, 'La vigencia debe ser futura', 'invalid_date');

  const data = {
    client: client ? client.id : '', seller: seller ? seller.id : '', price_list: listId, location: location.id,
    expires_at: U.nowStr(expires), client_note: String(body.client_note !== undefined ? body.client_note : (st ? st.getString('quotation_fixed_note') : '')),
    notes: String(body.notes || ''), subtotal, with_taxes: body.with_taxes !== false,
  };
  let q = existing;
  if (q) { for (const k of Object.keys(data)) q.set(k, data[k]); tx.save(q); wipe(tx, q); }
  else q = U.create(tx, 'quotations', Object.assign(data, { number: U.nextCounter(tx, 'quotation'), friendly_id: U.friendlyId(tx, 'quotations'), status: 'created', valid_from: U.nowStr(now), created_by: user.id }));
  for (const l of lines) {
    let discId = '';
    if (l.disc) discId = U.create(tx, 'quotation_item_discounts', { type: l.disc.type, value: l.disc.value, title: l.disc.title }).id;
    const row = U.create(tx, 'quotation_items', { quotation: q.id, product: l.manual ? '' : l.product.id, is_manual: !!l.manual, name: l.name, manual_cost: l.manualCost, type: l.type, quantity: l.qty, unit: l.unit, sell_price: l.price, total: l.total, price_type: l.priceType, price_breakpoint: l.breakpoint, price_list: l.plist, discount: discId });
    for (const t of l.taxes) U.create(tx, 'quotation_item_taxes', { quotation_item: row.id, tax: t.id, percentage: t.getBool('is_exempt') ? 0 : t.getFloat('percentage') });
  }
  for (const d of cart) U.create(tx, 'quotation_cart_discounts', { quotation: q.id, type: d.type, amount: d.amount, title: d.title });
  return q;
}

function load(tx, ctx, id) {
  const q = O.must(tx, 'quotations', id, 'La cotización');
  if (q.getString('deleted_at')) throw U.fail(404, 'La cotización no existe', 'not_found');
  if (!ctx.canUseLocation(q.getString('location'))) throw U.fail(403, 'No tienes acceso a la sucursal de esta cotización', 'location_forbidden');
  return q;
}

function create(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'quotation.create', 'No puedes crear cotizaciones');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const q = build(tx, ctx, body, null);
    U.create(tx, 'quotation_events', { quotation: q.id, type: 'created', user: user.id, content: String(body.comment || '') });
    out = serialize(tx, q, ctx);
  });
  return out;
}

function update(app, user, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'quotation.edit', 'No puedes editar cotizaciones');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const q = load(tx, ctx, id);
    if (q.getString('status') !== 'created') throw U.fail(409, 'La cotización ya fue vendida', 'quotation_already_sold');
    build(tx, ctx, body, q);
    U.create(tx, 'quotation_events', { quotation: q.id, type: 'updated', user: user.id, content: String(body.comment || '') });
    out = serialize(tx, tx.findRecordById('quotations', q.id), ctx);
  });
  return out;
}

function get(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'quotation.read');
  return serialize(app, load(app, ctx, id), ctx);
}

function remove(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'quotation.edit');
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const q = load(tx, ctx, id);
    if (q.getString('status') === 'sold') throw U.fail(409, 'No se borra una cotización vendida', 'quotation_already_sold');
    q.set('deleted_at', U.nowStr()); tx.save(q);
  });
  return { deleted: true };
}

// Convierte en venta. body = { request_id, cashier, payments, ...resto de campos de venta }.
// Productos y cantidades salen de la cotización; los precios se recalculan con la lista vigente
// (salvo los personalizados, que se conservan). Las partidas manuales no se pueden vender.
function convert(app, user, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'quotation.read');
  let order;
  const q = load(app, ctx, id);
  if (q.getString('status') !== 'created') throw U.fail(409, 'La cotización ya fue vendida', 'quotation_already_sold');
  if (q.getString('expires_at') && q.getString('expires_at') < U.nowStr()) throw U.fail(409, 'La cotización venció', 'quotation_expired');
  const items = U.all(app, 'quotation_items', 'quotation = {:q}', { q: q.id }, 'created');
  if (items.some((i) => i.getBool('is_manual'))) throw U.fail(422, 'Las partidas manuales no se pueden vender', 'manual_items_not_sellable');
  const sale = Object.assign({}, body, {
    quotation: q.id, location: q.getString('location'), client: q.getString('client') || body.client, seller: q.getString('seller') || body.seller,
    price_list: q.getString('price_list'), with_taxes: q.getBool('with_taxes'),
    items: items.map((i) => {
      const o = { product: i.getString('product'), quantity: i.getFloat('quantity') };
      if (i.getString('price_type') === 'personalized') o.unit_price = i.getFloat('sell_price');
      if (i.getString('discount')) { const d = app.findRecordById('quotation_item_discounts', i.getString('discount')); o.discount = { type: d.getString('type'), value: d.getFloat('value'), title: d.getString('title') }; }
      return o;
    }),
    cart_discounts: U.all(app, 'quotation_cart_discounts', 'quotation = {:q}', { q: q.id }).map((d) => ({ type: 'fixed', value: d.getFloat('amount'), title: d.getString('title') })),
  });
  return O.createOrder(app, user, sale);
}

module.exports = { create, update, get, remove, convert };
