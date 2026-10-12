#!/usr/bin/env node
// Pruebas de inventario, compras, gastos, traspasos y fabricación contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8101';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
async function api(method, path, { token, body } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const code = (r) => Object.keys(r.data?.data || {})[0];
const uuid = () => crypto.randomUUID();
const near = (a, b, e = 0.001) => Math.abs(a - b) < e;
const login = async (e, p) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: e, password: p } })).data;
const SU = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: process.env.SU_EMAIL, password: process.env.SU_PASS } })).data.token;
const list = async (col, q = '', token = SU) => (await api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token })).data.items;
const one = async (col, filter, token = SU) => (await list(col, `&filter=${encodeURIComponent(filter)}`, token))[0];
const post = (col, body, token = SU) => api('POST', `/api/collections/${col}/records`, { token, body });
const patch = (col, id, body, token = SU) => api('PATCH', `/api/collections/${col}/records/${id}`, { token, body });
const call = (m, p, token, body) => api(m, p, { token, body });

await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Inv', email: 'dueno@i.mx', password: 'password-dueno', name: 'Ana' } });
const tA = (await login('dueno@i.mx', 'password-dueno')).token;
const loc = (await list('locations'))[0], cashier = (await list('cashiers'))[0];
const unit = await one('measure_units', 'key="unit"'); const vat = await one('taxes', 'type="vat" && percentage=16 && is_exempt=false');
const defaultList = await one('price_lists', 'is_default=true');
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
const mkUser = async (email, perms) => {
  await post('users', { email, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: email.split('@')[0], role: 'user', locations: [loc.id], permissions: await Promise.all(perms.map(perm)) }, tA);
  return (await login(email, 'password-uu-1')).token;
};
const lic = (await list('license'))[0];
await patch('license', lic.id, { max_users: 20, max_branches: 3, max_warehouses: 2 });
const wh = (await post('locations', { name: 'Bodega', type: 'warehouse' }, SU)).data;
const tNone = await mkUser('nada@i.mx', ['order.read']);
const tAdj = await mkUser('ajustes@i.mx', ['stock_adjustment.read', 'stock_adjustment.manage_draft']);
const tCompra = await mkUser('compras@i.mx', ['outlay.read', 'outlay.register_payment']);

const mk = async (name, extra = {}) => {
  const p = (await post('products', { name, type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, ...extra }, tA)).data;
  await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: 0, price: 20 }, tA);
  return p;
};
const refresco = await mk('Refresco'), harina = await mk('Harina'), pan = await mk('Pan', { is_manufactured: true });
const leche = await mk('Leche', { batches_enabled: true });
const servicio = (await post('products', { name: 'Servicio', type: 'service', sell_unit: unit.id }, tA)).data;
const stock = async (p, l = loc) => (await one('product_stocks', `product="${p.id}" && location="${l.id}"`))?.quantity ?? 0;
const bstock = async (b, l = loc) => (await one('batch_stocks', `batch="${b}" && location="${l.id}"`))?.quantity ?? 0;
const cost = async (p) => (await one('product_costs', `product="${p.id}"`))?.cost;

console.log('── ajustes ──');
let r = await call('POST', '/api/tpv/stock-adjustments', tNone, { type: 'entry', location: loc.id, items: [{ product: refresco.id, quantity: 1 }] });
ok(r.status === 403 && code(r) === 'permission_denied', 'sin permiso no completa ajustes');
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'entry', location: loc.id, items: [{ product: servicio.id, quantity: 1 }] });
ok(r.status === 400 && code(r) === 'not_stockable', 'un servicio no maneja inventario');
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'entry', location: loc.id, reason: 'correction', items: [{ product: refresco.id, quantity: 100, unit_cost: 8 }, { product: harina.id, quantity: 50, unit_cost: 12 }] });
ok(r.status === 200 && r.data.status === 'completed' && r.data.number === 1, 'carga inicial completada (folio 1)');
ok(await stock(refresco) === 100 && await stock(harina) === 50, 'saldos cargados');
ok(await cost(refresco) === 8 && await cost(harina) === 12, 'primer costo = costo de la entrada');
const mv = await list('stock_movements', `&filter=${encodeURIComponent(`stock_adjustment="${r.data.id}"`)}`);
ok(mv.length === 2 && mv.every((m) => m.origin === 'stock_adjustment' && m.previous_quantity === 0), 'libro de movimientos con origen stock_adjustment');
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'exit', location: loc.id, reason: 'theft_or_loss', items: [{ product: refresco.id, quantity: 500 }] });
ok(r.status === 409 && code(r) === 'insufficient_stock', 'salida mayor a la existencia se rechaza');
ok(await stock(refresco) === 100, '…y no deja cambios a medias (transacción)');
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'exit', location: loc.id, reason: 'theft_or_loss', items: [{ product: refresco.id, quantity: 29 }] });
ok(r.status === 200 && await stock(refresco) === 71, 'salida por merma: 71');
const exitId = r.data.id;
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'count', location: loc.id, reason: 'recount', items: [{ product: harina.id, quantity: 47 }] });
ok(r.status === 200 && await stock(harina) === 47, 'conteo fija la existencia en 47');
ok((await one('stock_adjustment_items', `stock_adjustment="${r.data.id}"`)).previous_quantity === 50, 'el conteo guarda la existencia previa (50)');
// borrador → completar
r = await call('POST', '/api/tpv/stock-adjustments', tAdj, { type: 'entry', status: 'draft', location: loc.id, items: [{ product: harina.id, quantity: 3 }] });
ok(r.status === 200 && r.data.status === 'draft' && await stock(harina) === 47, 'borrador no mueve inventario');
const draftId = r.data.id;
r = await call('POST', `/api/tpv/stock-adjustments/${draftId}/complete`, tAdj, {});
ok(r.status === 403, 'quien solo maneja borradores no puede completar');
r = await call('POST', `/api/tpv/stock-adjustments/${draftId}/complete`, tA, {});
ok(r.status === 200 && await stock(harina) === 50, 'completar borrador aplica +3');
r = await call('POST', `/api/tpv/stock-adjustments/${draftId}/complete`, tA, {});
ok(r.status === 409, 'no se completa dos veces');
r = await call('DELETE', `/api/tpv/stock-adjustments/${exitId}`, tA);
ok(r.status === 200 && await stock(refresco) === 100, 'borrar un ajuste completado revierte el inventario');
ok((await list('stock_movements', `&filter=${encodeURIComponent('origin="stock_adjustment_delete"')}`)).length === 1, '…con movimiento stock_adjustment_delete');
await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'exit', location: loc.id, reason: 'gift', items: [{ product: refresco.id, quantity: 29 }] });
// lotes
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'entry', location: loc.id, items: [{ product: leche.id, batches: [{ code: 'L1', expires_at: '2026-12-31', quantity: 30 }, { code: 'L2', expires_at: '2027-02-01', quantity: 20 }] }] });
ok(r.status === 200, 'entrada con lotes nuevos');
const b1 = await one('batches', `product="${leche.id}" && code="L1"`), b2 = await one('batches', `product="${leche.id}" && code="L2"`);
ok(b1 && b2 && await bstock(b1.id) === 30 && await bstock(b2.id) === 20, 'saldos por lote');
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'entry', location: loc.id, items: [{ product: leche.id, quantity: 5 }] });
ok(r.status === 400 && code(r) === 'batches_required', 'producto con lotes exige lotes');

console.log('── compras ──');
const prov = (await post('providers', { name: 'Distribuidora' }, tA)).data;
let reqP = uuid();
const purchaseBody = { request_id: reqP, location: loc.id, provider: prov.id, cashier: cashier.id, due_date: '2027-01-15', folio: 'F-1', items: [{ product: refresco.id, quantity: 10, unit_cost: 10 }, { product: harina.id, quantity: 10, unit_cost: 10, discount_percentage: 10, taxes: [vat.id] }], payments: [{ method: 'cash', total: 50 }] };
r = await call('POST', '/api/tpv/purchases', tNone, purchaseBody);
ok(r.status === 403, 'sin permiso no registra compras');
r = await call('POST', '/api/tpv/purchases', tCompra, purchaseBody);
ok(r.status === 200 && r.data.status === 'completed', 'compra registrada');
const pu = r.data;
// refresco: 71 @8 + 10 @10 → (71*8+10*10)/81
ok(await stock(refresco) === 81 && near(await cost(refresco), 8.2469, 0.0001), `costo promedio ponderado refresco = ${await cost(refresco)} (8.2469)`);
// harina: 50 @12, 10 @ 9 neto → (50*12+10*9)/60 = 11.5
ok(await stock(harina) === 60 && near(await cost(harina), 11.5), `costo promedio con descuento = ${await cost(harina)} (11.5)`);
// total: 100 + (90 + 14.40) = 204.40
ok(near(pu.total, 204.4), `total de la compra con IVA = ${pu.total}`);
ok(pu.debts.length === 1 && near(pu.debts[0].current_debt, 154.4), `deuda con proveedor = ${pu.debts[0]?.current_debt}`);
const cm = await list('cash_movements');
ok(cm.length === 1 && cm[0].amount === -50 && cm[0].type === 'purchase_payment', 'el efectivo salió de caja (-50)');
r = await call('POST', '/api/tpv/purchases', tCompra, purchaseBody);
ok(r.status === 200 && r.data.idempotent === true && (await list('purchases')).length === 1, 'request_id repetido no duplica la compra');
r = await call('POST', `/api/tpv/purchases/${pu.id}/payments`, tCompra, { payments: [{ method: 'transfer', total: 1000 }] });
ok(r.status === 400 && code(r) === 'overpayment', 'no se paga más que la deuda');
r = await call('POST', `/api/tpv/purchases/${pu.id}/payments`, tCompra, { cashier: cashier.id, payments: [{ method: 'cash', total: 54.4 }, { method: 'transfer', total: 100 }] });
ok(r.status === 200 && near(r.data.debts[0].current_debt, 0), 'abono liquida la deuda');
ok((await list('cash_movements')).length === 2, 'segundo movimiento de caja');
r = await call('POST', '/api/tpv/purchases', tCompra, { request_id: uuid(), location: loc.id, items: [{ product: leche.id, unit_cost: 20, batches: [{ code: 'L3', expires_at: '2027-05-01', quantity: 12 }] }], payments: [{ method: 'transfer', total: 240 }] });
const b3 = await one('batches', `product="${leche.id}" && code="L3"`);
ok(r.status === 200 && b3 && await bstock(b3.id) === 12 && r.data.debts.length === 0, 'compra con lote nuevo, pagada completa');
const stockBefore = await stock(refresco);
r = await call('DELETE', `/api/tpv/purchases/${pu.id}`, tCompra);
ok(r.status === 200 && await stock(refresco) === stockBefore - 10 && await stock(harina) === 50, 'borrar la compra revierte el inventario');
ok((await list('cash_movements', `&filter=${encodeURIComponent('deleted_at=""')}`)).length === 0, '…y anula sus movimientos de caja');
// borrador
r = await call('POST', '/api/tpv/purchases', tCompra, { request_id: uuid(), status: 'draft', location: loc.id, items: [{ product: harina.id, quantity: 5, unit_cost: 12 }] });
ok(r.status === 200 && r.data.status === 'draft' && await stock(harina) === 50, 'borrador de compra no mueve inventario');
r = await call('POST', `/api/tpv/purchases/${r.data.id}/complete`, tCompra, { payments: [] });
ok(r.status === 200 && await stock(harina) === 55 && near(r.data.debts[0].current_debt, 60), 'completar borrador: entra inventario y queda a crédito');

console.log('── gastos ──');
r = await call('POST', '/api/tpv/expenses', tCompra, { location: loc.id, concept: 'Renta', total: 5000, cashier: cashier.id, due_date: '2027-02-01', taxes: [vat.id], payments: [{ method: 'cash', total: 1000 }] });
ok(r.status === 200 && r.data.number === 1 && near(r.data.debts[0].current_debt, 4000), 'gasto con abono: queda deuda 4000');
const ex = r.data;
ok((await list('cash_movements', `&filter=${encodeURIComponent('type="expense_payment" && deleted_at=""')}`)).length === 1, 'gasto en efectivo sale de caja');
r = await call('POST', '/api/tpv/expenses', tCompra, { location: loc.id, concept: 'Luz', total: 300, payments: [{ method: 'cash', total: 300 }] });
ok(r.status === 400 && !r.data.data?.overpayment && code(r) === 'invalid_cashier' || r.status === 404, 'pago en efectivo exige caja');
r = await call('POST', `/api/tpv/expenses/${ex.id}/payments`, tCompra, { payments: [{ method: 'transfer', total: 4000 }] });
ok(r.status === 200 && near(r.data.debts[0].current_debt, 0), 'pago de deuda del gasto');
r = await call('DELETE', `/api/tpv/expenses/${ex.id}`, tCompra);
ok(r.status === 200 && (await list('cash_movements', `&filter=${encodeURIComponent('type="expense_payment" && deleted_at=""')}`)).length === 0, 'borrar gasto anula su movimiento de caja');

console.log('── traspasos ──');
r = await call('POST', '/api/tpv/transfers', tA, { origin: loc.id, destination: loc.id, items: [{ product: refresco.id, quantity: 1 }] });
ok(r.status === 400 && code(r) === 'same_location', 'origen y destino distintos');
r = await call('POST', '/api/tpv/transfers', tA, { origin: loc.id, destination: wh.id, items: [{ product: refresco.id, quantity: 20 }, { product: leche.id, quantity: 25 }] });
ok(r.status === 200 && r.data.status === 'draft', 'borrador de traspaso');
const tr = r.data;
r = await call('POST', `/api/tpv/transfers/${tr.id}/send`, tCompra, {});
ok(r.status === 403, 'enviar exige transfer.send');
const refBefore = await stock(refresco);
r = await call('POST', `/api/tpv/transfers/${tr.id}/send`, tA, {});
ok(r.status === 200 && r.data.status === 'sent' && await stock(refresco) === refBefore - 20, 'enviar descuenta del origen');
ok(await bstock(b1.id) === 5 && await bstock(b2.id) === 20 && await bstock(b3.id) === 12, 'lotes: sale primero lo que caduca antes (L1 30→5)');
const lines = await list('transfer_item_batches', `&filter=${encodeURIComponent(`transfer_item.transfer="${tr.id}"`)}`);
ok(lines.length === 1 && lines[0].quantity_sent === 25 || lines.length === 2, 'se registran los lotes enviados');
const trLines = await list('transfer_items', `&filter=${encodeURIComponent(`transfer="${tr.id}"`)}`);
const itRef = trLines.find((i) => i.product === refresco.id);
r = await call('POST', `/api/tpv/transfers/${tr.id}/receive`, tA, { items: [{ item: itRef.id, quantity_received: 18 }] });
ok(r.status === 200 && r.data.status === 'received' && await stock(refresco, wh) === 18, 'recibir con faltante: entran 18 de 20');
ok(await bstock(b1.id, wh) === 25 || (await list('batch_stocks', `&filter=${encodeURIComponent(`location="${wh.id}"`)}`)).reduce((s, x) => s + x.quantity, 0) === 25, 'lotes llegan al destino (25)');
ok((await one('transfer_events', `transfer="${tr.id}" && type="received"`)).content.includes('2'), 'el evento registra el faltante');
r = await call('DELETE', `/api/tpv/transfers/${tr.id}`, tA);
ok(r.status === 409, 'traspaso recibido no se borra');
r = await call('POST', '/api/tpv/transfers', tA, { origin: loc.id, destination: wh.id, items: [{ product: harina.id, quantity: 5 }] });
await call('POST', `/api/tpv/transfers/${r.data.id}/send`, tA, {});
const hBefore = await stock(harina);
r = await call('DELETE', `/api/tpv/transfers/${r.data.id}`, tA);
ok(r.status === 200 && await stock(harina) === hBefore + 5, 'borrar un traspaso enviado regresa el inventario al origen');

console.log('── fabricación ──');
await post('recipe_items', { product: pan.id, material: harina.id, quantity: 0.5 }, tA);
const tFab = await mkUser('fab@i.mx', ['manufacturing_order.read', 'manufacturing_order.create', 'manufacturing_order.start', 'manufacturing_order.finish', 'manufacturing_order.cancel']);
for (const f of await list('license_features', `&filter=${encodeURIComponent('feature="manufacturing"')}`)) await api('DELETE', `/api/collections/license_features/records/${f.id}`, { token: SU });
r = await call('POST', '/api/tpv/manufacturing-orders', tFab, { product: pan.id, location: loc.id, initial_quantity: 10 });
ok(r.status === 402, 'fabricación exige la función del plan');
await post('license_features', { feature: 'manufacturing' }, SU);
r = await call('POST', '/api/tpv/manufacturing-orders', tFab, { product: pan.id, location: loc.id, initial_quantity: 10 });
ok(r.status === 200 && r.data.materials.length === 1 && r.data.materials[0].quantity === 5, 'la receta escala a la cantidad (0.5 × 10 = 5)');
const mo = r.data;
const harBefore = await stock(harina);
r = await call('POST', `/api/tpv/manufacturing-orders/${mo.id}/start`, tFab);
ok(r.status === 200 && await stock(harina) === harBefore - 5, 'iniciar consume materiales');
r = await call('POST', `/api/tpv/manufacturing-orders/${mo.id}/finish`, tFab, { manufactured_quantity: 9 });
ok(r.status === 200 && await stock(pan) === 9, 'terminar produce 9');
ok(near(await cost(pan), (5 * (await cost(harina))) / 9, 0.01), `costo de producción = materiales / unidades (${await cost(pan)})`);
r = await call('POST', `/api/tpv/manufacturing-orders/${mo.id}/cancel`, tFab);
ok(r.status === 409, 'una orden terminada no se cancela');
r = await call('POST', '/api/tpv/manufacturing-orders', tFab, { product: pan.id, location: loc.id, initial_quantity: 2 });
await call('POST', `/api/tpv/manufacturing-orders/${r.data.id}/start`, tFab);
const hMid = await stock(harina);
r = await call('POST', `/api/tpv/manufacturing-orders/${r.data.id}/cancel`, tFab);
ok(r.status === 200 && await stock(harina) === hMid + 1, 'cancelar una orden iniciada devuelve los materiales');

console.log('── licencia ──');
await patch('license', lic.id, { status: 'suspended' });
r = await call('POST', '/api/tpv/stock-adjustments', tA, { type: 'entry', location: loc.id, items: [{ product: harina.id, quantity: 1 }] });
ok(r.status === 403 || r.status === 402, `licencia suspendida bloquea inventario (${r.status})`);

console.log(`\n${pass} correctas, ${fail} con falla`);
process.exit(fail ? 1 : 0);
