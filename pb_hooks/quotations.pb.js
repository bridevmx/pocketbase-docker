/// <reference path="../pb_data/types.d.ts" />

// Cotizaciones. Ver docs/pulpos-sales-api.md#cotizaciones

routerAdd('POST', '/api/tpv/quotations', (e) => e.json(200, require(`${__hooks}/lib/quotations.js`).create($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/quotations/{id}', (e) => e.json(200, require(`${__hooks}/lib/quotations.js`).get($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
routerAdd('PUT', '/api/tpv/quotations/{id}', (e) => e.json(200, require(`${__hooks}/lib/quotations.js`).update($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('DELETE', '/api/tpv/quotations/{id}', (e) => e.json(200, require(`${__hooks}/lib/quotations.js`).remove($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/quotations/{id}/convert', (e) => e.json(200, require(`${__hooks}/lib/quotations.js`).convert($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
