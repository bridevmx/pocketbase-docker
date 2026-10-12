/// <reference path="../pb_data/types.d.ts" />

// Analítica (solo lectura, agregada en el servidor). Ver docs/pulpos-analytics-api.md
// Parámetros comunes: from, to (AAAA-MM-DD locales, to incluyente), tz_offset (minutos vs UTC), location.

routerAdd('GET', '/api/tpv/analytics/sales', (e) => e.json(200, require(`${__hooks}/lib/analytics.js`).sales($app, e.auth, e.requestInfo().query)), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/analytics/inventory', (e) => e.json(200, require(`${__hooks}/lib/analytics.js`).inventory($app, e.auth, e.requestInfo().query)), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/analytics/purchases', (e) => e.json(200, require(`${__hooks}/lib/analytics.js`).outlays($app, e.auth, 'purchases', e.requestInfo().query)), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/analytics/expenses', (e) => e.json(200, require(`${__hooks}/lib/analytics.js`).outlays($app, e.auth, 'expenses', e.requestInfo().query)), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/analytics/finance', (e) => e.json(200, require(`${__hooks}/lib/analytics.js`).finance($app, e.auth, e.requestInfo().query)), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/analytics/taxes', (e) => e.json(200, require(`${__hooks}/lib/analytics.js`).taxes($app, e.auth, e.requestInfo().query)), $apis.requireAuth('users'));
