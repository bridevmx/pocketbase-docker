/// <reference path="../pb_data/types.d.ts" />

// Integridad multi-tenant: ninguna relación puede apuntar a un registro de OTRA cuenta.
// Se ejecuta en TODA escritura (API, rutas y hooks), así que protege aunque una regla se olvide.
onRecordValidate((e) => {
  const col = e.record.collection();
  const accountField = col.fields.getByName('account');
  if (accountField && col.name !== 'accounts') {
    const myAccount = e.record.getString('account');
    for (const f of col.fields) {
      if (f.type() !== 'relation' || f.name === 'account') continue;
      const ids = e.record.getStringSlice(f.name);
      if (!ids.length) continue;
      const target = $app.findCollectionByNameOrId(f.collectionId);
      if (!target.fields.getByName('account')) continue; // catálogos globales (unidades, permisos…)
      for (const id of ids) {
        let rec;
        try { rec = $app.findRecordById(target.name, id); } catch (_) { continue; } // la regla `required`/existencia ya la valida PocketBase
        const theirs = rec.getString('account');
        if (theirs !== '' && theirs !== myAccount) {
          throw new BadRequestError(`${col.name}.${f.name}: el registro pertenece a otra cuenta`);
        }
      }
    }
  }
  e.next();
});
