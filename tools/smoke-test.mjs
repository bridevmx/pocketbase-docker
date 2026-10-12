#!/usr/bin/env node
// Prueba de humo contra UNA instancia ya levantada con las migraciones y los hooks de este repo.
//   PB_URL=http://127.0.0.1:8099 SU_EMAIL=... SU_PASS=... node tools/smoke-test.mjs
const URL_ = process.env.PB_URL || 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const denied = (r) => [400, 403, 404].includes(r.status); // regla en falso: 400 (create) / 404 (view,update); regla null: 403
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };

export async function api(method, path, { token, body } = {}) {
  const res = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password } })).data;
const su = await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: process.env.SU_EMAIL, password: process.env.SU_PASS } });
const SU = su.data?.token;
ok(!!SU, 'superusuario (panel de control) autenticado');

const g = async (col, token, q = '') => api('GET', `/api/collections/${col}/records?perPage=200${q}`, { token });
const count = async (col, filter, token = SU) => (await api('GET', `/api/collections/${col}/records?perPage=1&filter=${encodeURIComponent(filter)}`, { token })).data?.totalItems;

console.log('\n● Alta de la instancia (una sola vez)');
ok((await api('GET', '/api/tpv/setup')).data.configured === false, 'instancia nueva: configured = false');
const bad = await api('POST', '/api/tpv/setup', { body: { business_name: 'X', email: 'x@test.mx', password: '123', name: 'X' } });
ok(bad.status === 400, 'setup con contraseña corta se rechaza');
const setup = await api('POST', '/api/tpv/setup', { body: { business_name: 'Mi Tienda', email: 'dueno@test.mx', password: 'password-dueno', name: 'Ana', business_type: 'groceries' } });
ok(setup.status === 200, 'setup crea negocio + dueño + licencia + valores por defecto');
ok((await api('POST', '/api/tpv/setup', { body: { business_name: 'Otra', email: 'o@test.mx', password: 'password-otra', name: 'O' } })).status === 409, 'un segundo setup se rechaza (409)');
ok((await api('GET', '/api/tpv/setup')).data.configured === true, 'configured = true');

const A = await login('dueno@test.mx', 'password-dueno'); const tA = A.token;
ok(A.record.role === 'admin' && A.record.is_owner === true, 'el dueño queda como admin y propietario');
for (const [c, n] of [['business', 1], ['license', 1], ['license_features', 4], ['locations', 1], ['cashiers', 1], ['order_series', 1], ['price_lists', 1], ['clients', 1], ['pos_settings', 1], ['enabled_payment_methods', 5], ['enabled_units', 13]]) {
  ok((await count(c, 'id!=""')) === n, `bootstrap: ${c} = ${n}`);
}
ok((await count('measure_units', 'key!=""')) === 13 && (await count('taxes', 'id!=""')) === 21 && (await count('permissions', 'key!=""')) === 75, 'semillas: 13 unidades, 21 impuestos, 75 permisos');

const locA = (await g('locations', tA)).data.items[0];
const unit = (await g('measure_units', tA, '&filter=key="unit"')).data.items[0];
const vat = (await g('taxes', tA, '&filter=type="vat" && percentage=16 && is_exempt=false')).data.items[0];
const client = (await g('clients', tA)).data.items[0];
ok(!!locA && !!unit && !!vat && !!client, 'el dueño ve sucursal, unidades, impuestos y cliente genérico');
ok((await g('products', undefined)).status !== 200 || (await g('products', undefined)).data.totalItems === 0, 'sin sesión no se lee nada');

console.log('\n● Catálogo, unicidad y borrado lógico');
const cat = await api('POST', '/api/collections/product_categories/records', { token: tA, body: { name: 'Bebidas' } });
ok(cat.status === 200, 'admin crea categoría');
const prod = await api('POST', '/api/collections/products/records', { token: tA, body: { name: 'Refresco', type: 'product', sell_unit: unit.id, sku: 'REF1', barcode: '7501', category: cat.data.id, taxes: [vat.id], is_stockable: true, is_sellable: true } });
ok(prod.status === 200, 'admin crea producto con impuestos');
ok((await api('POST', '/api/collections/products/records', { token: tA, body: { name: 'Dup', type: 'product', sell_unit: unit.id, sku: 'REF1' } })).status === 400, 'SKU duplicado activo se rechaza');
ok((await api('POST', '/api/collections/products/records', { token: tA, body: { name: 'Dup2', type: 'product', sell_unit: unit.id, barcode: '7501' } })).status === 400, 'código de barras duplicado se rechaza');
await api('PATCH', `/api/collections/products/records/${prod.data.id}`, { token: tA, body: { deleted_at: '2026-10-12 12:00:00.000Z' } });
ok((await api('POST', '/api/collections/products/records', { token: tA, body: { name: 'Reusa', type: 'product', sell_unit: unit.id, sku: 'REF1' } })).status === 200, 'tras borrado lógico, el SKU se puede reutilizar');

console.log('\n● Permisos finos (usuario no admin)');
const prod2 = await api('POST', '/api/collections/products/records', { token: tA, body: { name: 'Con costo', type: 'product', sell_unit: unit.id, sku: 'C1' } });
await api('POST', '/api/collections/product_costs/records', { token: tA, body: { product: prod2.data.id, cost: 8, cost_type: 'net' } });
const perm = async (key) => (await g('permissions', SU, `&filter=key="${key}"`)).data.items[0].id;
const cashier = await api('POST', '/api/collections/users/records', { token: tA, body: { email: 'caja@test.mx', password: 'password-caja', passwordConfirm: 'password-caja', name: 'Caja', role: 'user', permissions: [await perm('order.read'), await perm('order.create')] } });
ok(cashier.status === 200, 'admin crea un usuario no admin con permisos');
const tC = (await login('caja@test.mx', 'password-caja')).token;
ok((await g('products', tC)).data.totalItems >= 2, 'el cajero (order.create) puede leer productos');
ok((await g('product_costs', tC)).data.totalItems === 0, 'el cajero NO ve los costos (falta product.read_cost)');
ok(denied(await api('POST', '/api/collections/products/records', { token: tC, body: { name: 'no', type: 'product', sell_unit: unit.id } })), 'el cajero NO puede crear productos');
ok(denied(await api('POST', '/api/collections/providers/records', { token: tC, body: { name: 'no' } })), 'el cajero NO puede crear proveedores');
ok((await count('providers', 'id!=""')) === 0 && (await count('products', 'name="no"')) === 0, '…y no se creó nada');
const settingsId = (await g('pos_settings', tA)).data.items[0].id;
ok(denied(await api('PATCH', `/api/collections/pos_settings/records/${settingsId}`, { token: tC, body: { min_profit_margin: 5 } })), 'el cajero NO puede cambiar la configuración');
ok((await api('PATCH', `/api/collections/pos_settings/records/${settingsId}`, { token: tA, body: { allow_selling_out_of_stock: false } })).status === 200, 'el admin sí');
ok(denied(await api('PATCH', `/api/collections/users/records/${cashier.data.id}`, { token: tC, body: { role: 'admin' } })), 'el cajero NO puede darse rol admin');
ok((await api('PATCH', `/api/collections/users/records/${cashier.data.id}`, { token: tC, body: { phone: '7721112233' } })).status === 200, 'el cajero sí puede editar su teléfono');
ok(denied(await api('POST', '/api/collections/users/records', { token: tC, body: { email: 'x@x.mx', password: 'password-xx', passwordConfirm: 'password-xx', name: 'x', role: 'admin' } })), 'el cajero NO puede crear usuarios');
ok(denied(await api('PATCH', `/api/collections/users/records/${A.record.id}`, { token: tA, body: { is_owner: false } })), 'nadie puede quitarse/dar la propiedad por la API');
ok(denied(await api('DELETE', `/api/collections/users/records/${A.record.id}`, { token: tA })), 'el dueño no puede borrarse a sí mismo');

console.log('\n● Documentos: escritura solo por servidor y lectura acotada por sucursal');
const orderBody = (rid, n) => ({ location: locA.id, client: client.id, origin: 'pos', payment_status: 'completed', shipping_status: 'completed', made_at: '2026-10-12 12:00:00.000Z', request_id: rid, order_number: n, subtotal: 10, total: 10 });
ok(denied(await api('POST', '/api/collections/orders/records', { token: tA, body: orderBody('x1', 1) })), 'ni un admin crea ventas directo por la API (solo rutas del servidor)');
ok(denied(await api('POST', '/api/collections/stock_movements/records', { token: tA, body: {} })), 'el libro de inventario no se escribe desde el cliente');
ok((await api('POST', '/api/collections/orders/records', { token: SU, body: orderBody('r1', 1) })).status === 200, 'el servidor (superusuario) sí crea la venta');
ok((await g('orders', tC)).data.totalItems === 0, 'cajero con order.read pero sin sucursal asignada no ve ventas');
await api('PATCH', `/api/collections/users/records/${cashier.data.id}`, { token: tA, body: { locations: [locA.id] } });
ok((await g('orders', tC)).data.totalItems === 1, 'al asignarle la sucursal, ya ve las ventas de esa sucursal');
ok((await api('POST', '/api/collections/orders/records', { token: SU, body: orderBody('r1', 2) })).status === 400, 'request_id repetido se rechaza (idempotencia de venta offline)');
ok(denied(await api('POST', '/api/collections/measure_units/records', { token: tA, body: { key: 'x', name_singular: 'x', name_plural: 'x' } })), 'nadie modifica catálogos globales');

console.log('\n● Licencia, prueba y topes (SaaS por instancia)');
const lic = (await g('license', tA)).data.items[0];
const sub = (await api('GET', '/api/tpv/subscription', { token: tA })).data;
ok(sub.status === 'trial' && sub.access === 'full' && sub.plan.code === 'trial', 'licencia: instancia nueva en prueba con acceso completo');
ok(sub.limits.users.max === 3 && sub.limits.branches.max === 1 && sub.features.includes('manufacturing'), 'licencia: topes y funciones');
const newUser = (n) => api('POST', '/api/collections/users/records', { token: tA, body: { email: `u${n}@test.mx`, password: 'password-uu-1', passwordConfirm: 'password-uu-1', name: 'U' + n, role: 'user' } });
ok((await newUser(1)).status === 200, 'tope de usuarios: el tercero (dueño + cajero + 1) entra');
const over = await newUser(2);
ok(over.status === 402 && over.data?.data?.plan_limit_users !== undefined, 'tope de usuarios: el cuarto se rechaza con 402 plan_limit_users');
const newLoc = (type, name) => api('POST', '/api/collections/locations/records', { token: tA, body: { name, type } });
const l2 = await newLoc('branch', 'Sucursal 2');
ok(l2.status === 402 && l2.data?.data?.plan_limit_branches !== undefined, 'tope de sucursales: la segunda se rechaza');
ok((await newLoc('warehouse', 'Almacén 1')).status === 200, 'tope de almacenes: el primero entra');
ok((await newLoc('warehouse', 'Almacén 2')).status === 402, 'tope de almacenes: el segundo se rechaza');
ok(denied(await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: tA, body: { max_branches: 99 } })), 'el cliente NO puede editar su licencia');
ok(denied(await api('POST', '/api/collections/license_features/records', { token: tA, body: { feature: 'extra_user' } })), 'el cliente NO puede darse funciones');
ok((await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { max_branches: 2, plan_code: 'avanzado', plan_name: 'Avanzado' } })).status === 200, 'el panel (superusuario) mejora el plan: 2 sucursales');
ok((await newLoc('branch', 'Sucursal 2')).status === 200, 'con el plan mejorado, la segunda sucursal entra');
ok((await newLoc('branch', 'Sucursal 3')).status === 402, '…pero la tercera no');
ok((await api('PATCH', `/api/collections/business/records/${(await g('business', tA)).data.items[0].id}`, { token: tA, body: { name: 'Mi Tienda (renombrada)' } })).status === 200, 'el admin sí puede cambiar el nombre del negocio');

await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { trial_ends_at: '2026-01-01 00:00:00.000Z' } });
const exp = await api('POST', '/api/collections/product_categories/records', { token: tA, body: { name: 'Nueva' } });
ok(exp.status === 402 && exp.data?.data?.trial_expired !== undefined, 'prueba vencida: escribir da 402 trial_expired');
ok((await g('products', tA)).data.totalItems >= 1, 'prueba vencida: sigue pudiendo LEER sus datos');
const subExp = (await api('GET', '/api/tpv/subscription', { token: tA })).data;
ok(subExp.access === 'read_only' && subExp.reason === 'trial_expired', 'la suscripción informa read_only / trial_expired');
ok((await api('PATCH', `/api/collections/users/records/${A.record.id}`, { token: tA, body: { phone: '7720000000' } })).status === 200, 'en solo lectura aún puede editar sus propios datos');
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().replace('T', ' ');
await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { status: 'active', paid_until: days(30) } });
ok((await api('POST', '/api/collections/product_categories/records', { token: tA, body: { name: 'Pagada' } })).status === 200, 'plan activo con pago vigente: escribe');
await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { paid_until: days(-1) } });
ok((await api('POST', '/api/collections/product_categories/records', { token: tA, body: { name: 'Gracia' } })).status === 200, 'pago vencido ayer: aún dentro de los días de gracia');
await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { paid_until: days(-10) } });
const od = await api('POST', '/api/collections/product_categories/records', { token: tA, body: { name: 'Vencida' } });
ok(od.status === 402 && od.data?.data?.payment_overdue !== undefined, 'pago vencido hace 10 días: 402 payment_overdue');

await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { status: 'suspended' } });
ok((await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'dueno@test.mx', password: 'password-dueno' } })).status === 403, 'suspendida: no se puede iniciar sesión');
ok((await g('products', tA)).status === 403, 'suspendida: una sesión abierta deja de funcionar');
await api('PATCH', `/api/collections/license/records/${lic.id}`, { token: SU, body: { status: 'active', paid_until: days(30) } });
ok((await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'dueno@test.mx', password: 'password-dueno' } })).status === 200, 'al reactivarla, vuelve a entrar');

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\nResultado: ${pass} ok, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
export { pass, fail };
