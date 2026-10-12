/// <reference path="../pb_data/types.d.ts" />

// Escrituras por API: la cuenta debe tener acceso completo (prueba vigente / pago al corriente)
// y respetar los topes del plan. Los superusuarios no se restringen. (La lógica vive en lib/guard.js:
// los handlers de PocketBase no ven funciones declaradas a nivel de archivo.)
onRecordCreateRequest((e) => { require(`${__hooks}/lib/guard.js`).guard(e, 'create'); e.next(); });
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/guard.js`).guard(e, 'update'); e.next(); });
onRecordDeleteRequest((e) => { require(`${__hooks}/lib/guard.js`).guard(e, 'delete'); e.next(); });

// Estado de la suscripción para la interfaz (plan, topes, uso y funciones)
routerAdd('GET', '/api/tpv/subscription', (e) => {
  const access = require(`${__hooks}/lib/access.js`);
  const accountId = e.auth.getString('account');
  const l = access.limits($app, accountId);
  const a = access.accessLevel(l.account);
  return e.json(200, {
    status: l.account.getString('status'),
    access: a.level,
    reason: a.reason,
    plan: l.plan ? { code: l.plan.getString('code'), name: l.plan.getString('name') } : null,
    trial_ends_at: l.account.getString('trial_ends_at') || null,
    paid_until: l.account.getString('paid_until') || null,
    limits: { users: { used: l.used.users, max: l.max.users }, branches: { used: l.used.branches, max: l.max.branches }, warehouses: { used: l.used.warehouses, max: l.max.warehouses } },
    features: access.features($app, accountId),
  });
}, $apis.requireAuth('users'));
