/// <reference path="../pb_data/types.d.ts" />

// Escrituras por API: licencia vigente (prueba / pago al corriente) y topes del plan.
// Los superusuarios (el panel de control) no se restringen.
// (La lógica vive en lib/: los handlers no ven funciones declaradas a nivel de archivo.)
onRecordCreateRequest((e) => { require(`${__hooks}/lib/guard.js`).guard(e, 'create'); e.next(); });
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/guard.js`).guard(e, 'update'); e.next(); });
onRecordDeleteRequest((e) => { require(`${__hooks}/lib/guard.js`).guard(e, 'delete'); e.next(); });

// Licencia suspendida/cancelada: no se inicia sesión...
onRecordAuthRequest((e) => {
  const lic = require(`${__hooks}/lib/license.js`);
  const a = lic.accessLevel(lic.getLicense($app));
  if (a.level === 'blocked') throw new ForbiddenError('La cuenta no tiene acceso.', { [a.reason]: a.reason });
  e.next();
}, 'users');

// ...y las sesiones abiertas dejan de funcionar
routerUse((e) => {
  if (e.auth && !e.hasSuperuserAuth() && e.request.url.path.startsWith('/api/')) {
    const lic = require(`${__hooks}/lib/license.js`);
    const a = lic.accessLevel(lic.getLicense($app));
    if (a.level === 'blocked') throw new ForbiddenError('La cuenta no tiene acceso.', { [a.reason]: a.reason });
  }
  return e.next();
});

// Estado de la suscripción para la interfaz
routerAdd('GET', '/api/tpv/subscription', (e) => {
  const lic = require(`${__hooks}/lib/license.js`);
  const l = lic.limits($app);
  const a = lic.accessLevel(l.license);
  return e.json(200, {
    status: l.license ? l.license.getString('status') : null,
    access: a.level,
    reason: a.reason,
    plan: l.license ? { code: l.license.getString('plan_code'), name: l.license.getString('plan_name') } : null,
    trial_ends_at: l.license ? l.license.getString('trial_ends_at') || null : null,
    paid_until: l.license ? l.license.getString('paid_until') || null : null,
    limits: { users: { used: l.used.users, max: l.max.users }, branches: { used: l.used.branches, max: l.max.branches }, warehouses: { used: l.used.warehouses, max: l.max.warehouses } },
    features: lic.features($app),
  });
}, $apis.requireAuth('users'));
