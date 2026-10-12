#!/usr/bin/env node
// Pruebas de caja y corte contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8102';
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

await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Caja', email: 'dueno@c.mx', password: 'password-dueno', name: 'Ana' } });
const tA = (await login('dueno@c.mx', 'password-dueno')).token;
const loc = (await list('locations'))[0], cashier = (await list('cashiers'))[0];
const unit = await one('measure_units', 'key="unit"');
const defaultList = await one('price_lists', 'is_default=true');
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
await patch('license', (await list('license'))[0].id, { max_users: 20 });
const mkUser = async (email, perms) => {
  await post('users', { email, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: email.split('@')[0], role: 'user', locations: [loc.id], permissions: await Promise.all(perms.map(perm)) }, tA);
  return (await login(email, 'password-uu-1')).token;
};
const tMgr = await mkUser('gerente@c.mx', ['order.read', 'order.create', 'order.create_with_credit', 'order.refund', 'order.register_payment_and_shipping', 'outlay.register_payment', 'cashier_audit.create', 'cashier_audit.read', 'cashier_audit.read_current']);
const tCur = await mkUser('lector@c.mx', ['cashier_audit.read_current']);
const tNo = await mkUser('nada@c.mx', ['order.read']);

const prod = (await post('products', { name: 'Refresco', type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true }, tA)).data;
await post('product_prices', { product: prod.id, price_list: defaultList.id, min_quantity: 0, price: 15 }, tA);
await post('product_stocks', { product: prod.id, location: loc.id, quantity: 1000 });
const juan = (await post('clients', { type: 'account_client', name: 'Juan', uses_default_debt_limit: true }, tA)).data;
const sale = (payments, extra = {}) => call('POST', '/api/tpv/orders', tMgr, { request_id: uuid(), location: loc.id, cashier: cashier.id, items: [{ product: prod.id, quantity: 2 }], payments, ...extra });
const cashRow = (a) => a.items.find((i) => i.method === 'cash');

console.log('── movimientos ──');
let r = await call('POST', '/api/tpv/cash-movements', tNo, { cashier: cashier.id, type: 'in', amount: 10 });
ok(r.status === 403, 'sin permiso no registra movimientos');
r = await call('POST', '/api/tpv/cash-movements', tMgr, { cashier: cashier.id, type: 'in', amount: -5 });
ok(r.status === 400 && code(r) === 'invalid_amount', 'monto positivo obligatorio');
const inMov = (await call('POST', '/api/tpv/cash-movements', tMgr, { cashier: cashier.id, type: 'in', amount: 500, details: 'Fondo' })).data;
ok(inMov.amount === 500 && inMov.type === 'manual_movement', 'entrada de efectivo +500');
const outMov = (await call('POST', '/api/tpv/cash-movements', tMgr, { cashier: cashier.id, type: 'out', amount: 50, details: 'Retiro' })).data;
ok(outMov.amount === -50, 'retiro = monto negativo');

console.log('── corte ──');
await sale([{ method: 'cash', total: 30 }]);
await sale([{ method: 'card', total: 30 }]);
const cred = await sale([{ method: 'credit' }], { client: juan.id, debt_due_date: '2027-12-01' });
ok(cred.status === 200, 'venta a crédito');
r = await call('POST', `/api/tpv/orders/${cred.data.order.id}/debt-payments`, tMgr, { method: 'cash', total: 10, cashier: cashier.id });
ok(r.status === 200, 'abono en efectivo 10');
const s4 = await sale([{ method: 'cash', total: 30 }]);
const item = s4.data.items[0];
r = await call('POST', `/api/tpv/orders/${s4.data.order.id}/refund`, tMgr, { reason: 'other', items: [{ order_item: item.id, quantity: 1 }], payments: [{ method: 'cash', total: 15, cashier: cashier.id }] });
ok(r.status === 200, 'reembolso en efectivo 15');
r = await call('POST', '/api/tpv/purchases', tMgr, { request_id: uuid(), location: loc.id, cashier: cashier.id, items: [{ product: prod.id, quantity: 10, unit_cost: 10 }], payments: [{ method: 'cash', total: 100 }] });
ok(r.status === 200, 'compra pagada con 100 de caja');

r = await call('GET', `/api/tpv/cashiers/${cashier.id}/current`, tCur);
ok(r.status === 200, 'cashier_audit.read_current ve el corte vigente');
r = await call('GET', `/api/tpv/cashiers/${cashier.id}/current`, tNo);
ok(r.status === 403, 'sin permiso no lo ve');
const cur = (await call('GET', `/api/tpv/cashiers/${cashier.id}/current`, tMgr)).data;
// ventas 30+30(s4) + abono 10 − reembolso 15 + 500 − 50 − 100
const c = cashRow(cur);
ok(c.order_payment === 60 && c.debt_payment === 10 && c.refund === -15 && c.outlay_payment === -100 && c.movements_in_total === 500 && c.cash_withdrawal === -50, `desglose efectivo: ${JSON.stringify(c)}`);
ok(c.total_expected === 405, `efectivo esperado = ${c.total_expected} (405)`);
ok(cur.items.find((i) => i.method === 'card').total_expected === 30, 'tarjeta esperada 30');

r = await call('POST', '/api/tpv/cashier-audits', tNo, { cashier: cashier.id });
ok(r.status === 403, 'preparar exige cashier_audit.create');
const prep = await call('POST', '/api/tpv/cashier-audits', tMgr, { cashier: cashier.id });
ok(prep.status === 200 && prep.data.status === 'draft' && prep.data.period_start.startsWith('1970'), 'primer corte: periodo desde 1970, borrador');
const again = await call('POST', '/api/tpv/cashier-audits', tMgr, { cashier: cashier.id });
ok(again.data.id === prep.data.id && again.data.items.length === prep.data.items.length, 'preparar de nuevo reutiliza el borrador');
ok(prep.data.cash_in === 500 && prep.data.cash_out === 150, 'cash_in 500, cash_out 150 (retiro + pago de compra)');
r = await call('POST', `/api/tpv/cashier-audits/${prep.data.id}/finish`, tMgr, { items: [{ method: 'cash', total_audited: 400 }] });
ok(r.status === 400 && code(r) === 'audited_required', 'hay que contar todos los métodos');
r = await call('POST', `/api/tpv/cashier-audits/${prep.data.id}/finish`, tMgr, { comments: 'faltan 5', items: [{ method: 'cash', total_audited: 400 }, { method: 'card', total_audited: 30 }] });
ok(r.status === 200 && r.data.status === 'completed', 'corte cerrado');
ok(cashRow(r.data).total_expected === 405 && cashRow(r.data).total_audited === 400, 'esperado 405 vs contado 400 (diferencia −5)');
r = await call('POST', `/api/tpv/cashier-audits/${prep.data.id}/finish`, tMgr, { items: [] });
ok(r.status === 409, 'no se cierra dos veces');
r = await call('DELETE', `/api/tpv/cash-movements/${inMov.id}`, tMgr);
ok(r.status === 409 && code(r) === 'period_closed', 'movimiento de un corte cerrado no se borra');

console.log('── segundo periodo ──');
await sale([{ method: 'cash', total: 30 }]);
const m2 = (await call('POST', '/api/tpv/cash-movements', tMgr, { cashier: cashier.id, type: 'out', amount: 20 })).data;
const cur2 = (await call('GET', `/api/tpv/cashiers/${cashier.id}/current`, tMgr)).data;
ok(cur2.period_start !== prep.data.period_start && cashRow(cur2).total_expected === 10, `el periodo arranca en el corte anterior (esperado ${cashRow(cur2).total_expected} = 30 − 20)`);
r = await call('DELETE', `/api/tpv/cash-movements/${m2.id}`, tMgr);
ok(r.status === 200 && cashRow((await call('GET', `/api/tpv/cashiers/${cashier.id}/current`, tMgr)).data).total_expected === 30, 'borrar un movimiento del periodo abierto lo excluye');
r = await call('DELETE', `/api/tpv/cash-movements/${(await one('cash_movements', 'type="purchase_payment"')).id}`, tMgr);
ok(r.status === 409, 'solo se borran movimientos manuales');

console.log(`\n${pass} correctas, ${fail} con falla`);
process.exit(fail ? 1 : 0);
