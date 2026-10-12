// Ciclo de vida de la venta: cobros posteriores, entrega, abonos de deuda, reembolsos, cancelación y borrado.
const U = require(`${__hooks}/lib/util.js`);
const S = require(`${__hooks}/lib/stock.js`);
const L = require(`${__hooks}/lib/loyalty.js`);
const LIC = require(`${__hooks}/lib/license.js`);
const O = require(`${__hooks}/lib/orders.js`);

function load(tx, ctx, id) {
  const order = O.must(tx, 'orders', id, 'La venta');
  if (order.getString('deleted_at')) throw U.fail(404, 'La venta no existe', 'not_found');
  if (!ctx.canUseLocation(order.getString('location'))) throw U.fail(403, 'No tienes acceso a la sucursal de esta venta', 'location_forbidden');
  return order;
}
function cashierFor(tx, ctx, order, id) {
  const c = O.must(tx, 'cashiers', id, 'La caja');
  if (c.getString('location') !== order.getString('location') || c.getString('deleted_at')) throw U.fail(400, 'La caja no pertenece a la sucursal de la venta', 'invalid_cashier');
  if (!ctx.canUseCashier(c.id)) throw U.fail(403, 'No tienes acceso a esa caja', 'cashier_forbidden');
  return c;
}
function items(tx, order) { return U.all(tx, 'order_items', 'order = {:o}', { o: order.id }, 'created'); }
function stockable(p) { return p.getString('type') !== 'service' && p.getBool('is_stockable'); }
function accountClient(tx, order) {
  const c = tx.findRecordById('clients', order.getString('client'));
  return c.getString('type') === 'account_client' ? c : null;
}
function paidNetSoFar(tx, order) {
  const q = new DynamicModel({ q: 0.5 });
  tx.db().newQuery('SELECT COALESCE(SUM(total - change),0) AS q FROM order_payments WHERE "order" = {:o} AND method != \'credit\' AND deleted_at = \'\' AND settles_payment = \'\'').bind({ o: order.id }).one(q);
  return q.q;
}
function earnedPoints(tx, order) {
  const q = new DynamicModel({ q: 0.5 });
  tx.db().newQuery('SELECT COALESCE(SUM(loyalty_points_reward),0) AS q FROM order_payments WHERE "order" = {:o} AND deleted_at = \'\'').bind({ o: order.id }).one(q);
  return q.q;
}
function spentPoints(tx, order) {
  const q = new DynamicModel({ q: 0.5 });
  tx.db().newQuery('SELECT COALESCE(SUM(loyalty_points_used),0) AS q FROM order_cart_discounts WHERE "order" = {:o}').bind({ o: order.id }).one(q);
  return q.q;
}

// ───────── cobro de una venta pendiente ─────────
function addPayments(app, user, orderId, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.register_payment_and_shipping');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const order = load(tx, ctx, orderId);
    if (order.getString('payment_status') !== 'pending') throw U.fail(409, 'La venta no tiene pago pendiente', 'order_payment_not_pending');
    const cashier = cashierFor(tx, ctx, order, body.cashier);
    const { pays, credit, paidNet } = O.parsePayments(tx, body.payments);
    const total = order.getFloat('total');
    const due = U.r2(total - paidNetSoFar(tx, order));
    let creditPay = null;
    if (credit) {
      U.need(ctx, 'order.create_with_credit', 'No puedes vender a crédito');
      const client = accountClient(tx, order);
      if (!client) throw U.fail(400, 'El crédito requiere un cliente registrado', 'credit_requires_client');
      const dueDate = O.parseDueDate(body.debt_due_date);
      const remaining = U.r2(due - paidNet);
      if (!(remaining > 0)) throw U.fail(400, 'No queda saldo para el crédito', 'invalid_credit');
      const lim = O.debtLimitFor(client, U.settings(tx));
      if (lim > 0 && O.currentDebt(tx, client.id) + remaining > lim + 0.0001) throw U.fail(422, `Excede el límite de crédito del cliente ($${lim})`, 'debt_limit_exceeded');
      creditPay = U.create(tx, 'order_payments', { order: order.id, method: 'credit', custom_payment_method: credit.custom, total: remaining, change: 0, cashier: cashier.id, made_at: U.nowStr(), created_by: user.id });
      U.create(tx, 'order_debts', { order: order.id, original_debt: total, current_debt: remaining, due_date: dueDate, credit_payment: creditPay.id });
    } else if (!pays.length || !U.near(paidNet, due)) {
      throw U.fail(422, 'Los pagos deben cubrir exactamente el saldo pendiente', 'payment_mismatch');
    }
    const pct = order.getFloat('loyalty_reward_percentage');
    let earned = 0;
    for (const p of pays) {
      const reward = pct > 0 ? U.r2(p.net * pct / 100) : 0;
      earned = U.r2(earned + reward);
      U.create(tx, 'order_payments', { order: order.id, method: p.method, custom_payment_method: p.custom, total: p.total, change: p.change, cashier: cashier.id, made_at: U.nowStr(), loyalty_points_reward: reward, settles_payment: creditPay ? creditPay.id : '', created_by: user.id });
    }
    order.set('payment_status', 'completed');
    tx.save(order);
    const client = accountClient(tx, order);
    if (client && earned > 0) L.addPoints(tx, client, earned, 'order_payment_earn', order.id, user.id);
    out = O.serialize(tx, order, ctx);
  });
  return out;
}

// ───────── entrega: baja el inventario que estaba comprometido ─────────
function deliver(app, user, orderId, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.register_payment_and_shipping');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const order = load(tx, ctx, orderId);
    if (order.getString('shipping_status') !== 'pending' || order.getString('payment_status') === 'cancelled') throw U.fail(409, 'La venta no está pendiente de entrega', 'order_not_deliverable');
    // sin pago: se entrega a crédito (Pulpos: "no se pasó fecha para crear la deuda")
    if (order.getString('payment_status') === 'pending') {
      U.need(ctx, 'order.create_with_credit', 'No puedes entregar a crédito');
      const client = accountClient(tx, order);
      if (!client) throw U.fail(400, 'Para entregar sin pago se requiere un cliente registrado', 'credit_requires_client');
      const dueDate = O.parseDueDate(body.debt_due_date);
      const remaining = U.r2(order.getFloat('total') - paidNetSoFar(tx, order));
      const lim = O.debtLimitFor(client, U.settings(tx));
      if (lim > 0 && O.currentDebt(tx, client.id) + remaining > lim + 0.0001) throw U.fail(422, `Excede el límite de crédito del cliente ($${lim})`, 'debt_limit_exceeded');
      const cashier = cashierFor(tx, ctx, order, body.cashier);
      const cp = U.create(tx, 'order_payments', { order: order.id, method: 'credit', total: remaining, change: 0, cashier: cashier.id, made_at: U.nowStr(), created_by: user.id });
      U.create(tx, 'order_debts', { order: order.id, original_debt: order.getFloat('total'), current_debt: remaining, due_date: dueDate, credit_payment: cp.id });
      order.set('payment_status', 'completed');
    }
    const st = U.settings(tx);
    const allowOut = !!(st && st.getBool('allow_selling_out_of_stock'));
    const loc = order.getString('location');
    const lines = items(tx, order);
    if (!allowOut) {
      const need = {};
      for (const it of lines) { const p = tx.findRecordById('products', it.getString('product')); if (stockable(p)) need[p.id] = { p, q: (need[p.id] ? need[p.id].q : 0) + it.getFloat('quantity') }; }
      for (const k of Object.keys(need)) if (S.available(tx, need[k].p, loc, order.id) < need[k].q) throw U.fail(409, `Inventario insuficiente: ${need[k].p.getString('name')}`, 'insufficient_stock');
    }
    for (const it of lines) {
      const p = tx.findRecordById('products', it.getString('product'));
      if (!stockable(p)) continue;
      const qty = it.getFloat('quantity');
      if (p.getBool('batches_enabled')) {
        for (const a of S.allocateBatches(tx, p, loc, qty, null, allowOut)) {
          S.move(tx, { product: p.id, batch: a.batch, location: loc, delta: -a.quantity, origin: 'order_create', refs: { order: order.id }, user: user.id, allowNegative: allowOut });
          U.create(tx, 'order_item_batches', { order_item: it.id, batch: a.batch, quantity: a.quantity });
        }
      } else S.move(tx, { product: p.id, location: loc, delta: -qty, origin: 'order_create', refs: { order: order.id }, user: user.id, allowNegative: allowOut });
    }
    order.set('shipping_status', 'completed');
    tx.save(order);
    U.create(tx, 'order_events', { order: order.id, type: 'product_delivery', user: user.id, location: loc });
    out = O.serialize(tx, order, ctx);
  });
  return out;
}

// ───────── abonos a deuda ─────────
function applyDebtPayment(tx, ctx, order, p, userId, unifiedId) {
  const debt = U.first(tx, 'order_debts', 'order = {:o}', { o: order.id });
  if (!debt || debt.getFloat('current_debt') <= 0) throw U.fail(409, 'La venta no tiene deuda', 'order_without_debt');
  const cashier = cashierFor(tx, ctx, order, p.cashier);
  const method = String(p.method || '');
  if (method === 'credit') throw U.fail(400, 'No se puede abonar con crédito', 'invalid_payment');
  const enabled = U.first(tx, 'enabled_payment_methods', 'method = {:m} && enabled = true', { m: method });
  if (!enabled) throw U.fail(400, `El método de pago ${method} no está habilitado`, 'payment_method_disabled');
  const t = Number(p.total), ch = Number(p.change || 0);
  if (!(t > 0) || U.hasMoreThan2Decimals(t) || ch < 0 || (ch > 0 && method !== 'cash') || ch > t) throw U.fail(400, 'Pago inválido', 'invalid_payment');
  const net = U.r2(t - ch);
  if (net > debt.getFloat('current_debt') + 0.005) throw U.fail(422, 'El abono excede la deuda', 'payment_exceeds_debt');
  const creditPay = tx.findRecordById('order_payments', debt.getString('credit_payment'));
  const pct = order.getFloat('loyalty_reward_percentage');
  const reward = pct > 0 ? U.r2(net * pct / 100) : 0;
  const pay = U.create(tx, 'order_payments', { order: order.id, method, custom_payment_method: p.custom_payment_method || '', total: U.r2(t), change: U.r2(ch), cashier: cashier.id, made_at: U.nowStr(), loyalty_points_reward: reward, settles_payment: creditPay.id, unified_debt_payment: unifiedId || '', created_by: userId });
  const left = U.r2(Math.max(debt.getFloat('current_debt') - net, 0));
  debt.set('current_debt', left); tx.save(debt);
  creditPay.set('total', left); tx.save(creditPay);
  const client = accountClient(tx, order);
  if (client && reward > 0) L.addPoints(tx, client, reward, 'order_payment_earn', order.id, userId);
  return pay;
}

function payDebt(app, user, orderId, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.register_payment_and_shipping');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const order = load(tx, ctx, orderId);
    applyDebtPayment(tx, ctx, order, body, user.id, '');
    out = O.serialize(tx, order, ctx);
  });
  return out;
}

// Un abono que cubre varias ventas del mismo cliente (UnifiedDebtPayment)
function payOrdersDebt(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.register_payment_and_shipping');
  LIC.assertWritable(app);
  const list = Array.isArray(body.payments) ? body.payments : [];
  if (!list.length) throw U.fail(400, 'Faltan pagos', 'invalid_payments');
  let out;
  app.runInTransaction((tx) => {
    let clientId = null;
    const orders = list.map((p) => {
      const o = load(tx, ctx, p.order);
      if (clientId && clientId !== o.getString('client')) throw U.fail(400, 'Todas las ventas deben ser del mismo cliente', 'mixed_clients');
      clientId = o.getString('client');
      return o;
    });
    const unified = U.create(tx, 'unified_debt_payments', { client: clientId, created_by: user.id });
    out = { unified_debt_payment: unified.id, payments: [] };
    list.forEach((p, i) => { out.payments.push(applyDebtPayment(tx, ctx, orders[i], p, user.id, unified.id).publicExport()); });
  });
  return out;
}

// ───────── devolver inventario de partidas entregadas ─────────
// qtyOf(item) = cantidad a devolver de ESA partida. origin: order_return | order_delete
function returnStock(tx, order, itemList, qtyOf, origin, userId) {
  const loc = order.getString('location');
  const rows = [];
  for (const it of itemList) {
    const qty = qtyOf(it);
    if (!(qty > 0)) continue;
    const p = tx.findRecordById('products', it.getString('product'));
    if (!stockable(p)) continue;
    if (p.getBool('batches_enabled')) {
      const bs = U.all(tx, 'order_item_batches', 'order_item = {:i}', { i: it.id }, 'created');
      let left = qty;
      for (const b of bs) {
        if (left <= 0) break;
        const take = Math.min(left, b.getFloat('quantity'));
        S.move(tx, { product: p.id, batch: b.getString('batch'), location: loc, delta: take, origin, refs: { order: order.id }, user: userId, allowNegative: true });
        rows.push({ item: it, batch: b.getString('batch'), quantity: take });
        left = U.r4(left - take);
      }
    } else {
      S.move(tx, { product: p.id, location: loc, delta: qty, origin, refs: { order: order.id }, user: userId, allowNegative: true });
      rows.push({ item: it, batch: '', quantity: qty });
    }
  }
  return rows;
}

// ───────── reembolso de partidas ─────────
function refund(app, user, orderId, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.refund', 'No puedes hacer reembolsos');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const order = load(tx, ctx, orderId);
    if (order.getString('payment_status') !== 'completed') throw U.fail(409, 'Solo se reembolsan ventas cobradas', 'order_not_refundable');
    const reason = String(body.reason || '');
    if (['change_of_mind', 'expired_product', 'damaged_goods', 'wrong_product', 'wrong_variant', 'other'].indexOf(reason) === -1) throw U.fail(400, 'Motivo inválido', 'invalid_reason');
    const req = Array.isArray(body.items) ? body.items : [];
    if (!req.length) throw U.fail(400, 'Faltan partidas a reembolsar', 'invalid_items');

    const all = items(tx, order);
    const top = all.filter((i) => !i.getString('combo_parent'));
    const base = order.getFloat('original_total');
    const factor = base > 0 ? (base - order.getFloat('discounts')) / base : 1;
    let subtotalRefunded = 0, totalRefunded = 0;
    const picks = [];
    for (const r of req) {
      const it = top.find((x) => x.id === r.order_item);
      if (!it) throw U.fail(400, 'Partida inválida', 'invalid_items');
      const qty = Number(r.quantity);
      const q = new DynamicModel({ q: 0.5 });
      tx.db().newQuery('SELECT COALESCE(SUM(quantity_refunded),0) AS q FROM order_refund_items WHERE order_item = {:i}').bind({ i: it.id }).one(q);
      if (!(qty > 0) || qty > U.r4(it.getFloat('quantity') - q.q) + 0.00001) throw U.fail(422, `Cantidad a reembolsar inválida de ${it.getString('name')}`, 'refund_exceeds_sold');
      const line = qty * it.getFloat('total') / it.getFloat('quantity');
      subtotalRefunded += line; totalRefunded += line * factor;
      picks.push({ it, qty });
    }
    subtotalRefunded = U.r2(subtotalRefunded); totalRefunded = U.r2(totalRefunded);

    // deuda: lo reembolsado primero cancela deuda viva; el resto se devuelve con pagos
    const debt = U.first(tx, 'order_debts', 'order = {:o}', { o: order.id });
    const cancelled = debt ? Math.min(debt.getFloat('current_debt'), totalRefunded) : 0;
    const toPay = U.r2(totalRefunded - cancelled);
    const rp = Array.isArray(body.payments) ? body.payments : [];
    const paid = U.r2(rp.reduce((s, p) => s + Number(p.total || 0), 0));
    if (!U.near(paid, toPay)) throw U.fail(422, `Los pagos del reembolso deben sumar $${toPay}`, 'refund_payment_mismatch');

    const ref = U.create(tx, 'order_refunds', { order: order.id, reason, total_refunded: totalRefunded, subtotal_refunded: subtotalRefunded, cancelled_debt: U.r2(cancelled), created_by: user.id });
    if (cancelled > 0) {
      debt.set('current_debt', U.r2(debt.getFloat('current_debt') - cancelled)); tx.save(debt);
      const cp = tx.findRecordById('order_payments', debt.getString('credit_payment'));
      cp.set('total', debt.getFloat('current_debt')); tx.save(cp);
      U.create(tx, 'order_events', { order: order.id, type: 'refund_cancelled_debt', user: user.id, content: String(U.r2(cancelled)) });
    }
    for (const p of rp) {
      const method = String(p.method || '');
      if (!U.first(tx, 'enabled_payment_methods', 'method = {:m} && enabled = true', { m: method }) || method === 'credit') throw U.fail(400, 'Método de pago inválido', 'invalid_payment_method');
      if (p.cashier) cashierFor(tx, ctx, order, p.cashier);
      U.create(tx, 'order_refund_payments', { refund: ref.id, method, custom_payment_method: p.custom_payment_method || '', total_refunded: U.r2(Number(p.total)), cashier: p.cashier || '' });
      U.create(tx, 'order_events', { order: order.id, type: 'refund_payment', user: user.id, content: `${method} ${U.r2(Number(p.total))}` });
    }

    const delivered = order.getString('shipping_status') === 'completed';
    for (const pk of picks) {
      const ri = U.create(tx, 'order_refund_items', { refund: ref.id, order_item: pk.it.id, quantity_refunded: pk.qty });
      if (!delivered) continue;
      const children = all.filter((c) => c.getString('combo_parent') === pk.it.id);
      const targets = children.length ? children : [pk.it];
      const share = pk.qty / pk.it.getFloat('quantity');
      const rows = returnStock(tx, order, targets, (t) => (children.length ? U.r4(t.getFloat('quantity') * share) : pk.qty), 'order_return', user.id);
      for (const r of rows) if (r.batch) U.create(tx, 'order_refund_item_batches', { refund_item: ri.id, batch: r.batch, quantity: r.quantity });
    }
    U.create(tx, 'order_events', { order: order.id, type: 'refund_items', user: user.id, content: `${picks.length} partida(s), $${totalRefunded}` });

    // puntos: se quita lo ganado y se devuelve lo canjeado, en proporción a lo reembolsado
    const client = accountClient(tx, order);
    if (client) {
      const prop = order.getFloat('total') > 0 ? Math.min(totalRefunded / order.getFloat('total'), 1) : 0;
      const earn = U.r2(earnedPoints(tx, order) * prop), spent = U.r2(spentPoints(tx, order) * prop);
      if (earn > 0) L.addPoints(tx, client, -earn, 'order_refund_earn_revert', order.id, user.id);
      if (spent > 0) L.addPoints(tx, client, spent, 'order_refund_spend_revert', order.id, user.id);
    }

    // ¿todo reembolsado?
    let full = true;
    for (const it of top) {
      const q = new DynamicModel({ q: 0.5 });
      tx.db().newQuery('SELECT COALESCE(SUM(quantity_refunded),0) AS q FROM order_refund_items WHERE order_item = {:i}').bind({ i: it.id }).one(q);
      if (q.q + 0.00001 < it.getFloat('quantity')) full = false;
    }
    if (full) { order.set('payment_status', 'refunded'); tx.save(order); }
    out = O.serialize(tx, order, ctx);
    out.refund = ref.publicExport();
  });
  return out;
}

// ───────── cancelación (solo ventas con pago pendiente) ─────────
function cancel(app, user, orderId) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.cancel', 'No puedes cancelar ventas');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const order = load(tx, ctx, orderId);
    if (order.getString('payment_status') !== 'pending') throw U.fail(409, 'Solo se cancelan ventas con pago pendiente', 'order_payment_not_pending');
    if (order.getString('shipping_status') === 'completed') returnStock(tx, order, items(tx, order), (i) => i.getFloat('quantity'), 'order_return', user.id);
    order.set('payment_status', 'cancelled'); order.set('shipping_status', 'cancelled');
    tx.save(order);
    U.create(tx, 'order_events', { order: order.id, type: 'cancel', user: user.id, location: order.getString('location') });
    out = O.serialize(tx, order, ctx);
  });
  return out;
}

// ───────── borrado lógico (revierte inventario y puntos) ─────────
function remove(app, user, orderId) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.cancel', 'No puedes eliminar ventas');
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const order = load(tx, ctx, orderId);
    if (U.first(tx, 'order_refunds', 'order = {:o}', { o: order.id })) throw U.fail(409, 'La venta tiene reembolsos y no se puede eliminar', 'order_has_refunds');
    if (order.getString('shipping_status') === 'completed') returnStock(tx, order, items(tx, order), (i) => i.getFloat('quantity'), 'order_delete', user.id);
    const client = accountClient(tx, order);
    if (client) {
      const earn = earnedPoints(tx, order), spent = spentPoints(tx, order);
      if (spent > 0) L.addPoints(tx, client, spent, 'order_delete_spend_revert', order.id, user.id);
      if (earn > 0) L.addPoints(tx, client, -earn, 'order_delete_earn_revert', order.id, user.id);
    }
    const now = U.nowStr();
    for (const p of U.all(tx, 'order_payments', 'order = {:o} && deleted_at = ""', { o: order.id })) { p.set('deleted_at', now); tx.save(p); }
    const quotation = order.getString('quotation');
    if (quotation) { const q = tx.findRecordById('quotations', quotation); q.set('status', 'created'); tx.save(q); }
    order.set('deleted_at', now);
    tx.save(order);
  });
  return { deleted: true };
}

module.exports = { addPayments, deliver, payDebt, payOrdersDebt, refund, cancel, remove };
