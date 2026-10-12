// Valores por defecto al crear una cuenta (equivale al "seed" que hace Pulpos al registrarse).
// Se usa con require() DENTRO de los handlers (los hooks de PocketBase no comparten variables globales).

function mk(app, collection, data) {
  const r = new Record(app.findCollectionByNameOrId(collection));
  for (const k of Object.keys(data)) r.set(k, data[k]);
  app.save(r);
  return r;
}

function bootstrapAccount(app, account) {
  const acc = account.id;

  const priceList = mk(app, 'price_lists', { account: acc, name: 'Precio Público', is_default: true });
  const location = mk(app, 'locations', { account: acc, name: 'Sucursal Principal', type: 'branch', is_default: true, default_price_list: priceList.id });
  const series = mk(app, 'order_series', { account: acc, name: 'Principal', location: location.id, next_number: 1, is_default: true });
  mk(app, 'cashiers', { account: acc, name: 'Principal', location: location.id, order_series: series.id, is_default: true });

  // Cliente genérico para ventas de mostrador (evita clientId vacío en las ventas)
  mk(app, 'clients', { account: acc, type: 'general_public', name: 'Público en General', uses_default_debt_limit: true });

  mk(app, 'account_settings', {
    account: acc,
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

  for (const method of ['cash', 'card', 'transfer', 'credit', 'debit_card']) {
    mk(app, 'account_payment_methods', { account: acc, method, enabled: true });
  }
  for (const feature of ['manufacturing', 'bank_reconciliations', 'whatsapp_sales_channel']) {
    mk(app, 'account_features', { account: acc, feature, enabled: true });
  }
  const units = app.findRecordsByFilter('measure_units', 'key != ""', 'key', 100, 0);
  for (const u of units) mk(app, 'account_units', { account: acc, unit: u.id });
}

module.exports = { bootstrapAccount };
