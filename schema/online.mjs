import { col, text, num, bool, date, sel, rel, photos, uniq } from './lib.mjs';

// Catálogo en línea. La tienda pública NO lee estas colecciones directamente:
// se sirve desde rutas propias (hooks) que exponen solo lo necesario, como hace Pulpos.
export default [
  col('catalogs', {
    kind: 'config',
    fields: [
      text('subdomain', { required: true, max: 40, pattern: '^[a-z0-9]+$' }),
      date('deactivated_at'),
      text('name', { required: true, max: 120 }),
      text('phone', { max: 30 }), text('facebook', { max: 200 }), text('instagram', { max: 200 }),
      text('support_whatsapp', { max: 30 }), text('email_contact', { max: 200 }),
      sel('products_without_stock', ['show', 'hide']),
      sel('acquisition_limit', ['limit_to_stock', 'unlimited']),
      sel('categories', ['show', 'hide']),
      rel('location_of_origin', 'locations'),
      bool('shared_in_instagram'), bool('shared_in_whatsapp'),
      sel('ui_variant', ['retail', 'wholesale']),
      bool('client_catalogs_enabled'),
      bool('volume_pricing_enabled'),
      // envío y pago (antes tablas 1:1 CatalogOrder*Configuration)
      rel('pickup_address', 'addresses'),
      text('pickup_instructions', { max: 1000 }),
      text('delivery_instructions', { max: 1000 }),
      num('delivery_default_price', { min: 0 }),
      text('agreed_shipping_instructions', { max: 1000 }),
      text('bank_transfer_instructions', { max: 1000 }),
      text('agreed_payment_instructions', { max: 1000 }),
      text('credit_instructions', { max: 1000 }),
      text('collect_on_delivery_instructions', { max: 1000 }),
      // portada (antes CatalogHomePagePersonalization)
      bool('home_active'), bool('home_show_hero'),
      text('home_title', { max: 200 }), text('home_main_button_text', { max: 80 }),
      photos('home_hero_photo', 1),
    ],
    idx: [uniq(['account']), uniq(['subdomain'])],
  }),
  col('catalog_payment_ways', {
    kind: 'config',
    fields: [rel('catalog', 'catalogs', { required: true, cascade: true }), sel('way', ['to_agree_after_purchase', 'mercadopago', 'clip', 'bank_transfer', 'credit', 'collect_on_delivery'], { required: true })],
    idx: [uniq(['catalog', 'way'])],
  }),
  col('catalog_shipping_methods', {
    kind: 'config',
    fields: [rel('catalog', 'catalogs', { required: true, cascade: true }), sel('method', ['to_agree_after_purchase', 'pickup', 'delivery'], { required: true })],
    idx: [uniq(['catalog', 'method'])],
  }),
  col('catalog_banners', {
    kind: 'config',
    fields: [rel('catalog', 'catalogs', { required: true, cascade: true }), photos('image', 1), sel('type', ['promotional'])],
  }),
  // Sucursales cuyo stock se muestra en la tienda
  col('catalog_stock_locations', {
    kind: 'config',
    fields: [rel('catalog', 'catalogs', { required: true, cascade: true }), rel('location', 'locations', { required: true })],
    idx: [uniq(['catalog', 'location'])],
  }),
  col('mercadopago_credentials', {
    kind: 'system',
    fields: [
      text('access_token', { hidden: true, max: 500 }),
      text('refresh_token', { hidden: true, max: 500 }),
      date('expires_at'),
      text('mercadopago_user_id', { max: 60 }),
      text('public_key', { max: 200 }),
    ],
    idx: [uniq(['account'])],
  }),
];
