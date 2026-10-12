import { col, text, num, bool, date, sel, rel, rels, uniq, index } from './lib.mjs';
import { PAYMENT_METHOD, DISCOUNT_TYPE, PRODUCT_TYPE, ORDER_ORIGIN, PAYMENT_STATUS, SHIPPING_STATUS, WAY_OF_PAYMENT, SHIPPING_METHOD, PRICE_TYPE, REFUND_REASON, LOYALTY_ORIGIN, WEEKDAY } from './enums.mjs';

const OR = ['order.read'];
const COST = ['product.read_cost'];
const CLIENT_READ = ['client.read', 'order.create', 'quotation.create'];

export default [
  col('clients', {
    kind: 'master', soft: true,
    perms: { read: CLIENT_READ, create: ['client.create'], edit: ['client.edit'], delete: ['client.edit'] },
    fields: [
      text('friendly_id', { max: 12 }),
      sel('type', ['general_public', 'account_client'], { required: true }),
      text('name', { required: true, max: 120 }),
      text('surname', { max: 120 }),
      text('phone', { max: 30 }),
      text('email', { max: 200 }),
      rel('address', 'addresses'),
      text('comments', { max: 1000 }),
      rel('default_price_list', 'price_lists'),
      num('loyalty_points'),
      bool('uses_default_debt_limit'),
      num('debt_limit', { min: 0 }),
      date('last_debt_reminder_at'),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'friendly_id'], 'friendly_id != ""'), index(['account', 'phone']), index(['account', 'name'])],
  }),

  // ───────── Ventas ─────────
  col('orders', {
    kind: 'doc', soft: true, perms: { read: OR }, loc: ['location'],
    fields: [
      num('order_number', { min: 1, onlyInt: true }),
      text('friendly_id', { max: 12 }),
      rel('series', 'order_series'),
      rel('location', 'locations', { required: true }),
      rel('client', 'clients', { required: true }),
      rel('seller', 'sellers'),
      rel('price_list', 'price_lists'),
      rel('quotation', 'quotations'),
      sel('origin', ORDER_ORIGIN, { required: true }),
      sel('payment_status', PAYMENT_STATUS, { required: true }),
      sel('shipping_status', SHIPPING_STATUS, { required: true }),
      sel('way_of_payment', WAY_OF_PAYMENT),
      sel('shipping_method', SHIPPING_METHOD),
      num('subtotal', { min: 0 }),
      num('discounts', { min: 0 }),
      num('original_total', { min: 0 }),
      num('total', { min: 0 }),
      bool('with_taxes'),
      num('delivery_cost', { min: 0 }),
      num('loyalty_reward_percentage', { min: 0, max: 100 }),
      text('notes', { max: 2000 }),
      date('made_at', { required: true }),
      text('request_id', { required: true, max: 60 }),     // idempotencia (UUID del cliente / venta offline)
      bool('is_offline'),
      rel('delivery_address', 'addresses'),
      rel('created_by', 'users'),                           // vacío en pedidos de la tienda en línea
    ],
    idx: [
      uniq(['account', 'request_id']),
      uniq(['account', 'series', 'order_number']),
      uniq(['account', 'friendly_id'], 'friendly_id != ""'),
      index(['account', 'location', 'made_at']),
      index(['client']),
    ],
  }),

  col('order_items', {
    kind: 'doc', perms: { read: OR }, loc: ['order.location'],
    fields: [
      rel('order', 'orders', { required: true, cascade: true }),
      rel('product', 'products'),                           // el producto puede borrarse (lógico); la partida conserva su snapshot
      text('name', { required: true, max: 200 }),
      sel('type', PRODUCT_TYPE, { required: true }),
      num('quantity', { min: 0 }),
      rel('unit', 'measure_units'),
      num('unit_price', { min: 0 }),                        // precio ANTES del descuento por partida
      num('total', { min: 0 }),                             // total DESPUÉS del descuento por partida
      sel('price_type', PRICE_TYPE),
      num('price_breakpoint', { min: 0 }),
      rel('price_list', 'price_lists'),
      rel('combo_parent', 'order_items'),
      rel('discount', 'order_item_discounts'),
    ],
    idx: [index(['order']), index(['product'])],
  }),
  col('order_item_costs', {
    kind: 'doc', perms: { read: COST }, loc: ['order_item.order.location'],
    fields: [
      rel('order_item', 'order_items', { required: true, cascade: true }),
      num('unit_cost', { min: 0 }),
      num('total_cost', { min: 0 }),
    ],
    idx: [uniq(['order_item'])],
  }),
  col('order_item_taxes', {
    kind: 'doc', perms: { read: OR }, loc: ['order_item.order.location'],
    fields: [
      rel('order_item', 'order_items', { required: true, cascade: true }),
      rel('tax', 'taxes', { required: true }),
      sel('type', ['vat', 'ieps', 'isr'], { required: true }),
      num('percentage', { min: 0 }),
      bool('is_withheld'),
      num('amount', { min: 0 }),                            // impuesto incluido en el total de la partida (0 si la venta es sin impuestos)
    ],
    idx: [index(['order_item'])],
  }),
  col('order_item_discounts', {
    kind: 'doc', perms: { read: OR },
    fields: [
      sel('type', DISCOUNT_TYPE, { required: true }),
      num('value', { min: 0 }),                             // % si percentage; monto si fixed
      text('title', { max: 120 }),
      rel('promotion', 'promotions'),
    ],
  }),
  col('order_item_batches', {
    kind: 'doc', perms: { read: OR }, loc: ['order_item.order.location'],
    fields: [
      rel('order_item', 'order_items', { required: true, cascade: true }),
      rel('batch', 'batches', { required: true }),
      num('quantity', { min: 0 }),
    ],
    idx: [index(['order_item'])],
  }),
  col('order_cart_discounts', {
    kind: 'doc', perms: { read: OR }, loc: ['order.location'],
    fields: [
      rel('order', 'orders', { required: true, cascade: true }),
      sel('type', DISCOUNT_TYPE, { required: true }),
      num('amount', { min: 0 }),
      text('title', { max: 120 }),
      rel('promotion', 'promotions'),
      num('loyalty_points_used', { min: 0 }),               // canje de puntos = descuento de carrito
    ],
    idx: [index(['order'])],
  }),

  col('unified_debt_payments', {
    kind: 'doc', soft: true, perms: { read: OR },
    fields: [rel('client', 'clients'), rel('created_by', 'users')],
  }),
  col('order_payments', {
    kind: 'doc', soft: true, perms: { read: OR }, loc: ['order.location'],
    fields: [
      rel('order', 'orders', { required: true, cascade: true }),
      sel('method', PAYMENT_METHOD, { required: true }),
      rel('custom_payment_method', 'custom_payment_methods'),
      num('total', { min: 0 }),
      num('change', { min: 0 }),
      rel('cashier', 'cashiers'),
      date('made_at', { required: true }),
      num('loyalty_points_reward', { min: 0 }),
      rel('settles_payment', 'order_payments'),             // abono → pago CREDIT que liquida (cancelsPaymentId)
      rel('unified_debt_payment', 'unified_debt_payments'),
      rel('created_by', 'users'),
    ],
    idx: [index(['order']), index(['account', 'cashier', 'made_at'])],
  }),
  col('order_debts', {
    kind: 'doc', perms: { read: OR }, loc: ['order.location'],
    fields: [
      rel('order', 'orders', { required: true, cascade: true }),
      num('original_debt', { min: 0 }),
      num('current_debt', { min: 0 }),
      date('due_date'),
      rel('credit_payment', 'order_payments'),
    ],
    idx: [uniq(['order']), index(['account', 'due_date'])],
  }),

  col('order_refunds', {
    kind: 'doc', perms: { read: OR }, loc: ['order.location'],
    fields: [
      rel('order', 'orders', { required: true, cascade: true }),
      sel('reason', REFUND_REASON, { required: true }),
      num('total_refunded', { min: 0 }),
      num('subtotal_refunded', { min: 0 }),
      num('cancelled_debt', { min: 0 }),
      rel('created_by', 'users'),
    ],
    idx: [index(['order'])],
  }),
  col('order_refund_items', {
    kind: 'doc', perms: { read: OR }, loc: ['refund.order.location'],
    fields: [
      rel('refund', 'order_refunds', { required: true, cascade: true }),
      rel('order_item', 'order_items', { required: true }),
      num('quantity_refunded', { min: 0 }),
    ],
    idx: [index(['refund'])],
  }),
  col('order_refund_item_batches', {
    kind: 'doc', perms: { read: OR }, loc: ['refund_item.refund.order.location'],
    fields: [
      rel('refund_item', 'order_refund_items', { required: true, cascade: true }),
      rel('batch', 'batches', { required: true }),
      num('quantity', { min: 0 }),
    ],
  }),
  col('order_refund_payments', {
    kind: 'doc', perms: { read: OR }, loc: ['refund.order.location'],
    fields: [
      rel('refund', 'order_refunds', { required: true, cascade: true }),
      sel('method', PAYMENT_METHOD, { required: true }),
      rel('custom_payment_method', 'custom_payment_methods'),
      num('total_refunded', { min: 0 }),
      rel('cashier', 'cashiers'),                           // sin caja, el reembolso no entra al corte
    ],
    idx: [index(['refund'])],
  }),

  // Bitácora de la venta (sustituye al JSON `events` de OrderJournal)
  col('order_events', {
    kind: 'doc', perms: { read: OR }, loc: ['order.location'],
    fields: [
      rel('order', 'orders', { required: true, cascade: true }),
      sel('type', ['product_delivery', 'products_committed', 'online_payment', 'cancel', 'refund_items', 'refund_items_returned_items', 'refund_payment', 'refund_cancelled_debt', 'comment'], { required: true }),
      rel('user', 'users'),
      rel('location', 'locations'),
      text('content', { max: 2000 }),
    ],
    idx: [index(['order'])],
  }),

  // ───────── Cotizaciones ─────────
  col('quotations', {
    kind: 'doc', soft: true, perms: { read: ['quotation.read'] }, loc: ['location'],
    fields: [
      num('number', { min: 1, onlyInt: true }),
      text('friendly_id', { max: 12 }),
      sel('status', ['created', 'sold'], { required: true }),
      rel('client', 'clients'),
      rel('seller', 'sellers'),
      rel('price_list', 'price_lists'),
      rel('location', 'locations'),
      date('valid_from'),
      date('expires_at'),
      text('client_note', { max: 2000 }),
      text('notes', { max: 2000 }),
      num('subtotal', { min: 0 }),
      bool('with_taxes'),
      rel('delivery_address', 'addresses'),
      rel('created_by', 'users'),
    ],
    idx: [uniq(['account', 'number']), uniq(['account', 'friendly_id'], 'friendly_id != ""')],
  }),
  col('quotation_items', {
    kind: 'doc', perms: { read: ['quotation.read'] }, loc: ['quotation.location'],
    fields: [
      rel('quotation', 'quotations', { required: true, cascade: true }),
      rel('product', 'products'),                           // vacío si es partida manual
      bool('is_manual'),
      text('name', { required: true, max: 200 }),
      num('manual_cost', { min: 0 }),
      sel('type', PRODUCT_TYPE, { required: true }),
      num('quantity', { min: 0 }),
      rel('unit', 'measure_units'),
      num('sell_price', { min: 0 }),
      num('total', { min: 0 }),
      sel('price_type', PRICE_TYPE),
      num('price_breakpoint', { min: 0 }),
      rel('price_list', 'price_lists'),
      rel('combo_parent', 'quotation_items'),
      rel('discount', 'quotation_item_discounts'),
    ],
    idx: [index(['quotation'])],
  }),
  col('quotation_item_taxes', {
    kind: 'doc', perms: { read: ['quotation.read'] }, loc: ['quotation_item.quotation.location'],
    fields: [
      rel('quotation_item', 'quotation_items', { required: true, cascade: true }),
      rel('tax', 'taxes', { required: true }),
      num('percentage', { min: 0 }),
      num('amount', { min: 0 }),
    ],
  }),
  col('quotation_item_discounts', {
    kind: 'doc', perms: { read: ['quotation.read'] },
    fields: [
      sel('type', DISCOUNT_TYPE, { required: true }), num('value', { min: 0 }),
      text('title', { max: 120 }), rel('promotion', 'promotions'),
    ],
  }),
  col('quotation_cart_discounts', {
    kind: 'doc', perms: { read: ['quotation.read'] }, loc: ['quotation.location'],
    fields: [
      rel('quotation', 'quotations', { required: true, cascade: true }),
      sel('type', DISCOUNT_TYPE, { required: true }), num('amount', { min: 0 }),
      text('title', { max: 120 }), rel('promotion', 'promotions'),
    ],
  }),
  col('quotation_events', {
    kind: 'doc', perms: { read: ['quotation.read'] }, loc: ['quotation.location'],
    fields: [
      rel('quotation', 'quotations', { required: true, cascade: true }),
      sel('type', ['created', 'updated', 'sold', 'comment'], { required: true }),
      text('content', { max: 2000 }), rel('user', 'users'),
    ],
  }),

  // ───────── Promociones ─────────
  col('promotions', {
    kind: 'master', soft: true,
    perms: { read: 'any', create: ['promotion.admin'], edit: ['promotion.admin'], delete: ['promotion.admin'] },
    fields: [
      text('name', { required: true, max: 120 }),
      sel('type', ['cart_total', 'single_target', 'multi_target', 'multi_target_advanced'], { required: true }),
      sel('application', ['manual', 'automatic'], { required: true }),
      date('valid_from'), date('valid_until'), date('ended_at'),
      sel('restrict_to_clients', ['no_restriction', 'registered_clients', 'clients_list'], { required: true }),
      // cart_total y single_target
      num('amount', { min: 0 }),
      sel('amount_type', DISCOUNT_TYPE),
      num('min_cart_subtotal', { min: 0 }),
      // multi_target
      sel('multi_target_type', ['two_for_one', 'three_for_two', 'second_fifty_percent', 'third_fifty_percent', 'custom', 'advanced']),
      num('trigger_quantity', { min: 0 }),
      num('discounted_quantity', { min: 0 }),
      num('discounted_percentage', { min: 0, max: 100 }),
      rels('price_lists', 'price_lists'),
      rels('locations', 'locations'),
      rel('created_by', 'users'),
      rel('last_updated_by', 'users'),
    ],
  }),
  // A qué producto o categoría aplica (single) / qué dispara y qué se descuenta (multi)
  col('promotion_targets', {
    kind: 'master',
    perms: { read: 'any', create: ['promotion.admin'], edit: ['promotion.admin'], delete: ['promotion.admin'] },
    fields: [
      rel('promotion', 'promotions', { required: true, cascade: true }),
      sel('role', ['single', 'trigger', 'discounted'], { required: true }),
      rel('product', 'products'),
      rel('category', 'product_categories'),
    ],
    idx: [index(['promotion'])],
  }),
  col('promotion_clients', {
    kind: 'master',
    perms: { read: 'any', create: ['promotion.admin'], edit: ['promotion.admin'], delete: ['promotion.admin'] },
    fields: [rel('promotion', 'promotions', { required: true, cascade: true }), rel('client', 'clients', { required: true, cascade: true })],
    idx: [uniq(['promotion', 'client'])],
  }),
  col('promotion_days', {
    kind: 'master',
    perms: { read: 'any', create: ['promotion.admin'], edit: ['promotion.admin'], delete: ['promotion.admin'] },
    fields: [rel('promotion', 'promotions', { required: true, cascade: true }), sel('weekday', WEEKDAY, { required: true })],
    idx: [uniq(['promotion', 'weekday'])],
  }),

  // ───────── Programa de lealtad ─────────
  col('loyalty_programs', {
    kind: 'config',
    fields: [
      num('reward_percentage', { min: 0, max: 100 }),
      num('min_cart_total', { min: 0 }),                    // 0 = sin mínimo
      date('deactivated_at'),
      rels('price_lists', 'price_lists'),
      rels('locations', 'locations'),
    ],
    idx: [uniq(['account'])],
  }),
  col('loyalty_product_rewards', {
    kind: 'config',
    fields: [rel('program', 'loyalty_programs', { required: true, cascade: true }), rel('product', 'products', { required: true }), num('reward_percentage', { min: 0, max: 100 })],
    idx: [uniq(['program', 'product'])],
  }),
  col('loyalty_category_rewards', {
    kind: 'config',
    fields: [rel('program', 'loyalty_programs', { required: true, cascade: true }), rel('category', 'product_categories', { required: true }), num('reward_percentage', { min: 0, max: 100 })],
    idx: [uniq(['program', 'category'])],
  }),
  // Libro mayor de puntos (append-only). 1 punto = $1.
  col('loyalty_movements', {
    kind: 'doc', perms: { read: CLIENT_READ },
    fields: [
      rel('client', 'clients', { required: true }),
      num('previous_quantity'),
      num('current_quantity'),
      sel('origin', LOYALTY_ORIGIN, { required: true }),
      rel('order', 'orders'),
      text('adjustment_reason', { max: 200 }),
      rel('created_by', 'users'),
    ],
    idx: [index(['account', 'client', 'created'])],
  }),
];
