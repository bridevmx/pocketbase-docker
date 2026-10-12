// Órdenes de fabricación: consumen materiales al iniciar y producen existencias al terminar.
const U = require(`${__hooks}/lib/util.js`);
const S = require(`${__hooks}/lib/stock.js`);
const LIC = require(`${__hooks}/lib/license.js`);
const I = require(`${__hooks}/lib/inventory.js`);

const CHILDREN = [['materials', 'manufacturing_order_materials', 'manufacturing_order']];

function load(tx, ctx, id) {
  LIC.assertFeature(tx, 'manufacturing');
  const mo = I.must(tx, 'manufacturing_orders', id, 'La orden');
  if (mo.getString('deleted_at')) throw U.fail(404, 'La orden no existe', 'not_found');
  if (!ctx.canUseLocation(mo.getString('location'))) throw U.fail(403, 'No tienes acceso a esa ubicación', 'location_forbidden');
  return mo;
}

// body: { product, location, initial_quantity, notes, materials?: [{material, quantity}] }
// Sin materials se usa la receta del producto × cantidad a fabricar.
function create(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'manufacturing_order.create');
  LIC.assertWritable(app);
  LIC.assertFeature(app, 'manufacturing');
  let out;
  app.runInTransaction((tx) => {
    const p = I.product(tx, body.product);
    const loc = I.location(tx, ctx, body.location);
    const qty = I.num(body.initial_quantity);
    let mats = Array.isArray(body.materials) ? body.materials.map((m) => ({ material: m.material, quantity: I.num(m.quantity) })) : null;
    if (!mats) mats = U.all(tx, 'recipe_items', 'product = {:p}', { p: p.id }).map((r) => ({ material: r.getString('material'), quantity: U.r4(r.getFloat('quantity') * qty) }));
    if (!mats.length) throw U.fail(400, 'El producto no tiene receta ni materiales', 'materials_required');
    const mo = U.create(tx, 'manufacturing_orders', { number: U.nextCounter(tx, 'manufacturing_order'), product: p.id, location: loc.id, status: 'created', initial_quantity: qty, manufactured_quantity: 0, notes: String(body.notes || ''), created_by: user.id });
    for (const m of mats) {
      const mp = I.product(tx, m.material);
      U.create(tx, 'manufacturing_order_materials', { manufacturing_order: mo.id, material: mp.id, quantity: m.quantity, unit: mp.getString('sell_unit') });
    }
    I.event(tx, 'manufacturing_order_events', 'manufacturing_order', mo.id, 'created', user);
    out = I.withChildren(tx, mo, CHILDREN);
  });
  return out;
}

function start(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'manufacturing_order.start');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const mo = load(tx, ctx, id);
    if (mo.getString('status') !== 'created') throw U.fail(409, 'La orden ya fue iniciada', 'invalid_status');
    const locId = mo.getString('location'), neg = I.allowNeg(tx);
    for (const m of U.all(tx, 'manufacturing_order_materials', 'manufacturing_order = {:o}', { o: mo.id }, 'created')) {
      const mp = tx.findRecordById('products', m.getString('material'));
      const q = m.getFloat('quantity');
      const base = { product: mp.id, location: locId, origin: 'manufacturing_material_use', refs: { manufacturing_order: mo.id }, user: user.id, allowNegative: neg };
      if (mp.getBool('batches_enabled')) for (const a of S.allocateBatches(tx, mp, locId, q, null, neg)) S.move(tx, Object.assign({}, base, { batch: a.batch, delta: -a.quantity }));
      else S.move(tx, Object.assign({}, base, { delta: -q }));
    }
    mo.set('status', 'started'); mo.set('started_at', U.nowStr());
    tx.save(mo);
    I.event(tx, 'manufacturing_order_events', 'manufacturing_order', mo.id, 'started', user);
    I.event(tx, 'manufacturing_order_events', 'manufacturing_order', mo.id, 'use_material_stock', user);
    out = I.withChildren(tx, mo, CHILDREN);
  });
  return out;
}

// body: { manufactured_quantity?, batch?: {code, expires_at, fabricated_at} }
function finish(app, user, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'manufacturing_order.finish');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const mo = load(tx, ctx, id);
    if (mo.getString('status') !== 'started') throw U.fail(409, 'La orden no está en proceso', 'invalid_status');
    const p = tx.findRecordById('products', mo.getString('product'));
    const made = body.manufactured_quantity !== undefined ? I.num(body.manufactured_quantity) : mo.getFloat('initial_quantity');
    // costo de producción = costo de lo consumido / unidades producidas
    let spent = 0;
    for (const m of U.all(tx, 'manufacturing_order_materials', 'manufacturing_order = {:o}', { o: mo.id })) {
      const c = U.first(tx, 'product_costs', 'product = {:p}', { p: m.getString('material') });
      spent += (c ? c.getFloat('cost') : 0) * m.getFloat('quantity');
    }
    S.applyIncomingCost(tx, p.id, made, U.r4(spent / made));
    const base = { product: p.id, location: mo.getString('location'), delta: made, origin: 'manufacturing_production', refs: { manufacturing_order: mo.id }, user: user.id, allowNegative: true };
    if (p.getBool('batches_enabled')) {
      if (!body.batch) throw U.fail(400, `${p.getString('name')} maneja lotes: indica el lote producido`, 'batches_required');
      base.batch = S.ensureBatch(tx, p.id, body.batch).id;
    }
    S.move(tx, base);
    mo.set('status', 'finished'); mo.set('manufactured_quantity', made); mo.set('finished_at', U.nowStr());
    tx.save(mo);
    I.event(tx, 'manufacturing_order_events', 'manufacturing_order', mo.id, 'finished', user);
    out = I.withChildren(tx, mo, CHILDREN);
  });
  return out;
}

function cancel(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'manufacturing_order.cancel');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const mo = load(tx, ctx, id);
    const status = mo.getString('status');
    if (status === 'finished' || status === 'cancelled') throw U.fail(409, 'La orden ya no se puede cancelar', 'invalid_status');
    if (status === 'started') {
      S.reverse(tx, { field: 'manufacturing_order', id: mo.id, fromOrigin: 'manufacturing_material_use', origin: 'manufacturing_material_return', refs: { manufacturing_order: mo.id }, user: user.id, allowNegative: true });
      I.event(tx, 'manufacturing_order_events', 'manufacturing_order', mo.id, 'return_material_stock', user);
    }
    mo.set('status', 'cancelled');
    tx.save(mo);
    I.event(tx, 'manufacturing_order_events', 'manufacturing_order', mo.id, 'cancelled', user);
    out = I.withChildren(tx, mo, CHILDREN);
  });
  return out;
}

module.exports = { create, start, finish, cancel };
