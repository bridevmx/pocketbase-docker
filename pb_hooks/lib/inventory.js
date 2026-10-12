// Ajustes de inventario (incluye la carga inicial) y traspasos entre ubicaciones.
const U = require(`${__hooks}/lib/util.js`);
const S = require(`${__hooks}/lib/stock.js`);
const LIC = require(`${__hooks}/lib/license.js`);

const must = (app, col, id, label) => {
  try { return app.findRecordById(col, String(id)); } catch (_) { throw U.fail(404, `${label} no existe`, 'not_found'); }
};
const num = (v, code, allowZero) => {
  const n = Number(v);
  if (!isFinite(n) || n < 0 || (!allowZero && n === 0)) throw U.fail(400, 'Cantidad inválida', code || 'invalid_quantity');
  return U.r4(n);
};
const allowNeg = (tx) => { const st = U.settings(tx); return !!(st && st.getBool('allow_negative_stock_movements')); };
const stockable = (p) => p.getString('type') === 'product' && p.getBool('is_stockable') && !p.getString('deleted_at');
function location(tx, ctx, id, label) {
  const l = must(tx, 'locations', id, label || 'La ubicación');
  if (l.getString('deleted_at')) throw U.fail(400, 'Ubicación inválida', 'invalid_location');
  if (!ctx.canUseLocation(l.id)) throw U.fail(403, 'No tienes acceso a esa ubicación', 'location_forbidden');
  return l;
}
function product(tx, id) {
  const p = must(tx, 'products', id, 'El producto');
  if (!stockable(p)) throw U.fail(400, `${p.getString('name')} no maneja inventario`, 'not_stockable');
  return p;
}
function event(tx, col, field, id, type, user, content) {
  U.create(tx, col, { [field]: id, type, user: user.id, content: content || '' });
}
function withChildren(app, rec, spec) {
  const out = rec.publicExport();
  for (const [key, col, field] of spec) out[key] = U.all(app, col, `${field} = {:i}`, { i: rec.id }, 'created').map((r) => r.publicExport());
  return out;
}

// ═════════════════════ AJUSTES ═════════════════════
const ADJ_CHILDREN = [['items', 'stock_adjustment_items', 'stock_adjustment']];

// Crea el ajuste. status 'draft' solo lo guarda; 'completed' además lo aplica al inventario.
function createAdjustment(app, user, body) {
  const ctx = U.userCtx(app, user);
  const status = body.status === 'draft' ? 'draft' : 'completed';
  U.need(ctx, status === 'draft' ? 'stock_adjustment.manage_draft' : 'stock_adjustment.complete');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const type = body.type;
    if (['entry', 'exit', 'count'].indexOf(type) === -1) throw U.fail(400, 'Tipo de ajuste inválido (entry, exit o count)', 'invalid_type');
    const loc = location(tx, ctx, body.location);
    if (!Array.isArray(body.items) || !body.items.length) throw U.fail(400, 'El ajuste necesita productos', 'items_required');
    const adj = U.create(tx, 'stock_adjustments', {
      number: U.nextCounter(tx, 'stock_adjustment'), location: loc.id, type, status: 'draft',
      reason: body.reason || (type === 'count' ? 'recount' : 'correction'), notes: String(body.notes || ''), created_by: user.id,
    });
    const seen = {};
    for (const it of body.items) {
      const p = product(tx, it.product);
      if (seen[p.id]) throw U.fail(400, `${p.getString('name')} está repetido`, 'duplicate_product');
      seen[p.id] = true;
      const batched = p.getBool('batches_enabled');
      const bs = Array.isArray(it.batches) ? it.batches : [];
      if (batched && !bs.length) throw U.fail(400, `${p.getString('name')} maneja lotes: indica los lotes`, 'batches_required');
      if (!batched && bs.length) throw U.fail(400, `${p.getString('name')} no maneja lotes`, 'batches_not_allowed');
      const qty = batched ? U.r4(bs.reduce((s, b) => s + num(b.quantity, 'invalid_quantity', type === 'count'), 0)) : num(it.quantity, 'invalid_quantity', type === 'count');
      const row = U.create(tx, 'stock_adjustment_items', {
        stock_adjustment: adj.id, product: p.id, unit: p.getString('sell_unit'), previous_quantity: S.onHand(tx, p, loc.id),
        input_quantity: qty, unit_cost: it.unit_cost ? num(it.unit_cost, 'invalid_cost') : 0, unit_price: it.unit_price ? num(it.unit_price, 'invalid_price') : 0,
      });
      for (const b of bs) {
        const br = S.ensureBatch(tx, p.id, b);
        U.create(tx, 'stock_adjustment_item_batches', { item: row.id, batch: br.id, code: br.getString('code'), expires_at: br.getString('expires_at'), fabricated_at: br.getString('fabricated_at'), input_quantity: num(b.quantity, 'invalid_quantity', type === 'count') });
      }
    }
    event(tx, 'stock_adjustment_events', 'stock_adjustment', adj.id, status === 'draft' ? 'created_as_draft' : 'created_as_completed', user, body.comment);
    if (status === 'completed') apply(tx, ctx, adj);
    out = withChildren(tx, tx.findRecordById('stock_adjustments', adj.id), ADJ_CHILDREN);
  });
  return out;
}

function apply(tx, ctx, adj) {
  const user = ctx.user, loc = adj.getString('location'), type = adj.getString('type');
  const neg = allowNeg(tx);
  for (const it of U.all(tx, 'stock_adjustment_items', 'stock_adjustment = {:a}', { a: adj.id }, 'created')) {
    const p = tx.findRecordById('products', it.getString('product'));
    const base = { product: p.id, location: loc, origin: 'stock_adjustment', reason: adj.getString('reason'), refs: { stock_adjustment: adj.id }, user: user.id, allowNegative: neg };
    // costo promedio con las entradas que traen costo (antes de mover el inventario)
    if (type === 'entry' && it.getFloat('unit_cost') > 0) S.applyIncomingCost(tx, p.id, it.getFloat('input_quantity'), it.getFloat('unit_cost'));
    if (p.getBool('batches_enabled')) {
      for (const b of U.all(tx, 'stock_adjustment_item_batches', 'item = {:i}', { i: it.id }, 'created')) {
        const cur = S.batchRow(tx, b.getString('batch'), loc).getFloat('quantity');
        const q = b.getFloat('input_quantity');
        S.move(tx, Object.assign({}, base, { batch: b.getString('batch'), delta: type === 'count' ? U.r4(q - cur) : type === 'entry' ? q : -q }));
      }
    } else {
      const cur = S.stockRow(tx, p.id, loc).getFloat('quantity');
      const q = it.getFloat('input_quantity');
      S.move(tx, Object.assign({}, base, { delta: type === 'count' ? U.r4(q - cur) : type === 'entry' ? q : -q }));
    }
  }
  adj.set('status', 'completed');
  tx.save(adj);
}

function loadAdjustment(tx, ctx, id) {
  const adj = must(tx, 'stock_adjustments', id, 'El ajuste');
  if (adj.getString('deleted_at')) throw U.fail(404, 'El ajuste no existe', 'not_found');
  if (!ctx.canUseLocation(adj.getString('location'))) throw U.fail(403, 'No tienes acceso a esa ubicación', 'location_forbidden');
  return adj;
}

function completeAdjustment(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'stock_adjustment.complete');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const adj = loadAdjustment(tx, ctx, id);
    if (adj.getString('status') !== 'draft') throw U.fail(409, 'El ajuste ya está completado', 'already_completed');
    apply(tx, ctx, adj);
    event(tx, 'stock_adjustment_events', 'stock_adjustment', adj.id, 'completed', user);
    out = withChildren(tx, tx.findRecordById('stock_adjustments', adj.id), ADJ_CHILDREN);
  });
  return out;
}

function removeAdjustment(app, user, id) {
  const ctx = U.userCtx(app, user);
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const adj = loadAdjustment(tx, ctx, id);
    if (adj.getString('status') === 'draft') U.need(ctx, 'stock_adjustment.manage_draft');
    else {
      U.need(ctx, 'stock_adjustment.complete');
      S.reverse(tx, { field: 'stock_adjustment', id: adj.id, fromOrigin: 'stock_adjustment', origin: 'stock_adjustment_delete', refs: { stock_adjustment: adj.id }, user: user.id, allowNegative: allowNeg(tx) });
    }
    adj.set('deleted_at', U.nowStr());
    tx.save(adj);
  });
  return { deleted: true };
}

// ═════════════════════ TRASPASOS ═════════════════════
const TR_CHILDREN = [['items', 'transfer_items', 'transfer']];

function createTransfer(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'transfer.manage_draft');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const origin = must(tx, 'locations', body.origin, 'La ubicación de origen');
    const dest = must(tx, 'locations', body.destination, 'La ubicación de destino');
    if (origin.id === dest.id) throw U.fail(400, 'Origen y destino deben ser distintos', 'same_location');
    if (origin.getString('deleted_at') || dest.getString('deleted_at')) throw U.fail(400, 'Ubicación inválida', 'invalid_location');
    if (!ctx.canUseLocation(origin.id) && !ctx.canUseLocation(dest.id)) throw U.fail(403, 'No tienes acceso a esas ubicaciones', 'location_forbidden');
    if (!Array.isArray(body.items) || !body.items.length) throw U.fail(400, 'El traspaso necesita productos', 'items_required');
    const tr = U.create(tx, 'transfers', { number: U.nextCounter(tx, 'transfer'), origin: origin.id, destination: dest.id, status: 'draft', notes: String(body.notes || ''), created_by: user.id });
    const seen = {};
    for (const it of body.items) {
      const p = product(tx, it.product);
      if (seen[p.id]) throw U.fail(400, `${p.getString('name')} está repetido`, 'duplicate_product');
      seen[p.id] = true;
      const bs = Array.isArray(it.batches) ? it.batches : [];
      if (!p.getBool('batches_enabled') && bs.length) throw U.fail(400, `${p.getString('name')} no maneja lotes`, 'batches_not_allowed');
      const qty = bs.length ? U.r4(bs.reduce((s, b) => s + num(b.quantity), 0)) : num(it.quantity);
      const row = U.create(tx, 'transfer_items', { transfer: tr.id, product: p.id, unit: p.getString('sell_unit'), quantity_sent: qty, quantity_received: 0 });
      for (const b of bs) {
        const br = S.ensureBatch(tx, p.id, { batch: b.batch });
        U.create(tx, 'transfer_item_batches', { transfer_item: row.id, batch: br.id, quantity_sent: num(b.quantity), quantity_received: 0 });
      }
    }
    event(tx, 'transfer_events', 'transfer', tr.id, 'created', user, body.comment);
    out = withChildren(tx, tr, TR_CHILDREN);
  });
  return out;
}

function loadTransfer(tx, ctx, id) {
  const tr = must(tx, 'transfers', id, 'El traspaso');
  if (tr.getString('deleted_at')) throw U.fail(404, 'El traspaso no existe', 'not_found');
  if (!ctx.canUseLocation(tr.getString('origin')) && !ctx.canUseLocation(tr.getString('destination'))) throw U.fail(403, 'No tienes acceso a este traspaso', 'location_forbidden');
  return tr;
}

function sendTransfer(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'transfer.send');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const tr = loadTransfer(tx, ctx, id);
    if (tr.getString('status') !== 'draft') throw U.fail(409, 'El traspaso ya fue enviado', 'invalid_status');
    const originId = tr.getString('origin');
    if (!ctx.canUseLocation(originId)) throw U.fail(403, 'No tienes acceso a la ubicación de origen', 'location_forbidden');
    const neg = allowNeg(tx);
    for (const it of U.all(tx, 'transfer_items', 'transfer = {:t}', { t: tr.id }, 'created')) {
      const p = tx.findRecordById('products', it.getString('product'));
      const qty = it.getFloat('quantity_sent');
      if (p.getBool('batches_enabled')) {
        const manual = U.all(tx, 'transfer_item_batches', 'transfer_item = {:i}', { i: it.id }).map((b) => ({ batch: b.getString('batch'), quantity: b.getFloat('quantity_sent') }));
        const parts = S.allocateBatches(tx, p, originId, qty, manual.length ? manual : null, neg);
        for (const b of U.all(tx, 'transfer_item_batches', 'transfer_item = {:i}', { i: it.id })) tx.delete(b);
        for (const a of parts) {
          U.create(tx, 'transfer_item_batches', { transfer_item: it.id, batch: a.batch, quantity_sent: a.quantity, quantity_received: 0 });
          S.move(tx, { product: p.id, batch: a.batch, location: originId, delta: -a.quantity, origin: 'transfer_send', refs: { transfer: tr.id }, user: user.id, allowNegative: neg });
        }
      } else {
        S.move(tx, { product: p.id, location: originId, delta: -qty, origin: 'transfer_send', refs: { transfer: tr.id }, user: user.id, allowNegative: neg });
      }
    }
    tr.set('status', 'sent');
    tx.save(tr);
    event(tx, 'transfer_events', 'transfer', tr.id, 'sent', user);
    out = withChildren(tx, tr, TR_CHILDREN);
  });
  return out;
}

// body.items opcional: [{item, quantity_received, batches:[{batch, quantity}]}]; lo no indicado se recibe completo.
function receiveTransfer(app, user, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'transfer.receive');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const tr = loadTransfer(tx, ctx, id);
    if (tr.getString('status') !== 'sent') throw U.fail(409, 'El traspaso no está en tránsito', 'invalid_status');
    const destId = tr.getString('destination');
    if (!ctx.canUseLocation(destId)) throw U.fail(403, 'No tienes acceso a la ubicación de destino', 'location_forbidden');
    const given = {};
    for (const g of (Array.isArray(body.items) ? body.items : [])) given[g.item] = g;
    let short = 0;
    for (const it of U.all(tx, 'transfer_items', 'transfer = {:t}', { t: tr.id }, 'created')) {
      const p = tx.findRecordById('products', it.getString('product'));
      const sent = it.getFloat('quantity_sent');
      const g = given[it.id];
      const rows = U.all(tx, 'transfer_item_batches', 'transfer_item = {:i}', { i: it.id }, 'created');
      let recv = g && g.quantity_received !== undefined ? num(g.quantity_received, 'invalid_quantity', true) : sent;
      if (p.getBool('batches_enabled')) {
        let per = {};
        if (g && Array.isArray(g.batches)) { for (const b of g.batches) per[b.batch] = num(b.quantity, 'invalid_quantity', true); recv = U.r4(Object.keys(per).reduce((s, k) => s + per[k], 0)); }
        else if (U.near(recv, sent)) for (const r of rows) per[r.getString('batch')] = r.getFloat('quantity_sent');
        else throw U.fail(400, `Indica los lotes recibidos de ${p.getString('name')}`, 'batches_required');
        for (const r of rows) {
          const q = per[r.getString('batch')] || 0;
          if (q > r.getFloat('quantity_sent') + 0.00005) throw U.fail(400, 'No puedes recibir más de lo enviado', 'received_more_than_sent');
          r.set('quantity_received', q); tx.save(r);
          if (q > 0) S.move(tx, { product: p.id, batch: r.getString('batch'), location: destId, delta: q, origin: 'transfer_receive', refs: { transfer: tr.id }, user: user.id, allowNegative: true });
        }
      } else {
        if (recv > sent + 0.00005) throw U.fail(400, 'No puedes recibir más de lo enviado', 'received_more_than_sent');
        if (recv > 0) S.move(tx, { product: p.id, location: destId, delta: recv, origin: 'transfer_receive', refs: { transfer: tr.id }, user: user.id, allowNegative: true });
      }
      short = U.r4(short + Math.max(0, sent - recv));
      it.set('quantity_received', recv); tx.save(it);
    }
    tr.set('status', 'received');
    tx.save(tr);
    event(tx, 'transfer_events', 'transfer', tr.id, 'received', user, short > 0 ? `Faltante total: ${short}` : '');
    out = withChildren(tx, tr, TR_CHILDREN);
  });
  return out;
}

// Borrador: se descarta. Enviado: el inventario vuelve al origen. Recibido: no se puede borrar.
function removeTransfer(app, user, id) {
  const ctx = U.userCtx(app, user);
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const tr = loadTransfer(tx, ctx, id);
    const status = tr.getString('status');
    if (status === 'received') throw U.fail(409, 'Un traspaso recibido no se puede borrar', 'invalid_status');
    U.need(ctx, status === 'draft' ? 'transfer.manage_draft' : 'transfer.send');
    if (status === 'sent') S.reverse(tx, { field: 'transfer', id: tr.id, fromOrigin: 'transfer_send', origin: 'transfer_delete', refs: { transfer: tr.id }, user: user.id, allowNegative: true });
    tr.set('deleted_at', U.nowStr());
    tx.save(tr);
  });
  return { deleted: true };
}

module.exports = { createAdjustment, completeAdjustment, removeAdjustment, createTransfer, sendTransfer, receiveTransfer, removeTransfer, must, num, allowNeg, location, product, event, withChildren };
