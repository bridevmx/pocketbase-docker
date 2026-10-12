/// <reference path="../pb_data/types.d.ts" />

// Rutas transaccionales de inventario: ajustes (incluye carga inicial), traspasos, compras, gastos y fabricación.
// El cliente nunca escribe estos documentos ni el inventario directamente. Ver docs/pulpos-inventory-api.md

// Ajustes
routerAdd('POST', '/api/tpv/stock-adjustments', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).createAdjustment($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/stock-adjustments/{id}/complete', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).completeAdjustment($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
routerAdd('DELETE', '/api/tpv/stock-adjustments/{id}', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).removeAdjustment($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));

// Traspasos
routerAdd('POST', '/api/tpv/transfers', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).createTransfer($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/transfers/{id}/send', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).sendTransfer($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/transfers/{id}/receive', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).receiveTransfer($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('DELETE', '/api/tpv/transfers/{id}', (e) => e.json(200, require(`${__hooks}/lib/inventory.js`).removeTransfer($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));

// Compras
routerAdd('POST', '/api/tpv/purchases', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).createPurchase($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/purchases/{id}/complete', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).completePurchase($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/purchases/{id}/payments', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).payDebt($app, e.auth, 'purchase', e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('DELETE', '/api/tpv/purchases/{id}', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).removePurchase($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));

// Gastos
routerAdd('POST', '/api/tpv/expenses', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).createExpense($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/expenses/{id}/payments', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).payDebt($app, e.auth, 'expense', e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('DELETE', '/api/tpv/expenses/{id}', (e) => e.json(200, require(`${__hooks}/lib/outlays.js`).removeExpense($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));

// Fabricación
routerAdd('POST', '/api/tpv/manufacturing-orders', (e) => e.json(200, require(`${__hooks}/lib/manufacturing.js`).create($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/manufacturing-orders/{id}/start', (e) => e.json(200, require(`${__hooks}/lib/manufacturing.js`).start($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/manufacturing-orders/{id}/finish', (e) => e.json(200, require(`${__hooks}/lib/manufacturing.js`).finish($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {})), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/manufacturing-orders/{id}/cancel', (e) => e.json(200, require(`${__hooks}/lib/manufacturing.js`).cancel($app, e.auth, e.request.pathValue('id'))), $apis.requireAuth('users'));
