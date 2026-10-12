#!/usr/bin/env node
// Pruebas de la tienda en línea contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8104';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const code = (r) => Object.keys(r.data?.data || {})[0];
const uuid = () => crypto.randomUUID();
const login = async (e, p) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: e, password: p } })).data;
const SU = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: process.env.SU_EMAIL, password: process.env.SU_PASS } })).data.token;
const list = async (col, q = '', token = SU) => (await api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token })).data.items;
const one = async (col, filter, token = SU) => (await list(col, `&filter=${encodeURIComponent(filter)}`, token))[0];
const post = (col, body, token = SU) => api('POST', `/api/collections/${col}/records`, { token, body });
const patch = (col, id, body, token = SU) => api('PATCH', `/api/collections/${col}/records/${id}`, { token, body });
const shop = (m, p, body, headers) => api(m, '/api/shop' + p, { body, headers });

await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Web', email: 'dueno@s.mx', password: 'password-dueno', name: 'Ana' } });
const tA = (await login('dueno@s.mx', 'password-dueno')).token;
const loc = (await list('locations'))[0], cashier = (await list('cashiers'))[0];
const unit = await one('measure_units', 'key="unit"'); const vat = await one('taxes', 'type="vat" && percentage=16 && is_exempt=false');
const defaultList = await one('price_lists', 'is_default=true');

console.log('── sin tienda ──');
let r = await shop('GET', '/config');
ok(r.status === 404 && code(r) === 'store_not_found', 'sin catálogo configurado → 404');

const may = (await post('price_lists', { name: 'Mayoreo', catalog_path: 'mayoreo', catalog_hidden: false }, tA)).data;
const oculta = (await post('price_lists', { name: 'Interna', catalog_path: 'interna', catalog_hidden: true }, tA)).data;
const cat = (await post('product_categories', { name: 'Bebidas' }, tA)).data;
const cat2 = (await post('product_categories', { name: 'Vacía' }, tA)).data;
const mk = async (name, price, stock, extra = {}, breaks = [], mayPrice = 0) => {
  const p = (await post('products', { name, type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, display_in_catalog: true, taxes: [vat.id], ...extra }, tA)).data;
  await post('product_costs', { product: p.id, cost: price / 2, cost_type: 'net' }, tA);
  await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: 0, price }, tA);
  for (const [m, pr] of breaks) await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: m, price: pr }, tA);
  if (mayPrice) await post('product_prices', { product: p.id, price_list: may.id, min_quantity: 0, price: mayPrice }, tA);
  if (stock !== null) await post('product_stocks', { product: p.id, location: loc.id, quantity: stock });
  return p;
};
const ref = await mk('Refresco', 15, 20, { category: cat.id, sku: 'REF' }, [[12, 13]], 11);
const jugo = await mk('Jugo', 50, 0, { category: cat.id });
const oculto = await mk('Secreto', 10, 5, { display_in_catalog: false });
const escondido = await mk('Escondido', 10, 5, { hidden_at: '2026-01-01 00:00:00.000Z' });
const sinPrecio = (await post('products', { name: 'SinPrecio', type: 'product', sell_unit: unit.id, is_sellable: true, display_in_catalog: true }, tA)).data;
const servicio = (await post('products', { name: 'Instalación', type: 'service', sell_unit: unit.id, is_sellable: true, display_in_catalog: true }, tA)).data;
await post('product_prices', { product: servicio.id, price_list: defaultList.id, min_quantity: 0, price: 300 }, tA);
const combo = (await post('products', { name: 'Combo', type: 'combo', sell_unit: unit.id, is_stockable: true, is_sellable: true, display_in_catalog: true }, tA)).data;
await post('product_prices', { product: combo.id, price_list: defaultList.id, min_quantity: 0, price: 40 }, tA);
await post('combo_items', { combo: combo.id, item: ref.id, quantity: 2 }, tA);
const catalog = (await post('catalogs', { subdomain: 'tiendaweb', name: 'Tienda Web', phone: '5551234567', products_without_stock: 'show', acquisition_limit: 'limit_to_stock', categories: 'show', location_of_origin: loc.id, volume_pricing_enabled: true, delivery_default_price: 40, bank_transfer_instructions: 'CLABE 0123', pickup_instructions: 'Mostrador' }, tA)).data;
for (const w of ['to_agree_after_purchase', 'bank_transfer', 'mercadopago']) await post('catalog_payment_ways', { catalog: catalog.id, way: w }, tA);
for (const m of ['pickup', 'delivery']) await post('catalog_shipping_methods', { catalog: catalog.id, method: m }, tA);
await post('catalog_stock_locations', { catalog: catalog.id, location: loc.id }, tA);

console.log('── lectura pública ──');
r = await shop('GET', '/config');
ok(r.status === 200 && r.data.name === 'Tienda Web' && r.data.variants.length === 1 && r.data.variants[0].path === 'mayoreo', 'config: nombre y variantes visibles (la oculta no)');
ok(r.data.payment_ways.map((w) => w.way).sort().join() === 'bank_transfer,to_agree_after_purchase', 'Mercado Pago no se ofrece sin credenciales');
ok(r.data.shipping_methods.find((m) => m.method === 'delivery').price === 40, 'envío a domicilio $40');
ok(!JSON.stringify(r.data).includes('access_token'), 'no expone credenciales');
r = await shop('GET', '/categories');
ok(r.data.items.length === 1 && r.data.items[0].name === 'Bebidas' && r.data.items[0].products === 2, 'solo categorías con productos visibles');
r = await shop('GET', '/products');
const names = r.data.items.map((p) => p.name).sort();
ok(r.status === 200 && names.join() === 'Combo,Instalación,Jugo,Refresco', `catálogo: ${names.join()}`);
ok(!JSON.stringify(r.data).includes('cost'), 'el costo nunca se expone');
const pr = r.data.items.find((p) => p.name === 'Refresco');
ok(pr.price === 15 && pr.available === 20 && pr.in_stock && pr.price_breakpoints.length === 2, 'precio, existencia y escalones');
ok(r.data.items.find((p) => p.name === 'Jugo').in_stock === false && r.data.items.find((p) => p.name === 'Instalación').available === null, 'sin stock marcado; servicio sin límite');
ok(r.data.items.find((p) => p.name === 'Combo').available === 10, 'el combo disponible = componentes (20 / 2 = 10)');
r = await shop('GET', '/products?q=ref');
ok(r.data.total === 1, 'búsqueda por nombre');
r = await shop('GET', `/products?category=${cat.id}&sort=price&direction=asc`);
ok(r.data.items.map((p) => p.name).join() === 'Refresco,Jugo', 'filtro por categoría y orden por precio');
r = await shop('GET', '/products?limit=2&offset=2&sort=name');
ok(r.data.items.length === 2 && r.data.total === 4, 'paginación');
r = await shop('GET', `/products/${pr.id}`);
ok(r.status === 200 && r.data.description !== undefined, 'detalle');
ok((await shop('GET', `/products/${oculto.id}`)).status === 404 && (await shop('GET', `/products/${escondido.id}`)).status === 404, 'ocultos y fuera de catálogo dan 404');
r = await shop('GET', '/products', null, { 'x-catalog-variant-slug': 'mayoreo' });
ok(r.data.items.find((p) => p.name === 'Refresco').price === 11 && r.data.items.find((p) => p.name === 'Jugo').price === 50, 'variante mayoreo: su precio (11) o, sin precio propio, el de la lista pública');
ok((await shop('GET', '/config', null, { 'x-catalog-variant-slug': 'interna' })).status === 404, 'variante oculta no existe');

console.log('── ocultar sin stock ──');
await patch('catalogs', catalog.id, { products_without_stock: 'hide' }, tA);
r = await shop('GET', '/products');
ok(!r.data.items.some((p) => p.name === 'Jugo') && r.data.total === 3, 'products_without_stock=hide');
await patch('catalogs', catalog.id, { products_without_stock: 'show' }, tA);

console.log('── carrito ──');
r = await shop('POST', '/cart/validate', { items: [{ product: { id: ref.id }, quantity: 12 }, { product: { id: jugo.id }, quantity: 1 }] });
ok(r.status === 200 && r.data.items[0].unit_price === 13 && r.data.items[0].total === 156 && r.data.items[1].has_enough_stock === false && r.data.valid === false, 'validar: escalón $13, jugo sin existencia → inválido');
r = await shop('POST', '/cart/validate', { items: [{ product: ref.id, quantity: 1 }, { product: ref.id, quantity: 1 }] });
ok(r.data.items.length === 1 && r.data.items[0].quantity === 2, 'líneas repetidas se suman');
ok((await shop('POST', '/cart/validate', { items: [] })).status === 400, 'carrito vacío');
ok(code(await shop('POST', '/cart/validate', { items: [{ product: oculto.id, quantity: 1 }] })) === 'product_unavailable', 'producto fuera de catálogo');
ok(code(await shop('POST', '/cart/validate', { items: [{ product: sinPrecio.id, quantity: 1 }] })) === 'no_price', 'producto sin precio no se vende');
ok(code(await shop('POST', '/cart/validate', { items: [{ product: ref.id, quantity: -1 }] })) === 'invalid_cart_item', 'cantidad negativa');

console.log('── pedido ──');
const cli = { name: 'María', phone: '772 123 4567', email: 'maria@x.mx' };
const rid = uuid();
r = await shop('POST', '/orders', { request_id: rid, client: cli, shipping_method: 'delivery', way_of_payment: 'bank_transfer', items: [{ product: ref.id, quantity: 12 }] });
ok(code(r) === 'address_required', 'la entrega a domicilio exige dirección');
const addr = { street: 'Reforma', ext_number: '10', postal_code: '42000', neighborhood: 'Centro', city: 'Pachuca', state_code: 'HGO' };
r = await shop('POST', '/orders', { request_id: rid, client: cli, shipping_method: 'delivery', way_of_payment: 'bank_transfer', delivery_address: addr, items: [{ product: ref.id, quantity: 12, unit_price: 1 }], total: 1 });
ok(r.status === 200, 'pedido creado');
const o1 = r.data;
ok(o1.subtotal === 156 && o1.delivery_cost === 40 && o1.total === 196, `precios del servidor: 12×13 + 40 = ${o1.total} (el cliente no puede fijar precio ni total)`);
ok(o1.payment_status === 'pending' && o1.shipping_status === 'pending' && o1.payment_instructions === 'CLABE 0123', 'pendiente de cobro/entrega, con instrucciones de pago');
const row = await one('orders', `id="${o1.id}"`);
ok(row.origin === 'online_catalog' && row.created_by === '' && row.location === loc.id, 'origin online_catalog, sin usuario, sucursal de origen');
const cl = await one('clients', `id="${row.client}"`);
ok(cl.type === 'account_client' && cl.phone === '+527721234567' && cl.name === 'María', 'cliente nuevo creado con teléfono normalizado');
r = await shop('POST', '/orders', { request_id: rid, client: cli, shipping_method: 'delivery', way_of_payment: 'bank_transfer', delivery_address: addr, items: [{ product: ref.id, quantity: 12 }] });
ok(r.status === 200 && r.data.idempotent === true && (await list('orders')).length === 1, 'mismo request_id no duplica');
ok((await one('product_stocks', `product="${ref.id}"`)).quantity === 20, 'el inventario no baja: se compromete');
r = await shop('GET', '/products');
ok(r.data.items.find((p) => p.name === 'Refresco').available === 8, 'disponible = 20 − 12 comprometidos');
r = await shop('POST', '/orders', { request_id: uuid(), client: cli, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: ref.id, quantity: 9 }] });
ok(r.status === 409 && code(r) === 'items_exceed_stock', 'LIMIT_TO_STOCK: no se pide más de lo disponible');
r = await shop('POST', '/orders', { request_id: uuid(), client: { name: 'María Otra', phone: '+52 (772) 123-4567' }, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: ref.id, quantity: 3 }, { product: servicio.id, quantity: 1 }] });
ok(r.status === 200 && r.data.total === 345 && (await list('clients', `&filter=${encodeURIComponent('type="account_client"')}`)).length === 1, 'mismo teléfono reutiliza al cliente; servicio incluido');
ok(code(await shop('POST', '/orders', { request_id: uuid(), client: cli, shipping_method: 'delivery', way_of_payment: 'mercadopago', delivery_address: addr, items: [{ product: ref.id, quantity: 1 }] })) === 'payment_way_unavailable', 'forma de pago no habilitada');
ok(code(await shop('POST', '/orders', { request_id: uuid(), client: { name: 'X', phone: '123' }, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: ref.id, quantity: 1 }] })) === 'invalid_phone', 'teléfono inválido');
ok(code(await shop('POST', '/orders', { client: cli, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: ref.id, quantity: 1 }] })) === 'request_id_required', 'request_id obligatorio');
r = await shop('POST', '/orders', { request_id: uuid(), client: cli, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: combo.id, quantity: 4 }] });
ok(r.status === 409, 'combo: 4 combos piden 8 refrescos y solo quedan 5');
r = await shop('POST', '/orders', { request_id: uuid(), client: cli, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: combo.id, quantity: 2 }] });
ok(r.status === 200 && (await list('order_items', `&filter=${encodeURIComponent(`order="${r.data.id}"`)}`)).length === 2, 'combo: partida + componente');
r = await shop('GET', `/orders/${o1.friendly_id}`);
ok(r.status === 200 && r.data.total === 196 && r.data.items.length === 1, 'seguimiento por folio corto');
ok((await shop('GET', '/orders/NOEXISTE')).status === 404, 'folio inexistente');

console.log('── catálogo del cliente ──');
await patch('catalogs', catalog.id, { client_catalogs_enabled: true }, tA);
r = await shop('GET', '/products', null, { 'x-catalog-client-code': cl.friendly_id });
ok(r.status === 200, 'código de cliente válido');
ok((await shop('GET', '/products', null, { 'x-catalog-client-code': 'ZZZZZZZ' })).status === 404, 'código inexistente');
await patch('clients', cl.id, { default_price_list: may.id }, tA);
r = await shop('POST', '/orders', { request_id: uuid(), shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: ref.id, quantity: 1 }] }, { 'x-catalog-client-code': cl.friendly_id });
ok(r.status === 200 && r.data.total === 11 && (await one('orders', `id="${r.data.id}"`)).client === cl.id, 'pedido del cliente: su lista (mayoreo $11) y sin pedir datos');

console.log('── cobro y entrega desde el POS ──');
await patch('license', (await list('license'))[0].id, { max_users: 10 });
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
await post('users', { email: 'caja@s.mx', password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: 'caja', role: 'user', locations: [loc.id], permissions: await Promise.all(['order.read', 'order.register_payment_and_shipping'].map(perm)) }, tA);
const tCaja = (await login('caja@s.mx', 'password-uu-1')).token;
r = await api('POST', `/api/tpv/orders/${o1.id}/payments`, { token: tCaja, body: { cashier: cashier.id, payments: [{ method: 'transfer', total: 196 }] } });
ok(r.status === 200, 'cobro del pedido en línea');
r = await api('POST', `/api/tpv/orders/${o1.id}/deliver`, { token: tCaja, body: {} });
ok(r.status === 200 && (await one('product_stocks', `product="${ref.id}"`)).quantity === 8, 'entregar baja el inventario real (20 → 8)');

console.log('── tienda desactivada / licencia ──');
await patch('catalogs', catalog.id, { deactivated_at: '2026-01-01 00:00:00.000Z' }, tA);
ok((await shop('GET', '/products')).status === 404, 'catálogo desactivado');
await patch('catalogs', catalog.id, { deactivated_at: '' }, tA);
const lic = (await list('license'))[0];
await patch('license', lic.id, { status: 'past_due' });
r = await shop('POST', '/orders', { request_id: uuid(), client: cli, shipping_method: 'pickup', way_of_payment: 'to_agree_after_purchase', items: [{ product: ref.id, quantity: 1 }] });
ok(r.status === 402, 'licencia en solo lectura: no acepta pedidos');
ok((await shop('GET', '/products')).status === 200, '…pero la tienda se puede ver');
await patch('license', lic.id, { status: 'suspended' });
ok((await shop('GET', '/products')).status === 503, 'licencia suspendida: tienda no disponible');

console.log(`\n${pass} correctas, ${fail} con falla`);
process.exit(fail ? 1 : 0);
