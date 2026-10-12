// Caja: movimientos manuales y corte (arqueo) en dos pasos, prepare → finish.
const U = require(`${__hooks}/lib/util.js`);
const LIC = require(`${__hooks}/lib/license.js`);
const I = require(`${__hooks}/lib/inventory.js`);

const EPOCH = '1970-01-01 00:00:00.000Z';
const ITEM_FIELDS = ['order_payment', 'debt_payment', 'refund', 'outlay_payment', 'movements_in_total', 'cash_withdrawal'];

function cashierOf(tx, ctx, id) {
  const c = I.must(tx, 'cashiers', id, 'La caja');
  if (c.getString('deleted_at')) throw U.fail(404, 'La caja no existe', 'not_found');
  if (!ctx.canUseLocation(c.getString('location'))) throw U.fail(403, 'No tienes acceso a la sucursal de esa caja', 'location_forbidden');
  if (!ctx.canUseCashier(c.id)) throw U.fail(403, 'No tienes acceso a esa caja', 'cashier_forbidden');
  return c;
}
function periodStart(tx, cashierId) {
  const last = tx.findRecordsByFilter('cashier_audits', 'cashier = {:c} && status = "completed" && deleted_at = ""', '-period_end', 1, 0, { c: cashierId });
  return last.length ? last[0].getString('period_end') : EPOCH;
}
const rows = (tx, sql, params) => {
  const out = arrayOf(new DynamicModel({ method: '', custom: '', q: 0.5 }));
  tx.db().newQuery(sql).bind(params).all(out);
  return out;
};

// Esperado por método de pago en (start, end]. Todas las cifras con signo: lo que sale de caja es negativo.
function expected(tx, cashierId, start, end) {
  const acc = {};
  const add = (method, custom, field, q) => {
    const k = `${method}|${custom || ''}`;
    if (!acc[k]) { acc[k] = { method, custom_payment_method: custom || '', total_expected: 0 }; for (const f of ITEM_FIELDS) acc[k][f] = 0; }
    acc[k][field] = U.r2(acc[k][field] + q);
  };
  const p = { c: cashierId, s: start, e: end };
  const pay = (settled) => `SELECT method AS method, custom_payment_method AS custom, SUM(total - change) AS q FROM order_payments WHERE cashier = {:c} AND deleted_at = '' AND method != 'credit' AND made_at > {:s} AND made_at <= {:e} AND settles_payment ${settled ? "!=" : "="} '' GROUP BY method, custom_payment_method`;
  for (const r of rows(tx, pay(false), p)) add(r.method, r.custom, 'order_payment', r.q);
  for (const r of rows(tx, pay(true), p)) add(r.method, r.custom, 'debt_payment', r.q);
  for (const r of rows(tx, `SELECT rp.method AS method, rp.custom_payment_method AS custom, SUM(rp.total_refunded) AS q FROM order_refund_payments rp JOIN order_refunds r ON r.id = rp.refund WHERE rp.cashier = {:c} AND r.created > {:s} AND r.created <= {:e} GROUP BY rp.method, rp.custom_payment_method`, p)) add(r.method, r.custom, 'refund', -r.q);
  const mv = (cond) => `SELECT 'cash' AS method, '' AS custom, COALESCE(SUM(amount),0) AS q FROM cash_movements WHERE cashier = {:c} AND deleted_at = '' AND created > {:s} AND created <= {:e} AND ${cond}`;
  for (const r of rows(tx, mv("type != 'manual_movement'"), p)) if (r.q) add('cash', '', 'outlay_payment', r.q);
  for (const r of rows(tx, mv("type = 'manual_movement' AND amount > 0"), p)) if (r.q) add('cash', '', 'movements_in_total', r.q);
  for (const r of rows(tx, mv("type = 'manual_movement' AND amount < 0"), p)) if (r.q) add('cash', '', 'cash_withdrawal', r.q);
  if (!acc['cash|']) add('cash', '', 'order_payment', 0);
  const list = Object.keys(acc).map((k) => acc[k]);
  for (const it of list) it.total_expected = U.r2(ITEM_FIELDS.reduce((s, f) => s + it[f], 0));
  return list;
}

function serialize(tx, audit) {
  const out = audit.publicExport();
  out.items = U.all(tx, 'cashier_audit_items', 'audit = {:a}', { a: audit.id }, 'created').map((r) => r.publicExport());
  return out;
}

// Calcula el corte vigente sin guardarlo (cashier_audit.read_current)
function current(app, user, cashierId) {
  const ctx = U.userCtx(app, user);
  if (!ctx.has('cashier_audit.read_current') && !ctx.has('cashier_audit.read') && !ctx.has('cashier_audit.create')) U.need(ctx, 'cashier_audit.read_current');
  const c = cashierOf(app, ctx, cashierId);
  const start = periodStart(app, c.id);
  return { cashier: c.id, period_start: start, period_end: U.nowStr(), items: expected(app, c.id, start, U.nowStr()) };
}

function saveItems(tx, audit, cashierId, start, end) {
  for (const old of U.all(tx, 'cashier_audit_items', 'audit = {:a}', { a: audit.id })) tx.delete(old);
  const list = expected(tx, cashierId, start, end);
  let cin = 0, cout = 0;
  for (const it of list) {
    U.create(tx, 'cashier_audit_items', Object.assign({ audit: audit.id, total_audited: 0 }, it));
    cin += it.movements_in_total; cout += -it.cash_withdrawal + -it.outlay_payment;
  }
  audit.set('period_start', start); audit.set('period_end', end); audit.set('cash_in', U.r2(cin)); audit.set('cash_out', U.r2(cout));
  tx.save(audit);
}

function prepare(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'cashier_audit.create');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const c = cashierOf(tx, ctx, body.cashier);
    const start = periodStart(tx, c.id), end = U.nowStr();
    let audit = U.first(tx, 'cashier_audits', 'cashier = {:c} && status = "draft" && deleted_at = ""', { c: c.id });
    if (!audit) audit = U.create(tx, 'cashier_audits', { cashier: c.id, status: 'draft', period_start: start, period_end: end, created_by: user.id });
    saveItems(tx, audit, c.id, start, end);
    out = serialize(tx, audit);
  });
  return out;
}

// body: { comments?, items:[{ method, custom_payment_method?, total_audited }] }; el esperado se recalcula al cerrar
function finish(app, user, id, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'cashier_audit.create');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const audit = I.must(tx, 'cashier_audits', id, 'El corte');
    if (audit.getString('deleted_at')) throw U.fail(404, 'El corte no existe', 'not_found');
    const c = cashierOf(tx, ctx, audit.getString('cashier'));
    if (audit.getString('status') !== 'draft') throw U.fail(409, 'El corte ya está cerrado', 'already_completed');
    const start = audit.getString('period_start'), end = U.nowStr();
    saveItems(tx, audit, c.id, start, end);
    const given = {};
    for (const g of (Array.isArray(body.items) ? body.items : [])) given[`${g.method}|${g.custom_payment_method || ''}`] = g;
    for (const it of U.all(tx, 'cashier_audit_items', 'audit = {:a}', { a: audit.id })) {
      const g = given[`${it.getString('method')}|${it.getString('custom_payment_method')}`];
      const v = g ? Number(g.total_audited) : NaN;
      if (!isFinite(v) || v < 0) throw U.fail(400, `Falta el monto contado de ${it.getString('method')}`, 'audited_required');
      it.set('total_audited', U.r2(v)); tx.save(it);
    }
    audit.set('status', 'completed'); audit.set('comments', String(body.comments || ''));
    tx.save(audit);
    out = serialize(tx, audit);
  });
  return out;
}

// Entrada o retiro manual de efectivo. body: { cashier, type: 'in'|'out', amount (positivo), details? }
function addMovement(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'cashier_audit.create');
  LIC.assertWritable(app);
  let out;
  app.runInTransaction((tx) => {
    const c = cashierOf(tx, ctx, body.cashier);
    const amt = U.r2(Number(body.amount));
    if (!(amt > 0) || U.hasMoreThan2Decimals(Number(body.amount))) throw U.fail(400, 'Monto inválido', 'invalid_amount');
    if (body.type !== 'in' && body.type !== 'out') throw U.fail(400, 'Tipo inválido (in u out)', 'invalid_type');
    out = U.create(tx, 'cash_movements', { cashier: c.id, user: user.id, type: 'manual_movement', amount: body.type === 'in' ? amt : -amt, details: String(body.details || '') }).publicExport();
  });
  return out;
}

// Solo movimientos manuales del periodo abierto (después del último corte cerrado)
function removeMovement(app, user, id) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'cashier_audit.create');
  LIC.assertWritable(app);
  app.runInTransaction((tx) => {
    const m = I.must(tx, 'cash_movements', id, 'El movimiento');
    if (m.getString('deleted_at')) throw U.fail(404, 'El movimiento no existe', 'not_found');
    cashierOf(tx, ctx, m.getString('cashier'));
    if (m.getString('type') !== 'manual_movement') throw U.fail(409, 'Solo se borran movimientos manuales', 'not_manual');
    if (m.getString('created') <= periodStart(tx, m.getString('cashier'))) throw U.fail(409, 'El movimiento ya está en un corte cerrado', 'period_closed');
    m.set('deleted_at', U.nowStr()); tx.save(m);
  });
  return { deleted: true };
}

module.exports = { current, prepare, finish, addMovement, removeMovement };
