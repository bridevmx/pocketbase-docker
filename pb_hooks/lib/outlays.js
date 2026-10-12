// Compras y gastos: pagos (efectivo sale de caja), deuda con proveedor y entrada de inventario con costo promedio.
const U = require(`${__hooks}/lib/util.js`);
const S = require(`${__hooks}/lib/stock.js`);
const LIC = require(`${__hooks}/lib/license.js`);
const I = require(`${__hooks}/lib/inventory.js`);

const PERM = 'outlay.register_payment';
const date = (v, code) => {
  if (!v) return U.nowStr();
  const d = new Date(v);
  if (isNaN(d.getTime())) throw U.fail(400, 'Fecha inválida', code || 'invalid_date');
  return U.nowStr(d);
};
const PURCHASE_CHILDREN = [['items', 'purchase_items', 'purchase'], ['payments', 'purchase_payments', 'purchase'], ['debts', 'purchase_debts', 'purchase']];
const EXPENSE_CHILDREN = [['taxes', 'expense_taxes', 'expense'], ['payments', 'expense_payments', 'expense'], ['debts', 'expense_debts', 'expense']];

function provider(tx, id) {
  if (!id) return '';
  const p = I.must(tx, 'providers', id, 'El proveedor');
  if (p.getString('deleted_at')) throw U.fail(400, 'Proveedor inválido', 'invalid_provider');
  return p.id;
}
function taxPercentages(tx, ids) {
  const list = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const t = I.must(tx, 'taxes', id, 'El impuesto');
    list.push({ id: t.id, percentage: t.getBool('is_exempt') ? 0 : t.getFloat('percentage') });
  }
  return list;
}

// Registra pagos de una compra/gasto. kind: 'purchase' | 'expense'. Devuelve lo pagado.
function addPayments(tx, ctx, kind, doc, payments, cashierId) {
  const locationId = doc.getString('location');
  let paid = 0;
  const list = Array.isArray(payments) ? payments : [];
  for (const p of list) {
    const total = U.r2(Number(p.total));
    if (!(total > 0) || U.hasMoreThan2Decimals(Number(p.total))) throw U.fail(400, 'Monto de pago inválido', 'invalid_payment');
    if (['cash', 'card', 'transfer', 'check', 'debit_card', 'payment_intermediary', 'electronic_wallet', 'electronic_money', 'service_card', 'food_voucher'].indexOf(p.method) === -1) throw U.fail(400, 'Método de pago inválido', 'invalid_payment_method');
    let cm = '';
    if (p.method === 'cash') {
      const c = I.must(tx, 'cashiers', cashierId, 'La caja');
      if (c.getString('location') !== locationId || c.getString('deleted_at')) throw U.fail(400, 'La caja no pertenece a la sucursal', 'invalid_cashier');
      if (!ctx.canUseCashier(c.id)) throw U.fail(403, 'No tienes acceso a esa caja', 'cashier_forbidden');
      cm = U.create(tx, 'cash_movements', { cashier: c.id, user: ctx.user.id, type: `${kind}_payment`, amount: -total, details: `${kind === 'purchase' ? 'Compra' : 'Gasto'} #${doc.getInt('number')}` }).id;
    }
    if (p.custom_payment_method) I.must(tx, 'custom_payment_methods', p.custom_payment_method, 'El método de pago');
    U.create(tx, `${kind}_payments`, { [kind]: doc.id, method: p.method, custom_payment_method: p.custom_payment_method || '', total, made_at: U.nowStr(), cash_movement: cm, created_by: ctx.user.id });
    paid = U.r2(paid + total);
  }
  return paid;
}

// Fija la deuda (si queda saldo) tras registrar los pagos iniciales
function settle(tx, ctx, kind, doc, payments, cashierId, dueDate) {
  const total = doc.getFloat('total');
  const paid = addPayments(tx, ctx, kind, doc, payments, cashierId);
  if (paid > total + 0.005) throw U.fail(400, 'Los pagos superan el total', 'overpayment');
  const debt = U.r2(total - paid);
  if (debt > 0) U.create(tx, `${kind}_debts`, { [kind]: doc.id, original_debt: debt, current_debt: debt, due_date: dueDate ? date(dueDate) : '' });
  return debt;
}

// ═════════════════════ COMPRAS ═════════════════════
function createPurchase(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, PERM, 'No tienes permiso para registrar compras');
  LIC.assertWritable(app);
  const requestId = String(body.request_id || '').trim();
  if (!requestId || requestId.length > 60) throw U.fail(400, 'Falta request_id (UUID de la compra)', 'request_id_required');
  const dup = () => { const e = U.first(app, 'purchases', 'request_id = {:r}', { r: requestId }); return e ? Object.assign({ idempotent: true }, I.withChildren(app, e, PURCHASE_CHILDREN)) : null; };
  const prev = dup(); if (prev) return prev;
  let out;
  try {
    app.runInTransaction((tx) => {
      const loc = I.location(tx, ctx, body.location, 'La sucursal');
      if (!Array.isArray(body.items) || !body.items.length) throw U.fail(400, 'La compra necesita productos', 'items_required');
      const purchase = U.create(tx, 'purchases', { number: U.nextCounter(tx, 'purchase'), status: 'draft', provider: provider(tx, body.provider), location: loc.id, made_at: date(body.made_at), total: 0, folio: String(body.folio || ''), notes: String(body.notes || ''), request_id: requestId, created_by: user.id });
      let total = 0;
      const seen = {};
      for (const it of body.items) {
        const p = I.product(tx, it.product);
        if (seen[p.id]) throw U.fail(400, `${p.getString('name')} está repetido`, 'duplicate_product');
        seen[p.id] = true;
        const bs = Array.isArray(it.batches) ? it.batches : [];
        const batched = p.getBool('batches_enabled');
        if (batched && !bs.length) throw U.fail(400, `${p.getString('name')} maneja lotes: indica los lotes`, 'batches_required');
        if (!batched && bs.length) throw U.fail(400, `${p.getString('name')} no maneja lotes`, 'batches_not_allowed');
        const qty = batched ? U.r4(bs.reduce((s, b) => s + I.num(b.quantity), 0)) : I.num(it.quantity);
        const cost = I.num(it.unit_cost, 'invalid_cost', true);
        const disc = it.discount_percentage ? Number(it.discount_percentage) : 0;
        if (!(disc >= 0 && disc <= 100)) throw U.fail(400, 'Descuento inválido', 'invalid_discount');
        const net = U.r4(cost * (1 - disc / 100));
        const base = U.r2(qty * net);
        const taxes = taxPercentages(tx, it.taxes);
        const lineTotal = U.r2(base + taxes.reduce((s, t) => s + U.r2(base * t.percentage / 100), 0));
        const row = U.create(tx, 'purchase_items', { purchase: purchase.id, product: p.id, quantity: qty, unit: p.getString('sell_unit'), sell_unit_factor: 1, net_unit_cost: net, unit_discount_percentage: disc, total: lineTotal });
        for (const t of taxes) U.create(tx, 'purchase_item_taxes', { purchase_item: row.id, tax: t.id, percentage: t.percentage });
        for (const b of bs) {
          const br = S.ensureBatch(tx, p.id, b);
          U.create(tx, 'purchase_item_batches', { purchase_item: row.id, batch: br.id, quantity: I.num(b.quantity) });
        }
        total = U.r2(total + lineTotal);
      }
      purchase.set('total', total);
      tx.save(purchase);
      if (body.status !== 'draft') applyPurchase(tx, ctx, purchase, body);
      out = I.withChildren(tx, tx.findRecordById('purchases', purchase.id), PURCHASE_CHILDREN);
    });
  } catch (err) {
    const again = dup(); if (again) return again;
    throw err;
  }
  return out;
}

function applyPurchase(tx, ctx, purchase, body) {
  const loc = purchase.getString('location');
  const neg = true; // entradas: nunca fallan por existencia
  for (const it of U.all(tx, 'purchase_items', 'purchase = {:p}', { p: purchase.id }, 'created')) {
    const p = tx.findRecordById('products', it.getString('product'));
    S.applyIncomingCost(tx, p.id, it.getFloat('quantity'), it.getFloat('net_unit_cost'));
    if (p.getBool('batches_enabled')) {
      for (const b of U.all(tx, 'purchase_item_batches', 'purchase_item = {:i}', { i: it.id }, 'created'))
        S.move(tx, { product: p.id, batch: b.getString('batch'), location: loc, delta: b.getFloat('quantity'), origin: 'purchase_create', refs: { purchase: purchase.id }, user: ctx.user.id, allowNegative: neg });
    } else {
      S.move(tx, { product: p.id, location: loc, delta: it.getFloat('quantity'), origin: 'purchase_create', refs: { purchase: purchase.id }, user: ctx.user.id, allowNegative: neg });
    }
  }
  settle(tx, ctx, 'purchase', purchase, body.payments, body.cashier, body.due_date);
  purchase.set('status', 'completed');
  tx.save(purchase);
}

function loadPurchase(tx, ctx, id) {
  const pu = I.must(tx, 'purchases', id, 'La compra');
  if (pu.getString('deleted_at')) throw U.fail(404, 'La compra no existe', 'not_found');
  if (!ctx.canUseLocation(pu.getString('location'))) throw U.fail(403, 'No tienes acceso a la sucursal de esta compra', 'location_forbidden');
  return pu;
}

// Completa un borrador: body = { payments, cashier, due_date }
function completePurchase(app, user, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, PERM);
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const pu = loadPurchase(tx, ctx, id);
    if (pu.getString('status') !== 'draft') throw U.fail(409, 'La compra ya está completada', 'already_completed');
    applyPurchase(tx, ctx, pu, body);
    out = I.withChildren(tx, tx.findRecordById('purchases', pu.id), PURCHASE_CHILDREN);
  });
  return out;
}

function payDebt(app, user, kind, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, PERM);
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const col = kind === 'purchase' ? 'purchases' : 'expenses';
    const doc = I.must(tx, col, id, kind === 'purchase' ? 'La compra' : 'El gasto');
    if (doc.getString('deleted_at') || (kind === 'purchase' && doc.getString('status') !== 'completed')) throw U.fail(404, 'El documento no existe', 'not_found');
    if (!ctx.canUseLocation(doc.getString('location'))) throw U.fail(403, 'No tienes acceso a esa sucursal', 'location_forbidden');
    const debt = U.first(tx, `${kind}_debts`, `${kind} = {:d}`, { d: doc.id });
    if (!debt || debt.getFloat('current_debt') <= 0) throw U.fail(409, 'No hay deuda pendiente', 'no_debt');
    if (!Array.isArray(body.payments) || !body.payments.length) throw U.fail(400, 'Indica el pago', 'payments_required');
    const paid = addPayments(tx, ctx, kind, doc, body.payments, body.cashier);
    if (paid > debt.getFloat('current_debt') + 0.005) throw U.fail(400, 'El pago supera la deuda', 'overpayment');
    debt.set('current_debt', U.r2(Math.max(0, debt.getFloat('current_debt') - paid)));
    tx.save(debt);
    out = I.withChildren(tx, tx.findRecordById(col, doc.id), kind === 'purchase' ? PURCHASE_CHILDREN : EXPENSE_CHILDREN);
  });
  return out;
}

// Los movimientos de caja del documento se marcan como borrados (el efectivo vuelve al cuadre de la caja)
function dropCash(tx, kind, doc) {
  for (const pay of U.all(tx, `${kind}_payments`, `${kind} = {:d} && cash_movement != ""`, { d: doc.id })) {
    const cm = tx.findRecordById('cash_movements', pay.getString('cash_movement'));
    cm.set('deleted_at', U.nowStr()); tx.save(cm);
  }
}

function removePurchase(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, PERM);
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const pu = loadPurchase(tx, ctx, id);
    if (pu.getString('status') === 'completed') {
      S.reverse(tx, { field: 'purchase', id: pu.id, fromOrigin: 'purchase_create', origin: 'purchase_delete', refs: { purchase: pu.id }, user: user.id, allowNegative: I.allowNeg(tx) });
      dropCash(tx, 'purchase', pu);
    }
    pu.set('deleted_at', U.nowStr());
    tx.save(pu);
  });
  return { deleted: true };
}

// ═════════════════════ GASTOS ═════════════════════
function createExpense(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, PERM, 'No tienes permiso para registrar gastos');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const loc = I.location(tx, ctx, body.location, 'La sucursal');
    const concept = String(body.concept || '').trim();
    if (!concept) throw U.fail(400, 'Falta el concepto', 'concept_required');
    const total = U.r2(Number(body.total));
    if (!(total > 0) || U.hasMoreThan2Decimals(Number(body.total))) throw U.fail(400, 'Total inválido', 'invalid_total');
    const ex = U.create(tx, 'expenses', { number: U.nextCounter(tx, 'expense'), concept, made_at: date(body.made_at), total, location: loc.id, provider: provider(tx, body.provider), folio: String(body.folio || ''), notes: String(body.notes || ''), created_by: user.id });
    for (const t of taxPercentages(tx, body.taxes)) U.create(tx, 'expense_taxes', { expense: ex.id, tax: t.id, percentage: t.percentage });
    settle(tx, ctx, 'expense', ex, body.payments, body.cashier, body.due_date);
    out = I.withChildren(tx, ex, EXPENSE_CHILDREN);
  });
  return out;
}

function removeExpense(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, PERM);
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const ex = I.must(tx, 'expenses', id, 'El gasto');
    if (ex.getString('deleted_at')) throw U.fail(404, 'El gasto no existe', 'not_found');
    if (!ctx.canUseLocation(ex.getString('location'))) throw U.fail(403, 'No tienes acceso a esa sucursal', 'location_forbidden');
    dropCash(tx, 'expense', ex);
    ex.set('deleted_at', U.nowStr());
    tx.save(ex);
  });
  return { deleted: true };
}

module.exports = { createPurchase, completePurchase, payDebt, removePurchase, createExpense, removeExpense };
