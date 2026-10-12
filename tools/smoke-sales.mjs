#!/usr/bin/env node
// Pruebas de ventas contra una instancia NUEVA (ver tools/smoke.sh).
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8100';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
async function api(method, path, { token, body } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const code = (r) => Object.keys(r.data?.data || {})[0];                 // código de máquina del error
const uuid = () => crypto.randomUUID();
const login = async (e, p) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: e, password: p } })).data;
const SU = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: process.env.SU_EMAIL, password: process.env.SU_PASS } })).data.token;
const list = async (col, q = '', token = SU) => (await api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token })).data.items;
const one = async (col, filter, token = SU) => (await list(col, `&filter=${encodeURIComponent(filter)}`, token))[0];
const post = (col, body, token = SU) => api('POST', `/api/collections/${col}/records`, { token, body });
const patch = (col, id, body, token = SU) => api('PATCH', `/api/collections/${col}/records/${id}`, { token, body });

// ───────── preparación ─────────
await api('POST', '/api/tpv/setup', { body: { business_name: 'Tienda Ventas', email: 'dueno@v.mx', password: 'password-dueno', name: 'Ana' } });
const tA = (await login('dueno@v.mx', 'password-dueno')).token;
const loc = (await list('locations'))[0], cashierRec = (await list('cashiers'))[0], series = (await list('order_series'))[0];
const unit = await one('measure_units', 'key="unit"'); const vat = await one('taxes', 'type="vat" && percentage=16 && is_exempt=false');
const defaultList = await one('price_lists', 'is_default=true');
const perm = async (k) => (await one('permissions', `key="${k}"`)).id;
const mkUser = async (email, perms, extra = {}) => {
  const r = await post('users', { email, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: email.split('@')[0], role: 'user', locations: [loc.id], permissions: await Promise.all(perms.map(perm)), ...extra }, tA);
  return (await login(email, 'password-uu-1')).token;
};
const licRec = (await list('license'))[0];
await patch('license', licRec.id, { max_users: 20, max_branches: 3 });   // el panel de control sube los topes para esta prueba
const tCaja = await mkUser('caja@v.mx', ['order.read', 'order.create']);
const tGer = await mkUser('gerente@v.mx', ['order.read', 'order.create', 'order.create_with_credit', 'order.admin_discount', 'order.apply_personalized_price', 'order.refund', 'order.cancel', 'order.register_payment_and_shipping', 'order.postpone_products_delivery', 'order.save_counter_order', 'product.read_cost']);

const cat = (await post('product_categories', { name: 'Bebidas' }, tA)).data;
const mkProduct = async (name, extra, price, cost, breakpoints = []) => {
  const p = (await post('products', { name, type: 'product', sell_unit: unit.id, is_stockable: true, is_sellable: true, ...extra }, tA)).data;
  await post('product_costs', { product: p.id, cost, cost_type: 'net' }, tA);
  await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: 0, price }, tA);
  for (const [min, pr] of breakpoints) await post('product_prices', { product: p.id, price_list: defaultList.id, min_quantity: min, price: pr }, tA);
  return p;
};
const refresco = await mkProduct('Refresco', { sku: 'REF', category: cat.id, taxes: [vat.id] }, 15, 8, [[12, 13]]);
const leche = await mkProduct('Leche', { sku: 'LEC', batches_enabled: true }, 28, 18);
const jugo = await mkProduct('Jugo', { sku: 'JUG', category: cat.id }, 50, 20);
const servicio = (await post('products', { name: 'Instalación', type: 'service', sell_unit: unit.id, is_sellable: true }, tA)).data;
await post('product_prices', { product: servicio.id, price_list: defaultList.id, min_quantity: 0, price: 350 }, tA);
const combo = (await post('products', { name: 'Combo', type: 'combo', sell_unit: unit.id, is_stockable: true, is_sellable: true }, tA)).data;
await post('product_prices', { product: combo.id, price_list: defaultList.id, min_quantity: 0, price: 39 }, tA);
await post('combo_items', { combo: combo.id, item: refresco.id, quantity: 1 }, tA);
await post('combo_items', { combo: combo.id, item: jugo.id, quantity: 1 }, tA);
// inventario inicial (lo escribe el servidor; la ruta de ajustes llegará en la fase de inventario)
const setStock = (product, q) => post('product_stocks', { product: product.id, location: loc.id, quantity: q });
await setStock(refresco, 100); await setStock(jugo, 10);
const b1 = (await post('batches', { product: leche.id, code: 'L-2610', expires_at: '2026-12-31 00:00:00.000Z' })).data;
const b2 = (await post('batches', { product: leche.id, code: 'L-2611', expires_at: '2027-01-31 00:00:00.000Z' })).data;
await post('batch_stocks', { batch: b1.id, location: loc.id, quantity: 40 }); await post('batch_stocks', { batch: b2.id, location: loc.id, quantity: 10 });
const juan = (await post('clients', { type: 'account_client', name: 'Juan', phone: '+527721234567', uses_default_debt_limit: true }, tA)).data;
const publico = await one('clients', 'type="general_public"');
const seller = (await post('sellers', { name: 'Vendedor' }, tA)).data;

const qty = async (col, f) => (await one(col, f)).quantity;
const stockOf = (p) => qty('product_stocks', `product="${p.id}" && location="${loc.id}"`);
const batchQty = (b) => qty('batch_stocks', `batch="${b.id}" && location="${loc.id}"`);
const movements = async (p, q = '') => (await list('stock_movements', `&filter=${encodeURIComponent(`product="${p.id}"` + q)}&sort=created`));
const base = (over = {}) => ({ request_id: uuid(), location: loc.id, cashier: cashierRec.id, items: [{ product: refresco.id, quantity: 2 }], payments: [{ method: 'cash', total: 30 }], ...over });
const sale = (b, token = tGer) => api('POST', '/api/tpv/orders', { token, body: b });

console.log('● Venta de contado');
const s1 = await sale(base());
ok(s1.status === 200, 'venta de contado creada');
const o1 = s1.data.order;
ok(o1.total === 30 && o1.subtotal === 30 && o1.order_number === 1 && o1.payment_status === 'completed' && o1.shipping_status === 'completed', 'totales calculados por el servidor, folio 1, cobrada y entregada');
ok(/^[A-HJ-NP-Z1-9]{7}$/.test(o1.friendly_id), 'folio corto de 7 caracteres');
ok(s1.data.items[0].taxes.length === 1 && s1.data.items[0].taxes[0].percentage === 16, 'se guarda el snapshot de impuestos de la partida');
ok(s1.data.items[0].cost?.unit_cost === 8 && s1.data.items[0].cost.total_cost === 16, 'se guarda el snapshot de costo (visible con product.read_cost)');
ok(await stockOf(refresco) === 98, 'inventario: 100 → 98');
const mv = await movements(refresco, ' && origin="order_create"');
ok(mv.length === 1 && mv[0].previous_quantity === 100 && mv[0].current_quantity === 98 && mv[0].order === o1.id, 'libro de inventario: movimiento order_create ligado a la venta');
ok((await one('series' in {} ? 'orders' : 'order_series', `id="${series.id}"`)).next_number === 2, 'la serie avanzó a 2');

console.log('\n● Idempotencia (venta offline)');
const rid = uuid();
const f1 = await sale(base({ request_id: rid })); const f2 = await sale(base({ request_id: rid }));
ok(f1.status === 200 && f2.status === 200 && f2.data.idempotent === true && f2.data.order.id === f1.data.order.id, 'mismo request_id devuelve la misma venta');
ok(await stockOf(refresco) === 96, 'y el inventario baja una sola vez (98 → 96)');
const off = await sale(base({ is_offline: true, made_at: new Date(Date.now() - 3600000).toISOString() }));
ok(off.status === 200 && off.data.order.is_offline === true, 'venta offline con made_at de hace 1 hora');
ok((await sale(base({ made_at: new Date(Date.now() - 30 * 86400000).toISOString() }))).status === 400, 'made_at de hace 30 días se rechaza');

console.log('\n● El servidor decide precios y totales');
const bp = await sale(base({ items: [{ product: refresco.id, quantity: 12 }], payments: [{ method: 'cash', total: 156 }] }));
ok(bp.status === 200 && bp.data.items[0].unit_price === 13 && bp.data.items[0].price_breakpoint === 12 && bp.data.order.total === 156, 'precio por volumen: 12 pzas a $13 = $156');
const fake = await sale(base({ items: [{ product: refresco.id, quantity: 1 }], total: 1, subtotal: 1, payments: [{ method: 'cash', total: 1 }] }));
ok(fake.status === 422 && code(fake) === 'payment_mismatch', 'si el cliente manda un total falso, los pagos no cuadran y se rechaza');
ok(code(await sale(base({ payments: [{ method: 'cash', total: 20 }] }))) === 'payment_mismatch', 'pago insuficiente se rechaza');
ok(code(await sale(base({ payments: [{ method: 'cash', total: 40 }] }))) === 'payment_mismatch', 'pago excedido sin cambio se rechaza');
const chg = await sale(base({ payments: [{ method: 'cash', total: 50, change: 20 }] }));
ok(chg.status === 200 && chg.data.payments[0].change === 20, 'pago de $50 con cambio de $20 sí cuadra');
ok(code(await sale(base({ payments: [{ method: 'card', total: 40, change: 10 }] }))) === 'invalid_payment', 'el cambio solo existe en efectivo');
ok(code(await sale(base({ items: [{ product: refresco.id, quantity: 1, unit_price: 5 }], payments: [{ method: 'cash', total: 5 }] }), tCaja)) === 'permission_denied', 'cambiar el precio exige order.apply_personalized_price');
const pers = await sale(base({ items: [{ product: refresco.id, quantity: 1, unit_price: 10 }], payments: [{ method: 'cash', total: 10 }] }));
ok(pers.status === 200 && pers.data.items[0].price_type === 'personalized', 'con el permiso, precio personalizado queda marcado');
ok(code(await sale(base({ items: [{ product: refresco.id, quantity: 1, unit_price: 10.555 }], payments: [{ method: 'cash', total: 10.56 }] }))) === 'invalid_price', 'precios con más de 2 decimales se rechazan');
ok((await sale(base({ items: [{ product: refresco.id, quantity: 1 }], payments: [{ method: 'cash', total: 15 }] }), tCaja)).status === 200, 'un cajero con order.create puede vender');
ok((await sale(base({ location: loc.id }), await mkUser('sinsuc@v.mx', ['order.create'], { locations: [] }))).status === 403, 'sin sucursal asignada no puede vender');
ok(code(await sale(base(), await mkUser('sinperm@v.mx', ['order.read']))) === 'permission_denied', 'sin order.create no vende');

console.log('\n● Descuentos');
const d1 = await sale(base({ items: [{ product: refresco.id, quantity: 2, discount: { type: 'percentage', value: 10 } }], payments: [{ method: 'cash', total: 27 }] }));
ok(d1.status === 200 && d1.data.order.subtotal === 30 && d1.data.order.discounts === 0 && d1.data.order.total === 27 && d1.data.items[0].total === 27 && d1.data.items[0].discount.type === 'percentage', 'descuento por partida: subtotal 30, discounts 0 (solo carrito), total 27');
const d2 = await sale(base({ cart_discounts: [{ type: 'percentage', value: 10 }], payments: [{ method: 'cash', total: 27 }] }));
ok(d2.status === 200 && d2.data.order.discounts === 3 && d2.data.order.total === 27, 'descuento de carrito 10%: discounts 3, total 27');
ok(code(await sale(base({ cart_discounts: [{ type: 'fixed', value: 5 }], payments: [{ method: 'cash', total: 25 }] }), tCaja)) === 'permission_denied', 'descuentos exigen order.admin_discount');
ok(code(await sale(base({ cart_discounts: [{ type: 'fixed', value: 99 }], payments: [{ method: 'cash', total: 1 }] }))) === 'invalid_discount', 'un descuento mayor al total se rechaza');

console.log('\n● Inventario');
const st0 = await stockOf(refresco);
ok(code(await sale(base({ items: [{ product: refresco.id, quantity: 9999 }], payments: [{ method: 'cash', total: 129987 }] }))) === 'insufficient_stock', 'sin existencias suficientes: 409 insufficient_stock');
ok(await stockOf(refresco) === st0, '…y no se movió nada (transacción)');
const svc = await sale(base({ items: [{ product: servicio.id, quantity: 1 }], payments: [{ method: 'cash', total: 350 }] }));
ok(svc.status === 200, 'un servicio se vende sin inventario');
const cb = await sale(base({ items: [{ product: combo.id, quantity: 2 }], payments: [{ method: 'cash', total: 78 }] }));
ok(cb.status === 200 && cb.data.items.length === 3 && cb.data.items.filter((i) => i.combo_parent).length === 2, 'combo: partida padre + 2 componentes');
ok(await stockOf(jugo) === 8 && await stockOf(refresco) === st0 - 2, 'combo: baja el inventario de cada componente');
await patch('pos_settings', (await list('pos_settings'))[0].id, { allow_selling_out_of_stock: true }, tA);
const neg = await sale(base({ items: [{ product: jugo.id, quantity: 20 }], payments: [{ method: 'cash', total: 1000 }] }));
ok(neg.status === 200 && await stockOf(jugo) === -12, 'con allow_selling_out_of_stock el saldo queda negativo');
await patch('pos_settings', (await list('pos_settings'))[0].id, { allow_selling_out_of_stock: false }, tA);
await patch('product_stocks', (await one('product_stocks', `product="${jugo.id}"`)).id, { quantity: 50 });   // reponer el jugo para lo que sigue

console.log('\n● Lotes');
const fefo = await sale(base({ items: [{ product: leche.id, quantity: 45 }], payments: [{ method: 'cash', total: 1260 }] }));
ok(fefo.status === 200 && fefo.data.items[0].batches.length === 2, 'manual sin lotes indicados: se reparte FEFO');
ok(await batchQty(b1) === 0 && await batchQty(b2) === 5, 'FEFO: primero el lote que caduca antes (40 + 5)');
const lm = await movements(leche, ' && origin="order_create"');
ok(lm.length === 2 && lm[0].batch === b1.id, 'el libro registra el movimiento por lote');
ok(code(await sale(base({ items: [{ product: leche.id, quantity: 6 }], payments: [{ method: 'cash', total: 168 }] }))) === 'insufficient_stock', 'lotes sin existencias: 409');

console.log('\n● Crédito');
const dueD = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);
const cr = (over = {}) => base({ client: juan.id, items: [{ product: refresco.id, quantity: 2 }], payments: [{ method: 'credit' }], debt_due_date: dueD, ...over });
ok(code(await sale(cr(), tCaja)) === 'permission_denied', 'vender a crédito exige order.create_with_credit');
ok(code(await sale(cr({ client: publico.id }))) === 'credit_requires_client', 'el cliente genérico no puede comprar a crédito');
ok(code(await sale(cr({ debt_due_date: undefined }))) === 'invalid_due_date', 'el crédito exige fecha de vencimiento');
const c1 = await sale(cr());
ok(c1.status === 200 && c1.data.debt.original_debt === 30 && c1.data.debt.current_debt === 30 && c1.data.order.payment_status === 'completed', 'crédito total: deuda $30 y la venta queda completed (la deuda no es un estado)');
const mix = await sale(cr({ items: [{ product: refresco.id, quantity: 12 }], payments: [{ method: 'cash', total: 100 }, { method: 'credit' }] }));
const mixCredit = mix.data.payments.find((p) => p.method === 'credit');
ok(mix.data.debt.original_debt === 156 && mix.data.debt.current_debt === 56 && mixCredit.total === 56, 'pago mixto: cash 100 + credit 56 → original 156, viva 56');
ok(mix.data.payments.filter((p) => p.method === 'cash').every((p) => p.settles_payment === mixCredit.id), 'el pago en efectivo liquida (settles_payment) el pago a crédito');
await patch('clients', juan.id, { uses_default_debt_limit: false, debt_limit: 100 }, tA);
ok(code(await sale(cr({ items: [{ product: refresco.id, quantity: 4 }] }))) === 'debt_limit_exceeded', 'límite de crédito del cliente ($100): 86 + 60 > 100 se rechaza en el servidor');
await patch('clients', juan.id, { uses_default_debt_limit: true }, tA);

console.log('\n● Abonos de deuda');
const pd = await api('POST', `/api/tpv/orders/${mix.data.order.id}/debt-payments`, { token: tGer, body: { method: 'card', total: 20, cashier: cashierRec.id } });
ok(pd.status === 200 && pd.data.debt.current_debt === 36 && pd.data.payments.find((p) => p.method === 'credit').total === 36, 'abono $20: deuda 56 → 36 y el pago credit refleja la deuda viva');
ok(pd.data.payments.some((p) => p.method === 'card' && p.settles_payment === mixCredit.id), 'el abono apunta al pago credit que liquida');
ok(code(await api('POST', `/api/tpv/orders/${mix.data.order.id}/debt-payments`, { token: tGer, body: { method: 'cash', total: 500, cashier: cashierRec.id } })) === 'payment_exceeds_debt', 'un abono mayor a la deuda se rechaza');
const un = await api('POST', '/api/tpv/debt-payments', { token: tGer, body: { payments: [{ order: mix.data.order.id, method: 'cash', total: 36, cashier: cashierRec.id }, { order: c1.data.order.id, method: 'cash', total: 30, cashier: cashierRec.id }] } });
ok(un.status === 200 && un.data.payments.length === 2 && un.data.payments.every((p) => p.unified_debt_payment === un.data.unified_debt_payment), 'abono unificado a 2 ventas comparte unified_debt_payment');
ok((await one('order_debts', `order="${mix.data.order.id}"`)).current_debt === 0 && (await one('order_debts', `order="${c1.data.order.id}"`)).current_debt === 0, 'ambas deudas quedan en 0');

console.log('\n● Margen mínimo (ahora en el servidor)');
const stId = (await list('pos_settings'))[0].id;
await patch('pos_settings', stId, { min_profit_margin_enabled: true, min_profit_margin: 20, min_profit_margin_policy: 'block' }, tA);
const mg = await sale(base({ items: [{ product: refresco.id, quantity: 1, unit_price: 9 }], payments: [{ method: 'cash', total: 9 }] }));
ok(mg.status === 422 && code(mg) === 'margin_below_minimum', 'margen < 20% con política block: 422');
await patch('pos_settings', stId, { min_profit_margin_policy: 'warn' }, tA);
const mw = await sale(base({ items: [{ product: refresco.id, quantity: 1, unit_price: 9 }], payments: [{ method: 'cash', total: 9 }] }));
ok(mw.status === 200 && mw.data.warnings.length === 1, 'con política warn pasa y devuelve advertencia');
await patch('pos_settings', stId, { min_profit_margin_enabled: false }, tA);

console.log('\n● Lealtad');
const lp = (await post('loyalty_programs', { reward_percentage: 2 }, tA)).data;
await post('loyalty_product_rewards', { program: lp.id, product: servicio.id, reward_percentage: 10 }, tA);
await post('loyalty_category_rewards', { program: lp.id, category: cat.id, reward_percentage: 5 }, tA);
const pts = async () => (await one('clients', `id="${juan.id}"`)).loyalty_points;
const p0 = await pts();
const l1 = await sale(base({ client: juan.id, items: [{ product: servicio.id, quantity: 1 }, { product: jugo.id, quantity: 1 }, { product: refresco.id, quantity: 1 }], payments: [{ method: 'cash', total: 415 }] }));
// servicio 350×10% + jugo 50×5% + refresco 15×5% (categoría Bebidas) = 35 + 2.5 + 0.75
ok(l1.status === 200 && Math.abs(l1.data.order.loyalty_reward_percentage - (38.25 / 415 * 100)) < 0.01, 'tasa por partida: producto → categoría → general');
ok(Math.abs(await pts() - p0 - 38.25) < 0.01 && l1.data.payments[0].loyalty_points_reward === 38.25, 'los puntos se acreditan por pago y al cliente');
const anon = await sale(base({ client: publico.id }));
ok(anon.data.order.loyalty_reward_percentage === 0, 'el cliente genérico no acumula puntos');
const before = await pts();
const l2 = await sale(base({ client: juan.id, items: [{ product: servicio.id, quantity: 1 }], cart_discounts: [{ loyalty_points_used: 10 }], payments: [{ method: 'cash', total: 340 }] }));
ok(l2.status === 200 && l2.data.order.total === 340 && l2.data.cart_discounts[0].loyalty_points_used === 10, 'canje: 10 puntos = $10 de descuento');
const lm2 = await list('loyalty_movements', `&filter=${encodeURIComponent(`order="${l2.data.order.id}"`)}&sort=created`);
ok(lm2[0].origin === 'order_spend' && lm2[0].previous_quantity === before && lm2[1].origin === 'order_earn', 'libro de puntos: order_spend y luego order_earn');
ok(code(await sale(base({ client: juan.id, cart_discounts: [{ loyalty_points_used: 9999 }], payments: [{ method: 'cash', total: 1 }] }))) === 'insufficient_loyalty_points', 'no se canjean más puntos de los que tiene');
await patch('loyalty_programs', lp.id, { reward_percentage: 2, min_cart_total: 1000 }, tA);
ok((await sale(base({ client: juan.id }))).data.order.loyalty_reward_percentage === 0, 'por debajo del mínimo de carrito no hay puntos');
await patch('loyalty_programs', lp.id, { min_cart_total: 0 }, tA);

console.log('\n● Reembolso');
const r0 = await sale(base({ client: juan.id, items: [{ product: refresco.id, quantity: 4 }, { product: jugo.id, quantity: 1 }], payments: [{ method: 'cash', total: 110 }] }));
const stBefore = await stockOf(refresco), ptsBefore = await pts();
const ri = r0.data.items.find((i) => i.name === 'Refresco');
ok(code(await api('POST', `/api/tpv/orders/${r0.data.order.id}/refund`, { token: tCaja, body: { reason: 'other', items: [{ order_item: ri.id, quantity: 1 }], payments: [{ method: 'cash', total: 15 }] } })) === 'permission_denied', 'reembolsar exige order.refund');
ok(code(await api('POST', `/api/tpv/orders/${r0.data.order.id}/refund`, { token: tGer, body: { reason: 'other', items: [{ order_item: ri.id, quantity: 9 }], payments: [{ method: 'cash', total: 15 }] } })) === 'refund_exceeds_sold', 'no se reembolsa más de lo vendido');
ok(code(await api('POST', `/api/tpv/orders/${r0.data.order.id}/refund`, { token: tGer, body: { reason: 'other', items: [{ order_item: ri.id, quantity: 1 }], payments: [{ method: 'cash', total: 5 }] } })) === 'refund_payment_mismatch', 'los pagos del reembolso deben sumar el monto');
const rf = await api('POST', `/api/tpv/orders/${r0.data.order.id}/refund`, { token: tGer, body: { reason: 'damaged_goods', items: [{ order_item: ri.id, quantity: 1 }], payments: [{ method: 'cash', total: 15, cashier: cashierRec.id }] } });
ok(rf.status === 200 && rf.data.refund.total_refunded === 15, 'reembolso parcial de 1 refresco ($15)');
ok(await stockOf(refresco) === stBefore + 1, 'el inventario regresa (order_return)');
ok((await movements(refresco, ' && origin="order_return"')).length === 1, 'libro de inventario: order_return');
ok(await pts() < ptsBefore, 'se revierten los puntos ganados en proporción');
ok(rf.data.order.payment_status === 'completed', 'reembolso parcial: la venta sigue completed');
const rf2 = await api('POST', `/api/tpv/orders/${r0.data.order.id}/refund`, { token: tGer, body: { reason: 'other', items: [{ order_item: ri.id, quantity: 3 }, { order_item: r0.data.items.find((i) => i.name === 'Jugo').id, quantity: 1 }], payments: [{ method: 'cash', total: 95 }] } });
ok(rf2.status === 200 && rf2.data.order.payment_status === 'refunded', 'reembolso total: la venta pasa a refunded');
// reembolso que cancela deuda
const cd = await sale(cr({ items: [{ product: refresco.id, quantity: 2 }] }));
const cdi = cd.data.items[0];
const cdr = await api('POST', `/api/tpv/orders/${cd.data.order.id}/refund`, { token: tGer, body: { reason: 'other', items: [{ order_item: cdi.id, quantity: 2 }], payments: [] } });
ok(cdr.status === 200 && cdr.data.refund.cancelled_debt === 30 && cdr.data.debt.current_debt === 0, 'reembolsar una venta a crédito cancela la deuda ($30) sin devolver dinero');

console.log('\n● Cancelar, entregar y eliminar');
const pend = await sale(base({ origin: 'pos_save_as_order', payments: [] }));
ok(pend.status === 200 && pend.data.order.payment_status === 'pending' && pend.data.order.shipping_status === 'pending', 'pedido guardado: pending/pending');
const stP = await stockOf(refresco);
ok(stP === await stockOf(refresco) && (await api('GET', `/api/collections/product_stocks/records?filter=${encodeURIComponent(`product="${refresco.id}"`)}`, { token: SU })).data.items[0].quantity === stP, 'el pedido guardado NO baja el inventario');
ok(code(await sale(base({ origin: 'pos_save_as_order', payments: [] }), tCaja)) === 'permission_denied', 'guardar pedidos exige order.save_counter_order');
const pp = await api('POST', `/api/tpv/orders/${pend.data.order.id}/payments`, { token: tGer, body: { cashier: cashierRec.id, payments: [{ method: 'cash', total: 30 }] } });
ok(pp.status === 200 && pp.data.order.payment_status === 'completed', 'cobrar un pedido pendiente: payment_status completed');
const dl = await api('POST', `/api/tpv/orders/${pend.data.order.id}/deliver`, { token: tGer, body: {} });
ok(dl.status === 200 && dl.data.order.shipping_status === 'completed' && await stockOf(refresco) === stP - 2, 'entregar baja el inventario comprometido');
const pend2 = await sale(base({ origin: 'pos_save_as_order', payments: [] }));
const cn = await api('POST', `/api/tpv/orders/${pend2.data.order.id}/cancel`, { token: tGer });
ok(cn.status === 200 && cn.data.order.payment_status === 'cancelled', 'cancelar un pedido con pago pendiente');
ok(code(await api('POST', `/api/tpv/orders/${pend.data.order.id}/cancel`, { token: tGer })) === 'order_payment_not_pending', 'una venta cobrada no se cancela (se reembolsa o se elimina)');
const dd = await sale(base({ client: juan.id, payments: [{ method: 'cash', total: 30 }] }));
const stDel = await stockOf(refresco), ptsDel = await pts();
ok((await api('DELETE', `/api/tpv/orders/${dd.data.order.id}`, { token: tGer })).status === 200, 'eliminar una venta (borrado lógico)');
ok(await stockOf(refresco) === stDel + 2 && (await movements(refresco, ' && origin="order_delete"')).length === 1, 'revierte inventario con order_delete');
ok((await one('orders', `id="${dd.data.order.id}"`)).deleted_at !== '' && await pts() < ptsDel, 'queda con deleted_at y se revierten los puntos');
ok(code(await api('DELETE', `/api/tpv/orders/${r0.data.order.id}`, { token: tGer })) === 'order_has_refunds', 'una venta con reembolsos no se elimina');

console.log('\n● Cotización y licencia');
const quo = (await post('quotations', { number: 1, status: 'created', client: juan.id, location: loc.id }, SU)).data;
const fq = await sale(base({ quotation: quo.id }));
ok(fq.status === 200 && (await one('quotations', `id="${quo.id}"`)).status === 'sold', 'vender desde una cotización la marca como sold');
ok(code(await sale(base({ quotation: quo.id }))) === 'quotation_already_sold', 'no se vende dos veces la misma cotización');
await patch('license', licRec.id, { trial_ends_at: '2026-01-01 00:00:00.000Z' });
const ro = await sale(base());
ok(ro.status === 402 && ro.data.data?.trial_expired !== undefined, 'con la prueba vencida (solo lectura) no se puede vender: 402');
ok((await api('GET', `/api/tpv/orders/${o1.id}`, { token: tGer })).status === 200, '…pero sí consultar ventas');
ok((await api('GET', `/api/tpv/orders/${o1.id}`, { token: await mkUser('sinread@v.mx', ['order.create']).catch(() => '') })).status !== 200, 'consultar una venta exige order.read');

console.log(`\nResultado: ${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
