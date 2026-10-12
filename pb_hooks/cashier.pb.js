/// <reference path="../pb_data/types.d.ts" />

// Caja: movimientos manuales y corte (prepare → finish). Ver docs/pulpos-inventory-api.md#caja

routerAdd('GET', '/api/tpv/cashiers/{id}/current', (e) => e.json(200, require(`${__hooks}/lib/cashier.js`).current($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/cashier-audits', (e) => e.json(200, require(`${__hooks}/lib/cashier.js`).prepare($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/cashier-audits/{id}/finish', (e) => e.json(200, require(`${__hooks}/lib/cashier.js`).finish($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/cash-movements', (e) => e.json(200, require(`${__hooks}/lib/cashier.js`).addMovement($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('DELETE', '/api/tpv/cash-movements/{id}', (e) => e.json(200, require(`${__hooks}/lib/cashier.js`).removeMovement($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
