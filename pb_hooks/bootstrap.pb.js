/// <reference path="../pb_data/types.d.ts" />

// 1) Al crear una cuenta (por superusuario o por /api/tpv/signup) se siembran sus valores por defecto.
onRecordAfterCreateSuccess((e) => {
  require(`${__hooks}/lib/bootstrap.js`).bootstrapAccount(e.app, e.record);
  e.next();
}, 'accounts');

// 2) Alta pública: cuenta + usuario dueño (admin) en una sola transacción.
routerAdd('POST', '/api/tpv/signup', (e) => {
  const body = e.requestInfo().body || {};
  const need = ['account_name', 'email', 'password', 'name'];
  for (const k of need) {
    if (!body[k] || String(body[k]).trim() === '') throw new BadRequestError(`Falta el campo ${k}`);
  }
  if (String(body.password).length < 8) throw new BadRequestError('La contraseña debe tener al menos 8 caracteres');

  let result = null;
  $app.runInTransaction((tx) => {
    const accounts = tx.findCollectionByNameOrId('accounts');
    const account = new Record(accounts);
    account.set('name', String(body.account_name).trim());
    account.set('currency', 'mxn');
    account.set('business_type', body.business_type || 'other');
    account.set('type_of_sale', body.type_of_sale || 'retail');
    account.set('plan', 'trial');
    account.set('active', true);
    const trial = new Date();
    trial.setDate(trial.getDate() + 14);
    account.set('trial_ends_at', trial.toISOString().replace('T', ' '));
    tx.save(account);

    const users = tx.findCollectionByNameOrId('users');
    const user = new Record(users);
    user.setEmail(String(body.email).trim());
    user.setPassword(String(body.password));
    user.set('name', String(body.name).trim());
    user.set('surname', body.surname ? String(body.surname).trim() : '');
    user.set('phone', body.phone ? String(body.phone).trim() : '');
    user.set('role', 'admin');
    user.set('is_account_owner', true);
    user.set('account', account.id);
    tx.save(user);

    account.set('owner', user.id);
    tx.save(account);
    result = { account: account.id, user: user.id };
  });
  return e.json(200, result);
});
