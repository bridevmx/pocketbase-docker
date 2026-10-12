#!/usr/bin/env node
// Pruebas de analítica contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8105';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
async function api(method, path, { token, body } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const code = (r) => Object.keys(r.data?.data || {})[0];
const uuid = () => crypto.randomUUID();
const near = (a, b, e = 0.011) => Math.abs(a - b) < e;
const login = async (e, p) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: e, password: p } })).data;
const SU = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: process.env.SU_EMAIL, password: process.env.SU_PASS } })).data.token;
const list = async (col, q = '', token = SU) => (await api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token })).data.items;
const one = async (col, filter, token = SU) => (await list(col, `&filter=${encodeURIComponent(filter)}`, token))[0];
const post = (col, body, token = SU) => api('POST', `/api/collections/${col}/records`, { token, body });
const patch = (col, id, body, token = SU) => api('PATCH', `/api/collections/${col}/records/${id}`, { token, body });
const call = (m, p, token, body) => api(m, p, { token, body });

await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Análisis', email: 'dueno@a.mx', password: 'password-dueno', name: 'Ana' } });
const tA = (await login('dueno@a.mx', 'password-dueno')).token;
const loc = (await list('locations'))[0], cashier = (await list('cashiers'))[0];
const unit = await one('measure_units', 'key="unit"');
const defaultList = await one('price_lists', 'is_default=true');
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
await patch('license', (await list('license'))[0].id, { max_users: 20, max_branches: 3 });
const loc2 = (await post('locations', { name: 'Sucursal 2', type: 'branch' }, SU)).data;
const mkUser = async (email, perms, locs = [loc.id]) => {
  await post('users', { email, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: email.split('@')[0], role: 'user', locations: locs, permissions: await Promise.all(perms.map(perm)) }, tA);
  return (await login(email, 'password-uu-1')).token;
};
const SELL = ['order.read', 'order.create', 'order.create_with_credit', 'order.admin_discount', 'order.refund', 'order.save_counter_order', 'order.cancel', 'order.register_payment_and_shipping', 'outlay.register_payment', 'cashier_audit.create'];
const tMgr = await mkUser('gerente@a.mx', [...SELL, 'product.read_cost', 'report.view_sales_reports', 'report.view_finance_reports', 'report.view_inventory_reports', 'report.view_purchases_reports']);
const tRep = await mkUser('reportes@a.mx', ['report.view_sales_reports']);
const tNo = await mkUser('nada@a.mx', ['order.read']);

const cat = (await post('product_categories', { name: 'Bebidas' }, tA)).data;
const mk = async (name, price, cost) => {
  const p = (await post('products', { name, type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, category: cat.id }, tA)).data;
  await post('product_costs', { product: p.id, cost, cost_type: 'net' }, tA);
  await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: 0, price }, tA);
  await post('product_stocks', { product: p.id, location: loc.id, quantity: 100, min_quantity: p.name === 'Jugo' ? 200 : 0 });
  return p;
};
const ref = await mk('Refresco', 15, 8), jugo = await mk('Jugo', 50, 20);
const juan = (await post('clients', { type: 'account_client', name: 'Juan', uses_default_debt_limit: true }, tA)).data;
const sale = (b) => call('POST', '/api/tpv/orders', tMgr, { request_id: uuid(), location: loc.id, cashier: cashier.id, ...b });
const s1 = await sale({ items: [{ product: ref.id, quantity: 4 }], payments: [{ method: 'cash', total: 60 }] });
const s2 = await sale({ items: [{ product: ref.id, quantity: 2 }, { product: jugo.id, quantity: 2 }], cart_discounts: [{ type: 'fixed', value: 10 }], payments: [{ method: 'card', total: 120 }] });
const s3 = await sale({ client: juan.id, items: [{ product: jugo.id, quantity: 1 }], payments: [{ method: 'credit' }], debt_due_date: '2020-01-01' });
ok(s1.status === 200 && s2.status === 200 && s3.status === 200, 'ventas de prueba creadas');
await call('POST', `/api/tpv/orders/${s3.data.order.id}/debt-payments`, tMgr, { method: 'cash', total: 20, cashier: cashier.id });
await call('POST', `/api/tpv/orders/${s1.data.order.id}/refund`, tMgr, { reason: 'other', items: [{ order_item: s1.data.items[0].id, quantity: 1 }], payments: [{ method: 'cash', total: 15, cashier: cashier.id }] });
await call('POST', '/api/tpv/purchases', tMgr, { request_id: uuid(), location: loc.id, cashier: cashier.id, items: [{ product: ref.id, quantity: 10, unit_cost: 10 }], payments: [{ method: 'cash', total: 50 }] });
await call('POST', '/api/tpv/expenses', tMgr, { location: loc.id, concept: 'Renta', total: 300, cashier: cashier.id, payments: [{ method: 'cash', total: 100 }] });
const s4 = await call('POST', '/api/tpv/orders', tMgr, { request_id: uuid(), location: loc.id, cashier: cashier.id, origin: 'pos_save_as_order', items: [{ product: jugo.id, quantity: 1 }], payments: [] });
await call('POST', `/api/tpv/orders/${s4.data.order.id}/cancel`, tMgr);

const get = (path, token = tMgr) => call('GET', '/api/tpv/analytics' + path, token);

console.log('── ventas ──');
let r = await get('/sales?group=day', tNo);
ok(r.status === 403, 'sin permiso no hay reportes');
r = await get('/sales?group=day&from=2026-13-01');
ok(r.status === 400 && code(r) === 'invalid_date', 'fecha inválida');
ok((await get('/sales?tz_offset=9999')).status === 400, 'tz_offset inválido');
ok((await get('/sales?group=otro')).status === 400, 'group inválido');
r = await get('/sales?group=day');
ok(r.status === 200 && r.data.items.length === 1 && r.data.items[0].orders === 3, 'por día: 3 ventas (la cancelada no cuenta)');
ok(near(r.data.totals.total, 230) && r.data.totals.orders === 3 && near(r.data.totals.average_ticket, 76.67), `total 230, ticket promedio ${r.data.totals.average_ticket}`);
ok(near(r.data.totals.refunds, 15) && near(r.data.totals.net_total, 215), 'reembolsos 15 → neto 215');
ok(near(r.data.items[0].cost, 108) && near(r.data.items[0].margin, 122), `costo 108, margen 122 (${r.data.items[0].margin})`);
r = await get('/sales?group=product');
const rp = r.data.items.find((i) => i.label === 'Refresco'), jp = r.data.items.find((i) => i.label === 'Jugo');
ok(rp.quantity === 6 && near(rp.total, 87.69) && jp.quantity === 3 && near(jp.total, 142.31), `por producto: Refresco ${rp.total}, Jugo ${jp.total} (descuento de carrito prorrateado)`);
ok(near(rp.cost, 48) && near(jp.cost, 60), 'costos por producto');
ok(near(r.data.items.reduce((s, i) => s + i.total, 0), 230), 'los productos suman el total de ventas');
r = await get('/sales?group=category');
ok(r.data.items.length === 1 && r.data.items[0].label === 'Bebidas' && near(r.data.items[0].total, 230), 'por categoría');
r = await get('/sales?group=client');
ok(r.data.items.some((i) => i.label === 'Juan' && near(i.total, 50)) && r.data.items.some((i) => i.total > 0 && i.label !== 'Juan'), 'por cliente');
r = await get('/sales?group=payment_method');
ok(near(r.data.items.find((i) => i.key === 'cash').total, 80) && near(r.data.items.find((i) => i.key === 'card').total, 120) && !r.data.items.some((i) => i.key === 'credit'), 'cobrado por método: efectivo 80 (60 + abono 20), tarjeta 120');
r = await get('/sales?group=seller');
ok(r.data.items[0].label === 'Sin vendedor', 'por vendedor');
r = await get('/sales?group=location');
ok(r.data.items.length === 1 && r.data.items[0].key === loc.id, 'por sucursal');
r = await get('/sales?group=month');
ok(r.data.items[0].key.length === 7, 'por mes');
r = await get('/sales?group=week');
ok(/^\d{4}-W\d{2}$/.test(r.data.items[0].key), 'por semana');
r = await get('/sales?group=day&payment_status=pending');
ok(r.data.totals.orders === 0, 'filtro por estado de cobro');
r = await get('/sales?group=day&from=2020-01-01&to=2020-01-31');
ok(r.data.items.length === 0 && r.data.totals.orders === 0, 'otro periodo vacío');
r = await get('/sales?group=product', tRep);
ok(r.status === 200 && r.data.items[0].cost === undefined && r.data.items[0].margin === undefined, 'sin product.read_cost no hay costos ni margen');
r = await get(`/sales?location=${loc2.id}`);
ok(r.status === 403 && code(r) === 'location_forbidden', 'no consulta sucursales ajenas');
r = await get(`/sales?location=${loc2.id}`, tA);
ok(r.status === 200 && r.data.totals.orders === 0, 'el admin sí, y la otra sucursal está vacía');

console.log('── inventario ──');
r = await get('/inventory');
const stRef = (await one('product_stocks', `product="${ref.id}"`)).quantity, stJug = (await one('product_stocks', `product="${jugo.id}"`)).quantity;
const ir = r.data.items.find((i) => i.name === 'Refresco'), ij = r.data.items.find((i) => i.name === 'Jugo');
ok(ir.quantity === stRef && ij.quantity === stJug, `existencias del reporte = saldos (${stRef}, ${stJug})`);
ok(ij.below_minimum === true && ir.below_minimum === false && r.data.totals.below_minimum === 1, 'Jugo bajo mínimo');
ok(near(r.data.totals.value, ir.value + ij.value) && ir.cost > 0, `valor del inventario ${r.data.totals.value}`);
r = await get('/inventory?low=true');
ok(r.data.items.length === 1 && r.data.items[0].name === 'Jugo', 'solo bajo mínimo');
await patch('users', (await one('users', 'email="reportes@a.mx"')).id, { permissions: [await perm('report.view_inventory_reports')] }, tA);
r = await get('/inventory', tRep);
ok(r.status === 200 && r.data.items[0].cost === undefined && r.data.totals.value === undefined, 'sin costo no hay valor de inventario');

console.log('── compras y gastos ──');
r = await get('/purchases?group=month');
ok(r.status === 200 && r.data.items.length === 1 && near(r.data.items[0].total, 100) && near(r.data.items[0].outstanding_debt, 50), 'compras del mes: 100, deuda 50');
r = await get('/purchases?group=product');
ok(r.data.items[0].label === 'Refresco' && r.data.items[0].quantity === 10, 'compras por producto');
r = await get('/purchases?group=provider');
ok(r.data.items[0].label === 'Sin proveedor', 'compras por proveedor');
r = await get('/expenses?group=concept');
ok(r.data.items[0].label === 'Renta' && near(r.data.items[0].total, 300) && near(r.data.items[0].outstanding_debt, 200), 'gastos por concepto, deuda 200');
ok((await get('/expenses?group=product')).status === 400, 'gastos no se agrupan por producto');
ok((await get('/purchases', tNo)).status === 403, 'compras exige permiso');

console.log('── finanzas ──');
r = await get('/finance');
ok(r.status === 200 && near(r.data.receivable.total, 30) && near(r.data.receivable.overdue, 30) && r.data.receivable.top_debtors[0].name === 'Juan', 'por cobrar 30 (vencido), Juan');
ok(near(r.data.payable.purchases.total, 50) && near(r.data.payable.expenses.total, 200) && near(r.data.payable.total, 250), 'por pagar 250');
ok(near(r.data.collected.total, 200), `cobrado en el periodo ${r.data.collected.total}`);
ok((await get('/finance', tRep)).status === 403, 'finanzas exige permiso');

console.log(`\n${pass} correctas, ${fail} con falla`);
process.exit(fail ? 1 : 0);
