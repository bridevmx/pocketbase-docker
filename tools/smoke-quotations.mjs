#!/usr/bin/env node
// Pruebas de cotizaciones contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8103';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
async function api(method, path, { token, body } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
const call = (m, p, token, body) => api(m, p, { token, body });

await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Cot', email: 'dueno@q.mx', password: 'password-dueno', name: 'Ana' } });
const tA = (await login('dueno@q.mx', 'password-dueno')).token;
const loc = (await list('locations'))[0], cashier = (await list('cashiers'))[0];
const unit = await one('measure_units', 'key="unit"'); const vat = await one('taxes', 'type="vat" && percentage=16 && is_exempt=false');
const defaultList = await one('price_lists', 'is_default=true');
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
await patch('license', (await list('license'))[0].id, { max_users: 20 });
const mkUser = async (email, perms) => {
  await post('users', { email, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: email.split('@')[0], role: 'user', locations: [loc.id], permissions: await Promise.all(perms.map(perm)) }, tA);
  return (await login(email, 'password-uu-1')).token;
};
const tVen = await mkUser('vende@q.mx', ['quotation.read', 'quotation.create', 'quotation.edit', 'order.read', 'order.create']);
const tJefe = await mkUser('jefe@q.mx', ['quotation.read', 'quotation.create', 'quotation.edit', 'quotation.admin_discount', 'quotation.manage_manual_entry', 'quotation.apply_personalized_price', 'quotation.remove_and_add_taxes', 'order.read', 'order.create']);
const tNo = await mkUser('nada@q.mx', ['order.read']);
const mk = async (name, price, breaks = []) => {
  const p = (await post('products', { name, type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, taxes: [vat.id] }, tA)).data;
  await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: 0, price }, tA);
  for (const [m, pr] of breaks) await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: m, price: pr }, tA);
  await post('product_stocks', { product: p.id, location: loc.id, quantity: 100 });
  return p;
};
const ref = await mk('Refresco', 15, [[12, 13]]), jug = await mk('Jugo', 50);
const juan = (await post('clients', { type: 'account_client', name: 'Juan' }, tA)).data;

console.log('── crear ──');
let r = await call('POST', '/api/tpv/quotations', tNo, { location: loc.id, items: [{ product: ref.id, quantity: 1 }] });
ok(r.status === 403, 'sin permiso no cotiza');
r = await call('POST', '/api/tpv/quotations', tVen, { location: loc.id, client: juan.id, items: [{ product: ref.id, quantity: 12 }, { product: jug.id, quantity: 2 }] });
ok(r.status === 200 && r.data.number === 1 && r.data.status === 'created', 'cotización folio 1');
const q1 = r.data;
ok(q1.items[0].sell_price === 13 && q1.items[0].total === 156 && q1.items[0].price_breakpoint === 12, 'precio por escalón de cantidad (12 → $13)');
ok(q1.subtotal === 256 && q1.total === 256, 'subtotal 256 calculado por el servidor');
ok(q1.items[0].taxes.length === 1 && q1.items[0].taxes[0].percentage === 16, 'snapshot de impuestos del producto');
ok(/^[A-HJ-NP-Z1-9]{7}$/.test(q1.friendly_id) && q1.expires_at > q1.valid_from, 'folio corto y vigencia');
ok(q1.items.every((i) => i.manual_cost === undefined), 'el costo manual no se muestra sin product.read_cost');
r = await call('POST', '/api/tpv/quotations', tVen, { location: loc.id, items: [{ product: ref.id, quantity: 1, discount: { type: 'percentage', value: 10 } }] });
ok(code(r) === 'permission_denied', 'descuentos exigen quotation.admin_discount');
r = await call('POST', '/api/tpv/quotations', tVen, { location: loc.id, items: [{ product: ref.id, quantity: 1, unit_price: 1 }] });
ok(code(r) === 'permission_denied', 'precio personalizado exige permiso');
r = await call('POST', '/api/tpv/quotations', tVen, { location: loc.id, items: [{ manual: true, name: 'Flete', quantity: 1, sell_price: 100 }] });
ok(code(r) === 'permission_denied', 'partidas manuales exigen permiso');
r = await call('POST', '/api/tpv/quotations', tJefe, { location: loc.id, items: [{ product: ref.id, quantity: 10, discount: { type: 'percentage', value: 10 } }, { manual: true, name: 'Flete', quantity: 1, sell_price: 100, manual_cost: 60, taxes: [vat.id] }], cart_discounts: [{ type: 'fixed', value: 20, title: 'Cortesía' }] });
ok(r.status === 200, 'cotización con descuento, partida manual y descuento de carrito');
const q2 = r.data;
// 150 − 15 = 135; + 100 = 235; − 20 = 215
ok(q2.subtotal === 235 && q2.total === 215 && q2.items[1].is_manual && q2.items[1].product === '', `subtotal 235, total 215 (${q2.total})`);
r = await call('POST', '/api/tpv/quotations', tJefe, { location: loc.id, items: [{ product: ref.id, quantity: 1, discount: { type: 'fixed', value: 99 } }] });
ok(code(r) === 'invalid_discount', 'descuento mayor al importe se rechaza');

console.log('── editar / consultar ──');
r = await call('PUT', `/api/tpv/quotations/${q1.id}`, tVen, { location: loc.id, client: juan.id, items: [{ product: jug.id, quantity: 4 }] });
ok(r.status === 200 && r.data.subtotal === 200 && r.data.items.length === 1 && r.data.number === 1, 'editar reemplaza partidas y conserva folio');
ok((await list('quotation_items', `&filter=${encodeURIComponent(`quotation="${q1.id}"`)}`)).length === 1, '…sin dejar partidas huérfanas');
r = await call('GET', `/api/tpv/quotations/${q1.id}`, tVen);
ok(r.status === 200 && r.data.total === 200, 'consultar');
r = await call('GET', `/api/tpv/quotations/${q1.id}`, tNo);
ok(r.status === 403, 'consultar exige quotation.read');

console.log('── convertir ──');
r = await call('POST', `/api/tpv/quotations/${q2.id}/convert`, tJefe, { request_id: uuid(), cashier: cashier.id, payments: [{ method: 'cash', total: 215 }] });
ok(code(r) === 'manual_items_not_sellable', 'con partidas manuales no se convierte');
r = await call('POST', `/api/tpv/quotations/${q1.id}/convert`, tVen, { request_id: uuid(), cashier: cashier.id, payments: [{ method: 'cash', total: 200 }] });
ok(r.status === 200 && r.data.order.total === 200 && r.data.order.client === juan.id && r.data.order.quotation === q1.id, 'convertida en venta de $200 con su cliente');
ok((await one('quotations', `id="${q1.id}"`)).status === 'sold', 'la cotización pasa a sold');
r = await call('PUT', `/api/tpv/quotations/${q1.id}`, tVen, { location: loc.id, items: [{ product: jug.id, quantity: 1 }] });
ok(r.status === 409, 'una cotización vendida no se edita');
r = await call('DELETE', `/api/tpv/quotations/${q1.id}`, tVen);
ok(r.status === 409, 'ni se borra');
r = await call('DELETE', `/api/tpv/quotations/${q2.id}`, tVen);
ok(r.status === 200 && (await call('GET', `/api/tpv/quotations/${q2.id}`, tVen)).status === 404, 'borrar una cotización vigente');
const q3 = (await call('POST', '/api/tpv/quotations', tVen, { location: loc.id, items: [{ product: jug.id, quantity: 1 }] })).data;
await patch('quotations', q3.id, { expires_at: '2020-01-01 00:00:00.000Z' });
r = await call('POST', `/api/tpv/quotations/${q3.id}/convert`, tVen, { request_id: uuid(), cashier: cashier.id, payments: [{ method: 'cash', total: 50 }] });
ok(code(r) === 'quotation_expired', 'una cotización vencida no se convierte');

console.log(`\n${pass} correctas, ${fail} con falla`);
process.exit(fail ? 1 : 0);
