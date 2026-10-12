// Inventario: saldo por producto/lote y libro de movimientos (append-only).
const U = require(`${__hooks}/lib/util.js`);

function stockRow(app, productId, locationId) {
  let row = U.first(app, 'product_stocks', 'product = {:p} && location = {:l}', { p: productId, l: locationId });
  if (!row) { // Pulpos falla si falta la fila; aquí se crea en vacío
    row = new Record(app.findCollectionByNameOrId('product_stocks'));
    row.set('product', productId); row.set('location', locationId); row.set('quantity', 0);
    app.save(row);
  }
  return row;
}
function batchRow(app, batchId, locationId) {
  let row = U.first(app, 'batch_stocks', 'batch = {:b} && location = {:l}', { b: batchId, l: locationId });
  if (!row) {
    row = new Record(app.findCollectionByNameOrId('batch_stocks'));
    row.set('batch', batchId); row.set('location', locationId); row.set('quantity', 0);
    app.save(row);
  }
  return row;
}

// Existencia física en una ubicación (suma de lotes si el producto maneja lotes)
function onHand(app, product, locationId) {
  if (product.getBool('batches_enabled')) {
    const q = new DynamicModel({ q: 0.5 });
    app.db().newQuery('SELECT COALESCE(SUM(bs.quantity),0) AS q FROM batch_stocks bs JOIN batches b ON b.id = bs.batch WHERE b.product = {:p} AND bs.location = {:l} AND b.deleted_at = \'\'').bind({ p: product.id, l: locationId }).one(q);
    return q.q;
  }
  const row = U.first(app, 'product_stocks', 'product = {:p} && location = {:l}', { p: product.id, l: locationId });
  return row ? row.getFloat('quantity') : 0;
}

// Comprometido: vendido pero aún no entregado (pedidos pendientes de entrega, no cancelados)
function committed(app, productId, locationId, excludeOrderId) {
  const q = new DynamicModel({ q: 0.5 });
  app.db().newQuery('SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi."order" WHERE oi.product = {:p} AND o.location = {:l} AND o.shipping_status = \'pending\' AND o.payment_status != \'cancelled\' AND o.deleted_at = \'\' AND o.id != {:x}').bind({ p: productId, l: locationId, x: excludeOrderId || '' }).one(q);
  return q.q;
}

function available(app, product, locationId, excludeOrderId) {
  return U.r4(onHand(app, product, locationId) - committed(app, product.id, locationId, excludeOrderId));
}

// Un movimiento = un cambio de saldo + una fila en el libro. refs: {order, purchase, transfer, stock_adjustment, manufacturing_order}
function move(app, o) {
  const row = o.batch ? batchRow(app, o.batch, o.location) : stockRow(app, o.product, o.location);
  const previous = row.getFloat('quantity');
  const current = U.r4(previous + o.delta);
  if (current < 0 && !o.allowNegative) throw U.fail(409, 'Inventario insuficiente', 'insufficient_stock');
  row.set('quantity', current);
  app.save(row);
  const m = {
    product: o.product, batch: o.batch || '', location: o.location, previous_quantity: previous, current_quantity: current,
    origin: o.origin, adjustment_reason: o.reason || '', created_by: o.user || '',
  };
  Object.assign(m, o.refs || {});
  U.create(app, 'stock_movements', m);
  return { previous, current };
}

// Reparto de una salida entre lotes. manual = [{batch, quantity}] opcional; si no, FEFO (caduca primero).
function allocateBatches(app, product, locationId, quantity, manual, allowNegative) {
  if (manual && manual.length) {
    const sum = manual.reduce((s, b) => s + Number(b.quantity), 0);
    if (!U.near(sum, quantity)) throw U.fail(400, `Los lotes de ${product.getString('name')} no suman la cantidad vendida`, 'batch_quantity_mismatch');
    for (const b of manual) {
      const br = app.findRecordById('batches', b.batch);
      if (br.getString('product') !== product.id || br.getString('deleted_at')) throw U.fail(400, 'Lote inválido', 'invalid_batch');
    }
    return manual.map((b) => ({ batch: b.batch, quantity: Number(b.quantity) }));
  }
  const list = arrayOf(new DynamicModel({ id: '', batch: '', quantity: 0 }));
  app.db().newQuery('SELECT bs.id AS id, bs.batch AS batch, bs.quantity AS quantity FROM batch_stocks bs JOIN batches b ON b.id = bs.batch WHERE b.product = {:p} AND bs.location = {:l} AND b.deleted_at = \'\' AND bs.quantity > 0 ORDER BY (b.expires_at = \'\') ASC, b.expires_at ASC, b.code ASC').bind({ p: product.id, l: locationId }).all(list);
  const out = [];
  let left = quantity;
  for (const r of list) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    out.push({ batch: r.batch, quantity: U.r4(take) });
    left = U.r4(left - take);
  }
  if (left > 0) {
    if (!allowNegative || !out.length) throw U.fail(409, `Inventario insuficiente de ${product.getString('name')}`, 'insufficient_stock');
    out[out.length - 1].quantity = U.r4(out[out.length - 1].quantity + left); // el excedente queda en negativo en el último lote
  }
  return out;
}

// Existencia total del producto en todas las ubicaciones (base del costo promedio)
function totalOnHand(app, productId) {
  const q = new DynamicModel({ q: 0.5 });
  app.db().newQuery('SELECT COALESCE(SUM(quantity),0) AS q FROM product_stocks WHERE product = {:p}').bind({ p: productId }).one(q);
  const b = new DynamicModel({ q: 0.5 });
  app.db().newQuery('SELECT COALESCE(SUM(bs.quantity),0) AS q FROM batch_stocks bs JOIN batches x ON x.id = bs.batch WHERE x.product = {:p}').bind({ p: productId }).one(b);
  return q.q + b.q;
}

// Costo promedio ponderado: (existencia × costo actual + entrada × costo nuevo) / (existencia + entrada).
// Se llama ANTES de mover el inventario. Sin existencia positiva, el costo nuevo reemplaza al actual.
function applyIncomingCost(app, productId, qtyIn, unitCost) {
  if (!(qtyIn > 0) || !(unitCost > 0)) return null;
  const row = U.first(app, 'product_costs', 'product = {:p}', { p: productId });
  const have = Math.max(0, totalOnHand(app, productId));
  const old = row ? row.getFloat('cost') : 0;
  const next = have > 0 && old > 0 ? U.r4((have * old + qtyIn * unitCost) / (have + qtyIn)) : U.r4(unitCost);
  if (row) { row.set('cost', next); app.save(row); }
  else U.create(app, 'product_costs', { product: productId, cost: next, cost_type: 'net' });
  return next;
}

// Revierte los movimientos de un documento (por relación + origen) con un movimiento inverso en el libro.
// Devuelve la cantidad de movimientos revertidos.
function reverse(app, o) { // {field, id, fromOrigin, origin, user, allowNegative, refs}
  const rows = U.all(app, 'stock_movements', `${o.field} = {:i} && origin = {:o}`, { i: o.id, o: o.fromOrigin }, 'created');
  for (const m of rows) {
    const delta = U.r4(m.getFloat('previous_quantity') - m.getFloat('current_quantity'));
    if (delta === 0) continue;
    move(app, { product: m.getString('product'), batch: m.getString('batch'), location: m.getString('location'), delta, origin: o.origin, refs: o.refs, user: o.user, allowNegative: o.allowNegative });
  }
  return rows.length;
}

// Alta de lote (o reuso si ya existe el código para ese producto)
function ensureBatch(app, productId, b) {
  if (b.batch) {
    let r; try { r = app.findRecordById('batches', String(b.batch)); } catch (_) { r = null; }
    if (!r || r.getString('product') !== productId || r.getString('deleted_at')) throw U.fail(400, 'Lote inválido', 'invalid_batch');
    return r;
  }
  const code = String(b.code || '').trim();
  if (!code) throw U.fail(400, 'Cada lote necesita código', 'batch_code_required');
  let r = U.first(app, 'batches', 'product = {:p} && code = {:c} && deleted_at = ""', { p: productId, c: code });
  if (!r) {
    const date = (v) => (v ? U.nowStr(new Date(v)) : '');
    r = U.create(app, 'batches', { product: productId, code, expires_at: date(b.expires_at), fabricated_at: date(b.fabricated_at) });
  }
  return r;
}

module.exports = { reverse, ensureBatch, totalOnHand, applyIncomingCost, stockRow, batchRow, onHand, committed, available, move, allocateBatches };
