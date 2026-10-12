import { col, text, num, bool, date, sel, file, email, rel, rels, photos, uniq, index } from './lib.mjs';
import { BUSINESS_TYPE, FEATURE, PAYMENT_METHOD } from './enums.mjs';

const T = '@request.auth.id != "" && @request.auth.account = account';

export default [
  // ───────── Negocio ─────────
  col('accounts', {
    kind: 'custom', noAccount: true,
    fields: [
      text('name', { required: true, max: 200 }),
      sel('business_type', BUSINESS_TYPE),
      sel('type_of_sale', ['retail', 'wholesale']),
      sel('currency', ['mxn'], { required: true }),
      text('phone', { max: 30 }),
      email('email'),
      photos('logo', 1),
      rel('owner', 'users'),
      // Suscripción: el estado lo cambian el servidor/superusuario (cobro), nunca el cliente
      rel('plan', 'plans'),
      sel('status', ['trial', 'active', 'past_due', 'suspended', 'cancelled'], { required: true }),
      date('trial_ends_at'),
      date('paid_until'),
    ],
    rules: {
      list: '@request.auth.id != "" && @request.auth.account = id',
      view: '@request.auth.id != "" && @request.auth.account = id',
      create: null, delete: null,
      update: '@request.auth.id != "" && @request.auth.account = id && @request.auth.role = "admin" && @request.body.plan:isset = false && @request.body.status:isset = false && @request.body.trial_ends_at:isset = false && @request.body.paid_until:isset = false && @request.body.owner:isset = false',
    },
  }),

  // Usuarios: se extiende la colección auth `users` que trae PocketBase.
  col('users', {
    kind: 'custom', noAccount: true, extend: true,
    fields: [
      text('surname', { max: 120 }),
      text('phone', { max: 30 }),
      sel('role', ['admin', 'user'], { required: true }),
      bool('is_account_owner'),
      date('deleted_at'),
      rel('account', 'accounts', { required: true, cascade: true }),
      rel('default_price_list', 'price_lists'),
      // listas de acceso (M:N puras) y permisos finos
      rels('locations', 'locations'),
      rels('cashiers', 'cashiers'),
      rels('price_lists', 'price_lists'),
      rels('permissions', 'permissions'),
    ],
    idx: [index(['account'])],
    rules: {
      list: T, view: T,
      create: '@request.auth.role = "admin" && @request.body.account = @request.auth.account && @request.body.is_account_owner:isset = false',
      update: T + ' && @request.body.account:isset = false && @request.body.is_account_owner:isset = false && (@request.auth.role = "admin" || (id = @request.auth.id && @request.body.role:isset = false && @request.body.permissions:isset = false && @request.body.locations:isset = false && @request.body.cashiers:isset = false && @request.body.price_lists:isset = false))',
      delete: T + ' && @request.auth.role = "admin" && id != @request.auth.id && is_account_owner = false',
    },
  }),

  // Catálogo global de permisos finos (equivale a advancedPermissions de Pulpos)
  col('permissions', {
    kind: 'lookup', noAccount: true,
    fields: [
      text('key', { required: true, max: 100 }),
      text('subject', { required: true, max: 60 }),
      text('action', { required: true, max: 60 }),
      rels('requires', 'permissions'),
    ],
    idx: [uniq(['key'])],
  }),

  // Planes y límites (editables por el superusuario). Los add-ons suman a estos topes.
  col('plans', {
    kind: 'lookup', noAccount: true,
    fields: [
      text('code', { required: true, max: 40 }),
      text('name', { required: true, max: 80 }),
      num('max_users', { min: 1, onlyInt: true }),
      num('max_branches', { min: 1, onlyInt: true }),
      num('max_warehouses', { min: 0, onlyInt: true }),
      num('position', { min: 0, onlyInt: true }),
    ],
    idx: [uniq(['code'])],
  }),
  col('plan_features', {
    kind: 'lookup', noAccount: true,
    fields: [rel('plan', 'plans', { required: true, cascade: true }), sel('feature', FEATURE, { required: true })],
    idx: [uniq(['plan', 'feature'])],
  }),

  col('measure_units', {
    kind: 'lookup', noAccount: true,
    fields: [
      text('key', { required: true, max: 40 }),
      text('name_singular', { required: true, max: 80 }),
      text('name_plural', { required: true, max: 80 }),
      text('abbreviation', { max: 20 }),
    ],
    idx: [uniq(['key'])],
  }),

  // Impuestos: globales (account vacío) o propios de la cuenta
  col('taxes', {
    kind: 'config', optionalAccount: true, soft: false,
    rules: {
      list: '@request.auth.id != "" && (account = "" || account = @request.auth.account)',
      view: '@request.auth.id != "" && (account = "" || account = @request.auth.account)',
      create: '@request.auth.role = "admin" && @request.body.account = @request.auth.account',
      update: '@request.auth.role = "admin" && account = @request.auth.account && @request.body.account:isset = false',
      delete: '@request.auth.role = "admin" && account = @request.auth.account',
    },
    fields: [
      sel('type', ['vat', 'ieps', 'isr'], { required: true }),
      text('name', { max: 80 }),
      num('percentage', { min: 0 }),
      bool('is_exempt'),
      bool('is_withheld'),
    ],
  }),

  col('addresses', {
    kind: 'master', perms: { read: 'any', create: ['order.create', 'client.create', 'client.edit'], edit: ['order.edit', 'client.edit'], delete: ['client.edit'] },
    fields: [
      text('street', { max: 200 }), text('ext_number', { max: 30 }), text('int_number', { max: 30 }),
      text('postal_code', { max: 10 }), text('neighborhood', { max: 120 }), text('district', { max: 120 }),
      text('city', { max: 120 }), text('state_code', { max: 10 }), text('country', { max: 4 }),
    ],
  }),

  // ───────── Ubicaciones, cajas y series ─────────
  col('locations', {
    kind: 'config', soft: true,
    fields: [
      text('name', { required: true, max: 120 }),
      sel('type', ['branch', 'warehouse'], { required: true }),
      bool('is_default'),
      text('phone', { max: 30 }),
      email('email'),
      rel('address', 'addresses'),
      rel('default_price_list', 'price_lists'),
    ],
    idx: [index(['account', 'type'])],
  }),

  col('price_lists', {
    kind: 'config', soft: true,
    fields: [
      text('name', { required: true, max: 120 }),
      bool('is_default'),
      // equivale a CatalogVariantConfig: ruta pública de esa lista en la tienda en línea
      text('catalog_path', { max: 60, pattern: '^[a-z0-9]*$' }),
      bool('catalog_hidden'),
    ],
    idx: [uniq(['account', 'catalog_path'], 'catalog_path != "" AND deleted_at = ""')],
  }),

  col('order_series', {
    kind: 'config', soft: true,
    fields: [
      text('name', { required: true, max: 60 }),
      rel('location', 'locations'),
      num('next_number', { min: 1 }),
      bool('is_default'),
    ],
  }),

  col('cashiers', {
    kind: 'config', soft: true,
    fields: [
      text('name', { required: true, max: 120 }),
      rel('location', 'locations', { required: true }),
      rel('order_series', 'order_series'),
      bool('is_default'),
    ],
    idx: [index(['account', 'location'])],
  }),

  col('sellers', {
    kind: 'config', soft: true,
    fields: [
      rel('user', 'users'),
      text('name', { required: true, max: 120 }),
      text('surname', { max: 120 }),
    ],
  }),

  // ───────── Configuración (1 fila por cuenta; sustituye a las *Settings de Pulpos) ─────────
  col('account_settings', {
    kind: 'config',
    fields: [
      bool('allow_personalized_prices'),
      bool('white_label_branding'),
      num('default_client_debt_limit', { min: 0 }),          // 0 = sin límite por defecto
      bool('show_portal_url_on_tickets'),
      bool('show_portal_url_on_pdfs'),
      // ventas
      sel('batch_strategy', ['manual', 'automatic'], { required: true }),
      bool('allow_selling_out_of_stock'),
      bool('notify_insufficient_stock_for_sale'),
      bool('restrict_selling_to_clients_with_overdue_debt'),
      bool('min_profit_margin_enabled'),
      num('min_profit_margin', { min: 0, max: 100 }),
      sel('min_profit_margin_policy', ['warn', 'block']),
      // inventario
      bool('allow_negative_stock_movements'),
      bool('notify_negative_stock_movements'),
      // cotizaciones
      bool('quotation_breakdown_taxes'),
      bool('quotation_notify_insufficient_stock'),
      text('quotation_fixed_note', { max: 1000 }),
      num('quotation_default_validity_days', { min: 0, onlyInt: true }),
      // fabricación
      rel('manufacturing_default_location', 'locations'),
      bool('manufacturing_allow_materials_out_of_stock'),
      // ticket
      sel('ticket_printing_mode', ['system_printing', 'zadig_printing']),
      text('ticket_header', { max: 500 }),
      text('ticket_footer', { max: 500 }),
      bool('ticket_print_on_sale'),
      bool('ticket_print_on_counter_order'),
      bool('ticket_print_duplicate'),
      photos('ticket_logo', 1),
    ],
    idx: [uniq(['account'])],
  }),

  // Add-ons comprados (extra_user, extra_branch…): solo los escribe el servidor/superusuario
  col('account_features', {
    kind: 'custom',
    rules: { list: T, view: T, create: null, update: null, delete: null },
    fields: [
      sel('feature', FEATURE, { required: true }),
      bool('enabled'),
      num('quantity', { min: 0, onlyInt: true }),
    ],
    idx: [uniq(['account', 'feature'])],
  }),

  col('account_units', {
    kind: 'config',
    fields: [rel('unit', 'measure_units', { required: true })],
    idx: [uniq(['account', 'unit'])],
  }),

  col('account_payment_methods', {
    kind: 'config',
    fields: [sel('method', PAYMENT_METHOD, { required: true }), bool('enabled')],
    idx: [uniq(['account', 'method'])],
  }),

  col('custom_payment_methods', {
    kind: 'config', soft: true,
    fields: [
      text('name', { required: true, max: 80 }),
      sel('method', PAYMENT_METHOD, { required: true }),
      bool('allows_income'),
      bool('allows_spend'),
      bool('hidden'),
    ],
  }),

  // Consecutivos por cuenta (folios de compras, traspasos, ajustes…). Solo los hooks escriben.
  col('counters', {
    kind: 'system',
    fields: [text('key', { required: true, max: 60 }), num('value', { min: 0, onlyInt: true })],
    idx: [uniq(['account', 'key'])],
  }),
];
