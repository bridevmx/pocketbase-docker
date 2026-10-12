/// <reference path="../pb_data/types.d.ts" />

// Primer arranque de la instancia: ¿ya hay negocio?
routerAdd('GET', '/api/tpv/setup', (e) => {
  return e.json(200, { configured: $app.countRecords('business') > 0 });
});

// Alta del negocio de ESTA instancia: negocio + licencia (si el panel no la creó) + dueño admin + valores por defecto.
// Solo funciona una vez; después responde 409.
routerAdd('POST', '/api/tpv/setup', (e) => {
  const body = e.requestInfo().body || {};
  for (const k of ['business_name', 'email', 'password', 'name']) {
    if (!body[k] || String(body[k]).trim() === '') throw new BadRequestError(`Falta el campo ${k}`);
  }
  if (String(body.password).length < 8) throw new BadRequestError('La contraseña debe tener al menos 8 caracteres');

  let result = null;
  $app.runInTransaction((tx) => {
    if (tx.countRecords('business') > 0) throw new ApiError(409, 'Esta instancia ya está configurada.', { already_configured: 'already_configured' });
    const lic = require(`${__hooks}/lib/license.js`);

    const business = new Record(tx.findCollectionByNameOrId('business'));
    business.set('name', String(body.business_name).trim());
    business.set('currency', 'mxn');
    business.set('business_type', body.business_type || 'other');
    business.set('type_of_sale', body.type_of_sale || 'retail');
    business.set('utc_offset_minutes', Math.max(-840, Math.min(840, parseInt(body.utc_offset_minutes) || 0)));
    tx.save(business);

    // licencia: la crea el panel de control antes; si no existe, arranca en prueba
    if (!lic.getLicense(tx)) {
      const d = lic.DEFAULT_TRIAL;
      const l = new Record(tx.findCollectionByNameOrId('license'));
      l.set('plan_code', d.plan_code); l.set('plan_name', d.plan_name); l.set('status', d.status);
      l.set('max_users', d.max_users); l.set('max_branches', d.max_branches); l.set('max_warehouses', d.max_warehouses);
      const ends = new Date(); ends.setDate(ends.getDate() + d.trial_days);
      l.set('trial_ends_at', ends.toISOString().replace('T', ' '));
      tx.save(l);
      for (const f of d.features) {
        const lf = new Record(tx.findCollectionByNameOrId('license_features'));
        lf.set('feature', f);
        tx.save(lf);
      }
    }

    const user = new Record(tx.findCollectionByNameOrId('users'));
    user.setEmail(String(body.email).trim());
    user.setPassword(String(body.password));
    user.set('name', String(body.name).trim());
    user.set('surname', body.surname ? String(body.surname).trim() : '');
    user.set('phone', body.phone ? String(body.phone).trim() : '');
    user.set('role', 'admin');
    user.set('is_owner', true);
    tx.save(user);

    business.set('owner', user.id);
    tx.save(business);

    require(`${__hooks}/lib/bootstrap.js`).bootstrapBusiness(tx);
    result = { business: business.id, user: user.id };
  });
  return e.json(200, result);
});
