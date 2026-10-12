import { col, text, num, bool, date, sel, rel, uniq, index } from './lib.mjs';
import { STOCK_ORIGIN, ADJUSTMENT_REASON } from './enums.mjs';

const STOCK_READ = ['product.read', 'order.create', 'quotation.create', 'stock_adjustment.read', 'transfer.read', 'manufacturing_order.read'];
const TR_LOC = ['origin', 'destination'];

export default [
  // Saldo materializado por producto y ubicación. Solo los hooks lo modifican.
  col('product_stocks', {
    kind: 'doc', perms: { read: STOCK_READ }, loc: ['location'],
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      rel('location', 'locations', { required: true }),
      num('quantity'),
      num('min_quantity', { min: 0 }),
    ],
    idx: [uniq(['product', 'location']), index(['account', 'location'])],
  }),

  col('batches', {
    kind: 'doc', soft: true, perms: { read: STOCK_READ },
    fields: [
      rel('product', 'products', { required: true }),
      text('code', { required: true, max: 80 }),
      date('expires_at'),
      date('fabricated_at'),
    ],
    idx: [uniq(['product', 'code'], 'deleted_at = ""')],
  }),

  col('batch_stocks', {
    kind: 'doc', perms: { read: STOCK_READ }, loc: ['location'],
    fields: [
      rel('batch', 'batches', { required: true, cascade: true }),
      rel('location', 'locations', { required: true }),
      num('quantity'),
      num('min_quantity', { min: 0 }),
    ],
    idx: [uniq(['batch', 'location'])],
  }),

  // Libro mayor de inventario (append-only). Un movimiento por cambio de saldo.
  // El documento origen se guarda en la relación que corresponda (una sola con valor).
  col('stock_movements', {
    kind: 'doc', perms: { read: ['product.read'] }, loc: ['location'],
    fields: [
      rel('product', 'products', { required: true }),
      rel('batch', 'batches'),
      rel('location', 'locations', { required: true }),
      num('previous_quantity'),
      num('current_quantity'),
      sel('origin', STOCK_ORIGIN, { required: true }),
      sel('adjustment_reason', ADJUSTMENT_REASON),
      rel('order', 'orders'),
      rel('purchase', 'purchases'),
      rel('transfer', 'transfers'),
      rel('stock_adjustment', 'stock_adjustments'),
      rel('manufacturing_order', 'manufacturing_orders'),
      rel('created_by', 'users'),
    ],
    idx: [index(['account', 'product', 'location', 'created']), index(['order']), index(['purchase']), index(['transfer']), index(['stock_adjustment']), index(['manufacturing_order'])],
  }),

  // ───────── Traspasos ─────────
  col('transfers', {
    kind: 'doc', soft: true, perms: { read: ['transfer.read'] }, loc: TR_LOC,
    fields: [
      num('number', { min: 1, onlyInt: true }),
      rel('origin', 'locations', { required: true }),
      rel('destination', 'locations', { required: true }),
      sel('status', ['draft', 'sent', 'received'], { required: true }),
      text('notes', { max: 1000 }),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'number'])],
  }),
  col('transfer_items', {
    kind: 'doc', perms: { read: ['transfer.read'] }, loc: ['transfer.origin', 'transfer.destination'],
    fields: [
      rel('transfer', 'transfers', { required: true, cascade: true }),
      rel('product', 'products', { required: true }),
      num('quantity_sent', { min: 0 }),
      num('quantity_received', { min: 0 }),
      rel('unit', 'measure_units'),
    ],
    idx: [index(['transfer'])],
  }),
  col('transfer_item_batches', {
    kind: 'doc', perms: { read: ['transfer.read'] }, loc: ['transfer_item.transfer.origin', 'transfer_item.transfer.destination'],
    fields: [
      rel('transfer_item', 'transfer_items', { required: true, cascade: true }),
      rel('batch', 'batches', { required: true }),
      num('quantity_sent', { min: 0 }),
      num('quantity_received', { min: 0 }),
    ],
  }),
  col('transfer_events', {
    kind: 'doc', perms: { read: ['transfer.read'] }, loc: ['transfer.origin', 'transfer.destination'],
    fields: [
      rel('transfer', 'transfers', { required: true, cascade: true }),
      sel('type', ['created', 'sent', 'received', 'updated_while_draft', 'comment'], { required: true }),
      text('content', { max: 2000 }),
      rel('user', 'users'),
    ],
    idx: [index(['transfer'])],
  }),

  // ───────── Ajustes de inventario ─────────
  col('stock_adjustments', {
    kind: 'doc', soft: true, perms: { read: ['stock_adjustment.read'] }, loc: ['location'],
    fields: [
      num('number', { min: 1, onlyInt: true }),
      rel('location', 'locations', { required: true }),
      sel('type', ['entry', 'exit', 'count'], { required: true }),
      sel('status', ['draft', 'completed'], { required: true }),
      sel('reason', ADJUSTMENT_REASON),
      text('notes', { max: 1000 }),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'number'])],
  }),
  col('stock_adjustment_items', {
    kind: 'doc', perms: { read: ['stock_adjustment.read'] }, loc: ['stock_adjustment.location'],
    fields: [
      rel('stock_adjustment', 'stock_adjustments', { required: true, cascade: true }),
      rel('product', 'products', { required: true }),
      rel('unit', 'measure_units'),
      num('previous_quantity'),
      num('input_quantity', { min: 0 }),
      num('unit_cost', { min: 0 }),
      num('unit_price', { min: 0 }),
    ],
    idx: [index(['stock_adjustment'])],
  }),
  col('stock_adjustment_item_batches', {
    kind: 'doc', perms: { read: ['stock_adjustment.read'] }, loc: ['item.stock_adjustment.location'],
    fields: [
      rel('item', 'stock_adjustment_items', { required: true, cascade: true }),
      rel('batch', 'batches'),                       // vacío si el lote se crea con el ajuste
      text('code', { max: 80 }),
      date('expires_at'),
      date('fabricated_at'),
      num('input_quantity', { min: 0 }),
    ],
  }),
  col('stock_adjustment_events', {
    kind: 'doc', perms: { read: ['stock_adjustment.read'] }, loc: ['stock_adjustment.location'],
    fields: [
      rel('stock_adjustment', 'stock_adjustments', { required: true, cascade: true }),
      sel('type', ['created_as_draft', 'created_as_completed', 'updated_while_draft', 'completed', 'comment'], { required: true }),
      text('content', { max: 2000 }),
      rel('user', 'users'),
    ],
    idx: [index(['stock_adjustment'])],
  }),

  // ───────── Fabricación ─────────
  col('manufacturing_orders', {
    kind: 'doc', soft: true, perms: { read: ['manufacturing_order.read'] }, loc: ['location'],
    fields: [
      num('number', { min: 1, onlyInt: true }),
      rel('product', 'products', { required: true }),
      rel('location', 'locations', { required: true }),
      sel('status', ['created', 'started', 'finished', 'cancelled'], { required: true }),
      num('initial_quantity', { min: 0 }),
      num('manufactured_quantity', { min: 0 }),
      date('started_at'),
      date('finished_at'),
      text('notes', { max: 1000 }),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'number'])],
  }),
  col('manufacturing_order_materials', {
    kind: 'doc', perms: { read: ['manufacturing_order.read'] }, loc: ['manufacturing_order.location'],
    fields: [
      rel('manufacturing_order', 'manufacturing_orders', { required: true, cascade: true }),
      rel('material', 'products', { required: true }),
      num('quantity', { min: 0 }),
      rel('unit', 'measure_units'),
    ],
    idx: [index(['manufacturing_order'])],
  }),
  col('manufacturing_order_events', {
    kind: 'doc', perms: { read: ['manufacturing_order.read'] }, loc: ['manufacturing_order.location'],
    fields: [
      rel('manufacturing_order', 'manufacturing_orders', { required: true, cascade: true }),
      sel('type', ['created', 'started', 'finished', 'cancelled', 'comment', 'use_material_stock', 'return_material_stock'], { required: true }),
      text('content', { max: 2000 }),
      rel('user', 'users'),
    ],
    idx: [index(['manufacturing_order'])],
  }),
];
