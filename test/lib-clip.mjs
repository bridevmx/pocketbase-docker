// Utilidades de las pruebas de Clip: cliente HTTP mínimo y siembra de una tienda con un producto de $1.00.
export function client(URL_) {
  async function api(method, path, { token, body, headers } = {}) {
    const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  return api;
}

// Deja lista una instancia nueva (o ya sembrada): dueño, producto de $1.00 con existencia y tienda con pago Clip.
// Devuelve { product, catalog, owner: { email, password } }. Idempotente.
export async function seedStore(URL_, { suEmail, suPass }) {
  const api = client(URL_);
  const SU = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: suEmail, password: suPass } })).data?.token;
  if (!SU) throw new Error('No pude entrar como superusuario (SU_EMAIL / SU_PASS)');
  const list = async (col, q = '') => (await api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token: SU })).data.items;
  const one = async (col, filter) => (await list(col, `&filter=${encodeURIComponent(filter)}`))[0];
  const post = async (col, body) => { const r = await api('POST', `/api/collections/${col}/records`, { token: SU, body }); if (r.status >= 300) throw new Error(`${col}: ${JSON.stringify(r.data)}`); return r.data; };

  const owner = { email: 'dueno@clip.test', password: 'password-dueno-clip' };
  await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Clip', email: owner.email, password: owner.password, name: 'Dueño' } }); // 4xx si ya existe: se ignora

  let catalog = (await list('catalogs'))[0];
  let product = await one('products', 'name="Prueba Clip $1"');
  if (!product) {
    const loc = (await list('locations'))[0];
    const unit = await one('measure_units', 'key="unit"');
    const vat = await one('taxes', 'type="vat" && percentage=16 && is_exempt=false');
    const defaultList = await one('price_lists', 'is_default=true');
    product = await post('products', { name: 'Prueba Clip $1', type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, display_in_catalog: true, taxes: [vat.id] });
    await post('product_costs', { product: product.id, cost: 0.5, cost_type: 'net' });
    await post('product_prices', { product: product.id, price_list: defaultList.id, min_quantity: 0, price: 1 });
    await post('product_stocks', { product: product.id, location: loc.id, quantity: 50 });
    catalog = await post('catalogs', { subdomain: 'tiendaclip', name: 'Tienda Clip', phone: '5551234567', products_without_stock: 'show', acquisition_limit: 'limit_to_stock', categories: 'show', location_of_origin: loc.id, delivery_default_price: 0, pickup_instructions: 'Mostrador' });
    for (const w of ['to_agree_after_purchase', 'clip']) await post('catalog_payment_ways', { catalog: catalog.id, way: w });
    await post('catalog_shipping_methods', { catalog: catalog.id, method: 'pickup' });
    await post('catalog_stock_locations', { catalog: catalog.id, location: loc.id });
  }
  return { product, catalog, owner, SU, api };
}

export const orderBody = (product, extra = {}) => ({
  request_id: crypto.randomUUID(), client: { name: 'Cliente Prueba', phone: '5512345678', email: 'prueba@example.com' },
  items: [{ product: product.id, quantity: 1 }], shipping_method: 'pickup', way_of_payment: 'clip', ...extra,
});
