#!/usr/bin/env node
// Panel de control -> instancia: crea o actualiza la licencia del negocio (solo un superusuario puede).
//   node tools/set-license.mjs --url https://tienda1.tpv.ejemplo.com --email su@x.com --pass '...' \
//        --plan pro --name Pro --status active --paid-until 2026-12-01 \
//        --max-users 10 --max-branches 5 --max-warehouses 5 --features manufacturing,catalog_plus
const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
for (const k of ['url', 'email', 'pass']) if (!a[k]) { console.error(`Falta --${k}`); process.exit(2); }
const call = async (method, path, token, body) => {
  const r = await fetch(a.url + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(method, path, r.status, JSON.stringify(d)); process.exit(1); }
  return d;
};
const token = (await call('POST', '/api/collections/_superusers/auth-with-password', null, { identity: a.email, password: a.pass })).token;
const body = {};
const map = { plan: 'plan_code', name: 'plan_name', status: 'status', 'max-users': 'max_users', 'max-branches': 'max_branches', 'max-warehouses': 'max_warehouses' };
for (const [k, f] of Object.entries(map)) if (a[k] !== undefined) body[f] = ['max-users', 'max-branches', 'max-warehouses'].includes(k) ? Number(a[k]) : a[k];
if (a['paid-until']) body.paid_until = new Date(a['paid-until']).toISOString().replace('T', ' ');
if (a['trial-ends']) body.trial_ends_at = new Date(a['trial-ends']).toISOString().replace('T', ' ');
const existing = (await call('GET', '/api/collections/license/records?perPage=1', token)).items[0];
const lic = existing ? await call('PATCH', `/api/collections/license/records/${existing.id}`, token, body) : await call('POST', '/api/collections/license/records', token, { status: 'trial', max_users: 3, max_branches: 1, max_warehouses: 1, ...body });
if (a.features !== undefined) {
  const want = new Set(a.features.split(',').filter(Boolean));
  const have = (await call('GET', '/api/collections/license_features/records?perPage=100', token)).items;
  for (const f of have) if (!want.has(f.feature)) await call('DELETE', `/api/collections/license_features/records/${f.id}`, token);
  for (const f of want) if (!have.some((h) => h.feature === f)) await call('POST', '/api/collections/license_features/records', token, { feature: f });
}
console.log('licencia:', JSON.stringify({ id: lic.id, plan: lic.plan_code, status: lic.status, max_users: lic.max_users, max_branches: lic.max_branches, max_warehouses: lic.max_warehouses, paid_until: lic.paid_until }));
