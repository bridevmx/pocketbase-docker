// Valores por defecto del negocio (equivale al "seed" que hace Pulpos al registrarse).
// Se usa con require() DENTRO de los handlers (los hooks de PocketBase no comparten variables globales).

function mk(app, collection, data) {
  const r = new Record(app.findCollectionByNameOrId(collection));
  for (const k of Object.keys(data)) r.set(k, data[k]);
  app.save(r);
  return r;
}

function bootstrapBusiness(app) {
  const priceList = mk(app, 'price_lists', { name: 'Precio Público', is_default: true });
  const location = mk(app, 'locations', { name: 'Sucursal Principal', type: 'branch', is_default: true, default_price_list: priceList.id });
  const series = mk(app, 'order_series', { name: 'Principal', location: location.id, next_number: 1, is_default: true });
  mk(app, 'cashiers', { name: 'Principal', location: location.id, order_series: series.id, is_default: true });

  // Cliente genérico para ventas de mostrador (evita cliente vacío en las ventas)
  mk(app, 'clients', { type: 'general_public', name: 'Público en General', uses_default_debt_limit: true });

  mk(app, 'pos_settings', {
    allow_personalized_prices: true,
    show_portal_url_on_tickets: true,
    show_portal_url_on_pdfs: true,
    batch_strategy: 'manual',
    min_profit_margin_policy: 'block',
    quotation_default_validity_days: 7,
    manufacturing_default_location: location.id,
    ticket_printing_mode: 'system_printing',
    ticket_print_on_sale: true,
    ticket_print_on_counter_order: true,
  });

  for (const method of ['cash', 'card', 'transfer', 'credit', 'debit_card']) mk(app, 'enabled_payment_methods', { method, enabled: true });
  for (const u of app.findRecordsByFilter('measure_units', 'key != ""', 'key', 100, 0)) mk(app, 'enabled_units', { unit: u.id });
}

module.exports = { bootstrapBusiness };
