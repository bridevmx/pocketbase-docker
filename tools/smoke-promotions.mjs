#!/usr/bin/env node
// Pruebas de impuestos y promociones contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8106';
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

await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Promo', email: 'dueno@p.mx', password: 'password-dueno', name: 'Ana', utc_offset_minutes: -360 } });
const tA = (await login('dueno@p.mx', 'password-dueno')).token;
ok((await list('business'))[0].utc_offset_minutes === -360, 'zona horaria del negocio guardada');
const loc = (await list('locations'))[0], cashier = (await list('cashiers'))[0];
const unit = await one('measure_units', 'key="unit"');
const vat = await one('taxes', 'type="vat" && percentage=16 && is_exempt=false');
const ieps = await one('taxes', 'type="ieps" && is_withheld=false && is_exempt=false');
const defaultList = await one('price_lists', 'is_default=true');
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
await patch('license', (await list('license'))[0].id, { max_users: 20 });
const mkUser = async (email, perms) => {
  await post('users', { email, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: email.split('@')[0], role: 'user', locations: [loc.id], permissions: await Promise.all(perms.map(perm)) }, tA);
  return (await login(email, 'password-uu-1')).token;
};
const tCaja = await mkUser('caja@p.mx', ['order.read', 'order.create', 'order.refund', 'report.view_finance_reports', 'quotation.read', 'quotation.create']);
const tDesc = await mkUser('desc@p.mx', ['order.read', 'order.create', 'order.admin_discount']);
const cat = (await post('product_categories', { name: 'Bebidas' }, tA)).data;
const mk = async (name, price, extra = {}) => {
  const p = (await post('products', { name, type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, ...extra }, tA)).data;
  await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: 0, price }, tA);
  await post('product_stocks', { product: p.id, location: loc.id, quantity: 1000 });
  return p;
};
const sale = (b, token = tCaja) => call('POST', '/api/tpv/orders', token, { request_id: uuid(), location: loc.id, cashier: cashier.id, ...b });

console.log('── impuestos incluidos en el precio ──');
const gas = await mk('Con IVA', 116, { taxes: [vat.id] });
const cerveza = await mk('Cerveza', 150, { taxes: [ieps.id, vat.id] });
const libre = await mk('Sin impuestos', 50);
console.log('  (IEPS de prueba:', ieps.percentage + '%)');
let r = await sale({ items: [{ product: gas.id, quantity: 1 }], payments: [{ method: 'cash', total: 116 }] });
let t = r.data.items[0].taxes;
ok(r.status === 200 && t.length === 1 && near(t[0].amount, 16) && r.data.order.total === 116, `IVA 16% incluido en $116 = $${t[0].amount} (el total no cambia)`);
r = await sale({ items: [{ product: cerveza.id, quantity: 1 }], payments: [{ method: 'cash', total: 150 }] });
const e1 = r.data.items[0].taxes.find((x) => x.type === 'ieps').amount, v1 = r.data.items[0].taxes.find((x) => x.type === 'vat').amount;
const base = 150 / ((1 + ieps.percentage / 100) * 1.16);
ok(near(e1, base * ieps.percentage / 100) && near(v1, (base + e1) * 0.16), `IEPS ${e1} + IVA ${v1} sobre base ${base.toFixed(2)} (IVA sobre base + IEPS)`);
r = await sale({ with_taxes: false, items: [{ product: gas.id, quantity: 1 }], payments: [{ method: 'cash', total: 116 }] });
ok(r.data.items[0].taxes[0].amount === 0 && r.data.order.with_taxes === false && r.data.order.total === 116, 'with_taxes=false: sin desglose y mismo total');
r = await sale({ items: [{ product: gas.id, quantity: 2 }], cart_discounts: [{ type: 'fixed', value: 32 }], payments: [{ method: 'cash', total: 200 }] }, tDesc);
ok(near(r.data.items[0].taxes[0].amount, 200 / 1.16 * 0.16), `descuento de carrito prorrateado en el IVA ($${r.data.items[0].taxes[0].amount})`);

console.log('── reporte de impuestos ──');
const rep = await call('GET', '/api/tpv/analytics/taxes', tCaja);
const ivaRow = rep.data.items.find((i) => i.type === 'vat');
ok(rep.status === 200 && ivaRow && near(ivaRow.amount, 16 + v1 + 0 + 200 / 1.16 * 0.16), `IVA cobrado en el periodo: ${ivaRow?.amount}`);
ok(rep.data.totals.collected > 0, `total de impuestos trasladados ${rep.data.totals.collected}`);

console.log('── promociones por partida ──');
const refresco = await mk('Refresco', 20, { category: cat.id }), jugo = await mk('Jugo', 30, { category: cat.id }), pan = await mk('Pan', 10);
const promo = async (data, targets = [], extra = {}) => {
  const p = (await post('promotions', { restrict_to_clients: 'no_restriction', amount_type: 'percentage', ...data }, tA));
  if (p.status !== 200) throw new Error('promo ' + JSON.stringify(p.data));
  for (const t of targets) await post('promotion_targets', { promotion: p.data.id, ...t }, tA);
  return p.data;
};
const p10 = await promo({ name: '10% Refresco', type: 'single_target', application: 'automatic', amount: 10 }, [{ role: 'single', product: refresco.id }]);
r = await sale({ items: [{ product: refresco.id, quantity: 2 }, { product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 46 }] });
ok(r.status === 200 && r.data.order.total === 46 && r.data.items[0].discount?.promotion === p10.id && r.data.items[0].total === 36, 'single_target automática: 10% a Refresco (40 → 36)');
ok(r.data.promotions[0].name === '10% Refresco' && r.data.promotions[0].amount === 4, 'la respuesta lista las promociones aplicadas');
ok(r.data.order.discounts === 0, 'Order.discounts solo suma descuentos de carrito');
r = await sale({ apply_promotions: false, items: [{ product: refresco.id, quantity: 2 }], payments: [{ method: 'cash', total: 40 }] });
ok(code(r) === 'permission_denied', 'desactivar promociones exige permiso');
r = await sale({ apply_promotions: false, items: [{ product: refresco.id, quantity: 2 }], payments: [{ method: 'cash', total: 40 }] }, tDesc);
ok(r.status === 200 && r.data.order.total === 40, 'con permiso se pueden desactivar');
r = await sale({ items: [{ product: refresco.id, quantity: 2, discount: { type: 'percentage', value: 50 } }], payments: [{ method: 'cash', total: 20 }] }, tDesc);
ok(r.data.order.total === 20 && r.data.items[0].discount.promotion === '', 'el descuento manual de la partida gana a la promoción');
await patch('promotions', p10.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);
r = await sale({ items: [{ product: refresco.id, quantity: 2 }], payments: [{ method: 'cash', total: 40 }] });
ok(r.data.order.total === 40, 'promoción terminada (ended_at) ya no aplica');

console.log('── multi_target ──');
const p2x1 = await promo({ name: '2x1 Bebidas', type: 'multi_target', multi_target_type: 'two_for_one', application: 'automatic' }, [{ role: 'trigger', category: cat.id }]);
r = await sale({ items: [{ product: refresco.id, quantity: 3 }, { product: jugo.id, quantity: 1 }], payments: [{ method: 'cash', total: 50 }] });
// 4 unidades → 2 grupos → 2 unidades gratis, las más baratas (2 refrescos de $20): 60 + 30 − 40 = 50
ok(r.status === 200 && r.data.order.total === 50, `2x1: de 4 bebidas se regalan las 2 más baratas (total ${r.data.order.total})`);
r = await sale({ items: [{ product: refresco.id, quantity: 1 }], payments: [{ method: 'cash', total: 20 }] });
ok(r.data.order.total === 20, '2x1: con una sola unidad no hay descuento');
await patch('promotions', p2x1.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);
const p3 = await promo({ name: '3ª al 50%', type: 'multi_target', multi_target_type: 'third_fifty_percent', application: 'automatic' }, [{ role: 'trigger', product: pan.id }]);
r = await sale({ items: [{ product: pan.id, quantity: 3 }], payments: [{ method: 'cash', total: 25 }] });
ok(r.data.order.total === 25, 'tercera al 50%: 3 panes de $10 → $25');
await patch('promotions', p3.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);
const pAdv = await promo({ name: 'Compra 2 pan, jugo -50%', type: 'multi_target_advanced', application: 'automatic', trigger_quantity: 2, discounted_quantity: 1, discounted_percentage: 50 }, [{ role: 'trigger', product: pan.id }, { role: 'discounted', product: jugo.id }]);
r = await sale({ items: [{ product: pan.id, quantity: 2 }, { product: jugo.id, quantity: 2 }], payments: [{ method: 'cash', total: 65 }] });
ok(r.data.order.total === 65, `avanzada: 2 panes activan 1 jugo al 50% (20 + 60 − 15 = ${r.data.order.total})`);
await patch('promotions', pAdv.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);

console.log('── promociones de carrito, restricciones y manuales ──');
const pc = await promo({ name: '$50 en compras de $200+', type: 'cart_total', application: 'automatic', amount: 50, amount_type: 'fixed', min_cart_subtotal: 200 });
r = await sale({ items: [{ product: refresco.id, quantity: 5 }], payments: [{ method: 'cash', total: 100 }] });
ok(r.data.order.total === 100 && r.data.order.discounts === 0, 'bajo el mínimo no aplica');
r = await sale({ items: [{ product: refresco.id, quantity: 11 }], payments: [{ method: 'cash', total: 170 }] });
ok(r.data.order.total === 170 && r.data.order.discounts === 50, 'cart_total: −$50 sobre $220 (descuento de carrito con promoción)');
const cd = await list('order_cart_discounts', `&filter=${encodeURIComponent(`order="${r.data.order.id}"`)}`);
ok(cd.length === 1 && cd[0].promotion === pc.id, 'el descuento de carrito guarda la promoción');
await patch('promotions', pc.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);
const juan = (await post('clients', { type: 'account_client', name: 'Juan' }, tA)).data;
const pReg = await promo({ name: 'Solo registrados', type: 'single_target', application: 'automatic', amount: 50, restrict_to_clients: 'registered_clients' }, [{ role: 'single', product: pan.id }]);
r = await sale({ client: juan.id, items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 5 }] });
ok(r.data.order.total === 5, 'registered_clients: Juan sí (50%)');
r = await sale({ items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 10 }] });
ok(r.data.order.total === 10, 'registered_clients: el público general no');
await patch('promotions', pReg.id, { restrict_to_clients: 'clients_list' }, tA);
r = await sale({ client: juan.id, items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 10 }] });
ok(r.data.order.total === 10, 'clients_list: Juan no está en la lista');
await post('promotion_clients', { promotion: pReg.id, client: juan.id }, tA);
r = await sale({ client: juan.id, items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 5 }] });
ok(r.data.order.total === 5, 'clients_list: ya en la lista');
await patch('promotions', pReg.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);
// días de la semana (hora local del negocio)
const pDay = await promo({ name: 'Solo hoy', type: 'single_target', application: 'automatic', amount: 50 }, [{ role: 'single', product: pan.id }]);
const dias = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const localDay = new Date(Date.now() - 360 * 60000).getUTCDay();
await post('promotion_days', { promotion: pDay.id, weekday: dias[(localDay + 1) % 7] }, tA);
r = await sale({ items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 10 }] });
ok(r.data.order.total === 10, 'días de la semana: mañana no aplica hoy');
await post('promotion_days', { promotion: pDay.id, weekday: dias[localDay] }, tA);
r = await sale({ items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 5 }] });
ok(r.data.order.total === 5, 'días de la semana: hoy sí (hora local del negocio)');
await patch('promotions', pDay.id, { ended_at: '2026-01-01 00:00:00.000Z' }, tA);
const pMan = await promo({ name: 'Manual 20%', type: 'single_target', application: 'manual', amount: 20 }, [{ role: 'single', product: pan.id }]);
r = await sale({ items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 10 }] });
ok(r.data.order.total === 10, 'manual: no se aplica sola');
r = await sale({ promotions: [pMan.id], items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 8 }] });
ok(r.data.order.total === 8 && r.data.items[0].discount.promotion === pMan.id, 'manual: se aplica si el cajero la elige');
r = await sale({ promotions: [pMan.id], items: [{ product: refresco.id, quantity: 1 }], payments: [{ method: 'cash', total: 20 }] });
ok(code(r) === 'promotion_not_applicable', 'manual que no aplica al carrito → error');
r = await sale({ promotions: ['noexiste'], items: [{ product: pan.id, quantity: 1 }], payments: [{ method: 'cash', total: 10 }] });
ok(code(r) === 'promotion_not_applicable', 'promoción inexistente → error');

console.log('── vista previa (dry_run) y cotización ──');
const before = (await list('orders')).length, stockBefore = (await one('product_stocks', `product="${pan.id}"`)).quantity;
r = await call('POST', '/api/tpv/orders', tCaja, { dry_run: true, location: loc.id, cashier: cashier.id, promotions: [pMan.id], items: [{ product: pan.id, quantity: 5 }], payments: [] , origin: 'pos' });
ok(r.status === 200 && r.data.dry_run === true && r.data.order.total === 40 && r.data.promotions[0].amount === 10, `vista previa: total ${r.data.order?.total}, promoción −10`);
ok((await list('orders')).length === before && (await one('product_stocks', `product="${pan.id}"`)).quantity === stockBefore, 'la vista previa no guarda ventas ni mueve inventario');
await patch('promotions', p10.id, { ended_at: '' }, tA);
const q = await call('POST', '/api/tpv/quotations', tCaja, { location: loc.id, items: [{ product: refresco.id, quantity: 2 }] });
ok(q.status === 200 && q.data.subtotal === 36 && q.data.items[0].discount.promotion === p10.id, 'la cotización aplica promociones automáticas (40 → 36)');
r = await call('POST', `/api/tpv/quotations/${q.data.id}/convert`, tCaja, { request_id: uuid(), cashier: cashier.id, payments: [{ method: 'cash', total: 36 }] });
ok(r.status === 200 && r.data.order.total === 36 && r.data.items[0].discount.promotion === p10.id, 'al convertir, la promoción se recalcula (sin duplicarse)');

console.log(`\n${pass} correctas, ${fail} con falla`);
process.exit(fail ? 1 : 0);
