// Guardia de escrituras por API: licencia con acceso completo y topes del plan.
function guard(e, op) {
  if (e.hasSuperuserAuth() || !e.auth) return;
  const col = e.record.collection();
  // cambiar tu propia contraseña/datos no se bloquea en modo solo lectura
  if (col.name === 'users' && op === 'update' && e.record.id === e.auth.id) return;
  const lic = require(`${__hooks}/lib/license.js`);
  lic.assertWritable($app);

  // topes de plan al crear (o reactivar un registro borrado lógicamente)
  const undeleting = op === 'update' && e.record.original().getString('deleted_at') !== '' && e.record.getString('deleted_at') === '';
  if (op === 'create' || undeleting) {
    if (col.name === 'users') lic.assertCanAdd($app, 'users');
    if (col.name === 'locations') lic.assertCanAdd($app, e.record.getString('type') === 'warehouse' ? 'warehouses' : 'branches');
  }
}
module.exports = { guard };
