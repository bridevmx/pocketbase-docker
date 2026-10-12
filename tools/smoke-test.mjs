#!/usr/bin/env node
// Prueba de humo contra un PocketBase ya levantado con las migraciones y los hooks de este repo.
//   PB_URL=http://127.0.0.1:8099 SU_EMAIL=... SU_PASS=... node tools/smoke-test.mjs
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const denied = (r) => [400, 403, 404].includes(r.status); // regla en falso: 400 (create) / 404 (view,update) ; regla null: 403
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };

async function api(method, path, { token, body } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password } })).data;

const su = await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: process.env.SU_EMAIL, password: process.env.SU_PASS } });
const SU = su.data?.token;
ok(!!SU, 'superusuario autenticado');

console.log('\n● Alta de cuentas (hook de bootstrap)');
const sA = await api('POST', '/api/tpv/signup', { body: { account_name: 'Tienda A', email: 'a@test.mx', password: 'password-a-1', name: 'Ana', business_type: 'groceries' } });
const sB = await api('POST', '/api/tpv/signup', { body: { account_name: 'Tienda B', email: 'b@test.mx', password: 'password-b-1', name: 'Beto' } });
ok(sA.status === 200 && sB.status === 200, 'signup de dos cuentas');
const bad = await api('POST', '/api/tpv/signup', { body: { account_name: 'X', email: 'x@test.mx', password: '123', name: 'X' } });
ok(bad.status === 400, 'signup con contraseña corta se rechaza');

const A = await login('a@test.mx', 'password-a-1'); const B = await login('b@test.mx', 'password-b-1');
const tA = A.token, tB = B.token; const accA = A.record.account, accB = B.record.account;
ok(A.record.role === 'admin' && A.record.is_account_owner === true, 'el dueño queda como admin');

const count = async (col, filter, token = SU) => (await api('GET', `/api/collections/${col}/records?perPage=1&filter=${encodeURIComponent(filter)}`, { token })).data?.totalItems;
for (const [c, n] of [['locations', 1], ['cashiers', 1], ['order_series', 1], ['price_lists', 1], ['clients', 1], ['account_settings', 1], ['account_payment_methods', 5], ['account_features', 0], ['account_units', 13]]) {
  ok((await count(c, `account="${accA}"`)) === n, `bootstrap: ${c} = ${n}`);
}
ok((await count('measure_units', 'key!=""')) === 13 && (await count('taxes', 'account=""')) === 21 && (await count('permissions', 'key!=""')) === 75 && (await count('plans', 'code!=""')) === 5, 'semillas: 13 unidades, 21 impuestos globales, 75 permisos, 5 planes');

const g = async (col, token, q = '') => (await api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token }));
const locA = (await g('locations', tA)).data.items[0];
const unit = (await g('measure_units', tA, '&filter=key="unit"')).data.items[0];
const plA = (await g('price_lists', tA)).data.items[0];
const vat = (await g('taxes', tA, '&filter=type="vat" && percentage=16 && is_exempt=false')).data.items[0];
ok(!!locA && !!unit && !!plA && !!vat, 'A ve su sucursal, unidades, lista de precios y los impuestos globales');

console.log('\n● Aislamiento entre negocios');
const catA = await api('POST', '/api/collections/product_categories/records', { token: tA, body: { account: accA, name: 'Bebidas' } });
ok(catA.status === 200, 'admin A crea categoría');
const prodA = await api('POST', '/api/collections/products/records', { token: tA, body: { account: accA, name: 'Refresco', type: 'product', sell_unit: unit.id, sku: 'REF1', barcode: '7501', category: catA.data.id, taxes: [vat.id], is_stockable: true, is_sellable: true } });
ok(prodA.status === 200, 'admin A crea producto con impuestos');
ok((await g('products', tB)).data.totalItems === 0, 'B no lista productos de A');
ok((await api('GET', `/api/collections/products/records/${prodA.data.id}`, { token: tB })).status === 404, 'B no puede ver un producto de A por id');
ok((await api('PATCH', `/api/collections/products/records/${prodA.data.id}`, { token: tB, body: { name: 'hack' } })).status === 404, 'B no puede editar un producto de A');
const crossCreate = await api('POST', '/api/collections/products/records', { token: tB, body: { account: accA, name: 'inyectado', type: 'product', sell_unit: unit.id } });
ok(crossCreate.status === 400 || crossCreate.status === 403, 'B no puede crear registros dentro de la cuenta A');
const crossRel = await api('POST', '/api/collections/products/records', { token: tB, body: { account: accB, name: 'rel-ajena', type: 'product', sell_unit: unit.id, category: catA.data.id } });
ok(crossRel.status === 400, 'B no puede relacionar su producto con una categoría de A (hook de integridad)');

console.log('\n● Unicidad y borrado lógico');
const dup = await api('POST', '/api/collections/products/records', { token: tA, body: { account: accA, name: 'Dup', type: 'product', sell_unit: unit.id, sku: 'REF1' } });
ok(dup.status === 400, 'SKU duplicado activo se rechaza');
const dupB = await api('POST', '/api/collections/products/records', { token: tB, body: { account: accB, name: 'Otro negocio', type: 'product', sell_unit: unit.id, sku: 'REF1' } });
ok(dupB.status === 200, 'el mismo SKU en otra cuenta sí se permite');
await api('PATCH', `/api/collections/products/records/${prodA.data.id}`, { token: tA, body: { deleted_at: '2026-10-12 12:00:00.000Z' } });
const reuse = await api('POST', '/api/collections/products/records', { token: tA, body: { account: accA, name: 'Reusa sku', type: 'product', sell_unit: unit.id, sku: 'REF1' } });
ok(reuse.status === 200, 'tras borrado lógico, el SKU se puede reutilizar');

console.log('\n● Permisos finos (usuario no admin)');
const prod2 = await api('POST', '/api/collections/products/records', { token: tA, body: { account: accA, name: 'Con costo', type: 'product', sell_unit: unit.id, sku: 'C1' } });
await api('POST', '/api/collections/product_costs/records', { token: tA, body: { account: accA, product: prod2.data.id, cost: 8, cost_type: 'net' } });
const perm = async (key) => (await g('permissions', SU, `&filter=key="${key}"`)).data.items[0].id;
const cashier = await api('POST', '/api/collections/users/records', { token: tA, body: { email: 'caja@test.mx', password: 'password-caja', passwordConfirm: 'password-caja', name: 'Caja', role: 'user', account: accA, permissions: [await perm('order.read'), await perm('order.create')] } });
ok(cashier.status === 200, 'admin crea un usuario no admin con permisos');
const tC = (await login('caja@test.mx', 'password-caja')).token;
ok((await g('products', tC)).data.totalItems >= 2, 'el cajero (order.create) puede leer productos');
ok((await g('product_costs', tC)).data.totalItems === 0, 'el cajero NO ve los costos (falta product.read_cost)');
ok(denied(await api('POST', '/api/collections/products/records', { token: tC, body: { account: accA, name: 'no', type: 'product', sell_unit: unit.id } })), 'el cajero NO puede crear productos');
ok(denied(await api('POST', '/api/collections/providers/records', { token: tC, body: { account: accA, name: 'no' } })), 'el cajero NO puede crear proveedores');
ok((await api('PATCH', `/api/collections/account_settings/records/${(await g('account_settings', tA)).data.items[0].id}`, { token: tC, body: { min_profit_margin: 5 } })).status === 404, 'el cajero NO puede cambiar la configuración');
ok((await api('PATCH', `/api/collections/users/records/${cashier.data.id}`, { token: tC, body: { role: 'admin' } })).status === 404, 'el cajero NO puede darse rol admin');
ok((await api('PATCH', `/api/collections/users/records/${cashier.data.id}`, { token: tC, body: { phone: '7721112233' } })).status === 200, 'el cajero sí puede editar su teléfono');
ok(denied(await api('POST', '/api/collections/users/records', { token: tC, body: { email: 'x@x.mx', password: 'password-xx', passwordConfirm: 'password-xx', name: 'x', role: 'admin', account: accA } })), 'el cajero NO puede crear usuarios');
ok((await count('users', 'email="x@x.mx"')) === 0, '…y el usuario no se creó');
ok((await count('providers', `account="${accA}"`)) === 0 && (await count('products', 'name="no"')) === 0, '…ni el proveedor ni el producto se crearon');
ok((await api('POST', '/api/collections/users/records', { token: tA, body: { email: 'z@z.mx', password: 'password-zz', passwordConfirm: 'password-zz', name: 'z', role: 'user', account: accB } })).status === 400, 'un admin NO puede crear usuarios en otra cuenta');

console.log('\n● Documentos: escritura solo por servidor y lectura acotada por sucursal');
const mkOrder = (token) => api('POST', '/api/collections/orders/records', { token, body: { account: accA, location: locA.id, client: (await_client).id, origin: 'pos', payment_status: 'completed', shipping_status: 'completed', made_at: '2026-10-12 12:00:00.000Z', request_id: 'x' + Math.random() } });
const await_client = (await g('clients', tA)).data.items[0];
ok(denied(await mkOrder(tA)), 'ni un admin puede crear ventas directo por la API (solo rutas del servidor)');
ok(denied(await api('POST', '/api/collections/stock_movements/records', { token: tA, body: { account: accA } })), 'el libro de inventario no se escribe desde el cliente');
const suOrder = await api('POST', '/api/collections/orders/records', { token: SU, body: { account: accA, location: locA.id, client: await_client.id, origin: 'pos', payment_status: 'completed', shipping_status: 'completed', made_at: '2026-10-12 12:00:00.000Z', request_id: 'r1', order_number: 1, subtotal: 10, total: 10 } });
ok(suOrder.status === 200, 'el servidor (superusuario) sí puede crear la venta');
ok((await g('orders', tC)).data.totalItems === 0, 'cajero con order.read pero sin sucursal asignada no ve ventas');
await api('PATCH', `/api/collections/users/records/${cashier.data.id}`, { token: tA, body: { locations: [locA.id] } });
ok((await g('orders', tC)).data.totalItems === 1, 'al asignarle la sucursal, ya ve las ventas de esa sucursal');
ok((await g('orders', tB)).data.totalItems === 0, 'B no ve ventas de A');
const dupReq = await api('POST', '/api/collections/orders/records', { token: SU, body: { account: accA, location: locA.id, client: await_client.id, origin: 'pos', payment_status: 'completed', shipping_status: 'completed', made_at: '2026-10-12 12:00:00.000Z', request_id: 'r1', order_number: 2 } });
ok(dupReq.status === 400, 'request_id repetido se rechaza (idempotencia de venta offline)');

console.log('\n● Catálogos globales');
ok(denied(await api('POST', '/api/collections/measure_units/records', { token: tA, body: { key: 'x', name_singular: 'x', name_plural: 'x' } })), 'un usuario no puede modificar catálogos globales');
ok((await api('GET', '/api/collections/products/records', {})).status === 403 || (await api('GET', '/api/collections/products/records', {})).data?.totalItems === 0, 'sin sesión no se lee nada');


console.log('\n● Plan, prueba y topes (SaaS)');
const subA = (await api('GET', '/api/tpv/subscription', { token: tA })).data;
ok(subA.status === 'trial' && subA.access === 'full' && subA.plan.code === 'trial', 'suscripción: cuenta nueva en prueba con acceso completo');
ok(subA.limits.users.max === 3 && subA.limits.branches.max === 1 && subA.features.includes('manufacturing'), 'suscripción: topes del plan y funciones incluidas');
const newUser = (n, token = tA) => api('POST', '/api/collections/users/records', { token, body: { email: `u${n}@test.mx`, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: 'U' + n, role: 'user', account: accA } });
ok((await newUser(1)).status === 200, 'tope de usuarios: el tercero (dueño + cajero + 1) entra');
const over = await newUser(2);
ok(over.status === 402 && over.data?.data?.plan_limit_users !== undefined, 'tope de usuarios: el cuarto se rechaza con 402 plan_limit_users');
const newLoc = (type, name) => api('POST', '/api/collections/locations/records', { token: tA, body: { account: accA, name, type } });
const l2 = await newLoc('branch', 'Sucursal 2');
ok(l2.status === 402 && l2.data?.data?.plan_limit_branches !== undefined, 'tope de sucursales: la segunda se rechaza (plan trial = 1)');
ok((await newLoc('warehouse', 'Almacén 1')).status === 200, 'tope de almacenes: el primero entra');
ok((await newLoc('warehouse', 'Almacén 2')).status === 402, 'tope de almacenes: el segundo se rechaza');
ok((await api('POST', '/api/collections/account_features/records', { token: tA, body: { account: accA, feature: 'extra_branch', enabled: true, quantity: 1 } })).status === 403, 'el cliente NO puede darse add-ons');
const addon = await api('POST', '/api/collections/account_features/records', { token: SU, body: { account: accA, feature: 'extra_branch', enabled: true, quantity: 1 } });
ok(addon.status === 200, 'el superusuario (cobro) registra el add-on extra_branch');
ok((await newLoc('branch', 'Sucursal 2')).status === 200, 'con el add-on, la segunda sucursal sí entra');
ok((await newLoc('branch', 'Sucursal 3')).status === 402, '…pero la tercera no');
ok((await api('GET', '/api/tpv/subscription', { token: tA })).data.limits.branches.max === 2, 'la suscripción refleja plan + add-on (2 sucursales)');
ok(denied(await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: tA, body: { status: 'active' } })), 'el cliente NO puede cambiar su estado de suscripción');
ok(denied(await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: tA, body: { plan: (await g('plans', SU, '&filter=code="pro"')).data.items[0].id } })), 'el cliente NO puede cambiar su plan');
ok((await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: tA, body: { name: 'Tienda A (renombrada)' } })).status === 200, 'pero sí puede cambiar el nombre de su negocio');

// prueba vencida → solo lectura
await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: SU, body: { trial_ends_at: '2026-01-01 00:00:00.000Z' } });
const exp = await api('POST', '/api/collections/product_categories/records', { token: tA, body: { account: accA, name: 'Nueva' } });
ok(exp.status === 402 && exp.data?.data?.trial_expired !== undefined, 'prueba vencida: escribir da 402 trial_expired');
ok((await g('products', tA)).status === 200 && (await g('products', tA)).data.totalItems >= 1, 'prueba vencida: sigue pudiendo LEER sus datos');
const subExp = (await api('GET', '/api/tpv/subscription', { token: tA })).data;
ok(subExp.access === 'read_only' && subExp.reason === 'trial_expired', 'la suscripción informa read_only / trial_expired');
ok((await api('POST', '/api/collections/product_categories/records', { token: tB, body: { account: accB, name: 'B sigue' } })).status === 200, 'otro negocio no se afecta');

// pago al corriente → vuelve a escribir; vencido dentro de la gracia sí; fuera de la gracia no
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().replace('T', ' ');
await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: SU, body: { status: 'active', paid_until: days(30) } });
ok((await api('POST', '/api/collections/product_categories/records', { token: tA, body: { account: accA, name: 'Pagada' } })).status === 200, 'plan activo con pago vigente: escribe');
await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: SU, body: { paid_until: days(-1) } });
ok((await api('POST', '/api/collections/product_categories/records', { token: tA, body: { account: accA, name: 'Gracia' } })).status === 200, 'pago vencido ayer: aún dentro de los días de gracia');
await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: SU, body: { paid_until: days(-10) } });
const od = await api('POST', '/api/collections/product_categories/records', { token: tA, body: { account: accA, name: 'Vencida' } });
ok(od.status === 402 && od.data?.data?.payment_overdue !== undefined, 'pago vencido hace 10 días: 402 payment_overdue');

// suspendida → ni entra
await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: SU, body: { status: 'suspended' } });
ok((await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@test.mx', password: 'password-a-1' } })).status === 403, 'cuenta suspendida: no se puede iniciar sesión');
await api('PATCH', `/api/collections/accounts/records/${accA}`, { token: SU, body: { status: 'active', paid_until: days(30) } });
ok((await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@test.mx', password: 'password-a-1' } })).status === 200, 'al reactivarla, vuelve a entrar');

console.log(`\nResultado: ${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
