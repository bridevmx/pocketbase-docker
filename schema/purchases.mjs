import { col, text, num, bool, date, sel, rel, uniq, index } from './lib.mjs';
import { PAYMENT_METHOD } from './enums.mjs';

const OUT = ['outlay.read'];

export default [
  col('providers', {
    kind: 'master', soft: true,
    perms: { read: ['outlay.read', 'provider.admin'], create: ['provider.admin'], edit: ['provider.admin'], delete: ['provider.admin'] },
    fields: [
      text('name', { required: true, max: 200 }),
      text('contact_name', { max: 120 }), text('contact_phone', { max: 30 }), text('contact_email', { max: 200 }),
    ],
  }),

  // ───────── Compras ─────────
  col('purchases', {
    kind: 'doc', soft: true, perms: { read: OUT }, loc: ['location'],
    fields: [
      num('number', { min: 1, onlyInt: true }),
      sel('status', ['draft', 'completed'], { required: true }),
      rel('provider', 'providers'),
      rel('location', 'locations', { required: true }),
      date('made_at', { required: true }),
      num('total', { min: 0 }),
      text('folio', { max: 80 }),
      text('notes', { max: 2000 }),
      text('request_id', { required: true, max: 60 }),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'number']), uniq(['account', 'request_id']), index(['account', 'location', 'made_at'])],
  }),
  col('purchase_items', {
    kind: 'doc', perms: { read: OUT }, loc: ['purchase.location'],
    fields: [
      rel('purchase', 'purchases', { required: true, cascade: true }),
      rel('product', 'products', { required: true }),
      num('quantity', { min: 0 }),
      rel('unit', 'measure_units'),
      num('sell_unit_factor', { min: 0 }),
      num('net_unit_cost', { min: 0 }),
      num('unit_discount_percentage', { min: 0, max: 100 }),
      num('total', { min: 0 }),
    ],
    idx: [index(['purchase']), index(['product'])],
  }),
  col('purchase_item_taxes', {
    kind: 'doc', perms: { read: OUT }, loc: ['purchase_item.purchase.location'],
    fields: [
      rel('purchase_item', 'purchase_items', { required: true, cascade: true }),
      rel('tax', 'taxes', { required: true }),
      num('percentage', { min: 0 }),
    ],
  }),
  col('purchase_item_batches', {
    kind: 'doc', perms: { read: OUT }, loc: ['purchase_item.purchase.location'],
    fields: [
      rel('purchase_item', 'purchase_items', { required: true, cascade: true }),
      rel('batch', 'batches', { required: true }),
      num('quantity', { min: 0 }),
    ],
  }),
  col('purchase_debts', {
    kind: 'doc', perms: { read: OUT }, loc: ['purchase.location'],
    fields: [
      rel('purchase', 'purchases', { required: true, cascade: true }),
      num('original_debt', { min: 0 }), num('current_debt', { min: 0 }), date('due_date'),
    ],
    idx: [uniq(['purchase'])],
  }),
  col('purchase_payments', {
    kind: 'doc', perms: { read: OUT }, loc: ['purchase.location'],
    fields: [
      rel('purchase', 'purchases', { required: true, cascade: true }),
      sel('method', PAYMENT_METHOD, { required: true }),
      rel('custom_payment_method', 'custom_payment_methods'),
      num('total', { min: 0 }),
      date('made_at', { required: true }),
      rel('cash_movement', 'cash_movements'),               // solo si salió de caja (efectivo)
      rel('created_by', 'users'),
    ],
    idx: [index(['purchase'])],
  }),

  // ───────── Gastos ─────────
  col('expenses', {
    kind: 'doc', soft: true, perms: { read: OUT }, loc: ['location'],
    fields: [
      num('number', { min: 1, onlyInt: true }),
      text('concept', { required: true, max: 200 }),
      date('made_at', { required: true }),
      num('total', { min: 0 }),
      rel('location', 'locations', { required: true }),
      rel('provider', 'providers'),
      text('folio', { max: 80 }),
      text('notes', { max: 2000 }),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'number']), index(['account', 'location', 'made_at'])],
  }),
  col('expense_taxes', {
    kind: 'doc', perms: { read: OUT }, loc: ['expense.location'],
    fields: [
      rel('expense', 'expenses', { required: true, cascade: true }),
      rel('tax', 'taxes', { required: true }),
      num('percentage', { min: 0 }),
    ],
  }),
  col('expense_debts', {
    kind: 'doc', perms: { read: OUT }, loc: ['expense.location'],
    fields: [
      rel('expense', 'expenses', { required: true, cascade: true }),
      num('original_debt', { min: 0 }), num('current_debt', { min: 0 }), date('due_date'),
    ],
    idx: [uniq(['expense'])],
  }),
  col('expense_payments', {
    kind: 'doc', perms: { read: OUT }, loc: ['expense.location'],
    fields: [
      rel('expense', 'expenses', { required: true, cascade: true }),
      sel('method', PAYMENT_METHOD, { required: true }),
      rel('custom_payment_method', 'custom_payment_methods'),
      num('total', { min: 0 }),
      date('made_at', { required: true }),
      rel('cash_movement', 'cash_movements'),
      rel('created_by', 'users'),
    ],
    idx: [index(['expense'])],
  }),

  // ───────── Caja ─────────
  // amount con signo: entradas positivas, retiros/pagos negativos
  col('cash_movements', {
    kind: 'doc', soft: true, perms: { read: ['cashier_audit.read_current', 'cashier_audit.read'] },
    fields: [
      rel('cashier', 'cashiers', { required: true }),
      rel('user', 'users'),
      sel('type', ['manual_movement', 'purchase_payment', 'expense_payment'], { required: true }),
      num('amount'),
      text('details', { max: 500 }),
    ],
    idx: [index(['account', 'cashier', 'created'])],
  }),
  col('cashier_audits', {
    kind: 'doc', soft: true, perms: { read: ['cashier_audit.read', 'cashier_audit.read_current'] },
    fields: [
      rel('cashier', 'cashiers', { required: true }),
      sel('status', ['draft', 'completed'], { required: true }),
      date('period_start'),
      date('period_end'),
      num('cash_in'),
      num('cash_out'),
      text('comments', { max: 1000 }),
      rel('created_by', 'users'),
    ],
    idx: [index(['account', 'cashier', 'period_end'])],
  }),
  col('cashier_audit_items', {
    kind: 'doc', perms: { read: ['cashier_audit.read', 'cashier_audit.read_current'] },
    fields: [
      rel('audit', 'cashier_audits', { required: true, cascade: true }),
      sel('method', PAYMENT_METHOD, { required: true }),
      rel('custom_payment_method', 'custom_payment_methods'),
      num('total_expected'),
      num('total_audited'),
      // desglose de lo esperado (antes un JSON `detail`)
      num('order_payment'), num('debt_payment'), num('refund'), num('outlay_payment'),
      num('movements_in_total'), num('cash_withdrawal'), num('cash_in'),
    ],
    idx: [index(['audit'])],
  }),
];
