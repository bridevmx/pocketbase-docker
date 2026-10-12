// Guardia de escrituras por API: acceso completo de la cuenta y topes del plan.
function guard(e, op) {
  if (e.hasSuperuserAuth() || !e.auth) return;
  const col = e.record.collection();
  if (col.name === 'accounts') return;
  if (!col.fields.getByName('account')) return;
  const access = require(`${__hooks}/lib/access.js`);
  const accountId = e.auth.getString('account');
  access.assertWritable($app, accountId);

  // topes de plan al crear (o reactivar un registro borrado lógicamente)
  const undeleting = op === 'update' && e.record.original().getString('deleted_at') !== '' && e.record.getString('deleted_at') === '';
  if (op === 'create' || undeleting) {
    if (col.name === 'users') access.assertCanAdd($app, accountId, 'users');
    if (col.name === 'locations') access.assertCanAdd($app, accountId, e.record.getString('type') === 'warehouse' ? 'warehouses' : 'branches');
  }
}
module.exports = { guard };
