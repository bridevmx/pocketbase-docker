/// <reference path="../pb_data/types.d.ts" />

// Sincronización del POS sin conexión. Ver docs/pulpos-sync-api.md

routerAdd('GET', '/api/tpv/sync/config', (e) => e.json(200, require(`${__hooks}/lib/sync.js`).config($app, e.auth)), $apis.requireAuth('users'));
routerAdd('GET', '/api/tpv/sync/{entity}', (e) => e.json(200, require(`${__hooks}/lib/sync.js`).pull($app, e.auth, e.request.pathValue('entity'), e.requestInfo().query)), $apis.requireAuth('users'));
routerAdd('POST', '/api/tpv/sync/orders', (e) => e.json(200, require(`${__hooks}/lib/sync.js`).pushOrders($app, e.auth, e.requestInfo().body || {})), $apis.requireAuth('users'));

// Lo que viaja embebido en el producto (precios, combos, costo) debe mover su `updated`.
// (cada handler corre aislado: no puede ver variables del archivo, por eso no hay helper compartido)
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('product')); e.next(); }, 'product_prices');
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('product')); e.next(); }, 'product_prices');
onRecordAfterDeleteSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('product')); e.next(); }, 'product_prices');
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('combo')); e.next(); }, 'combo_items');
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('combo')); e.next(); }, 'combo_items');
onRecordAfterDeleteSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('combo')); e.next(); }, 'combo_items');
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('product')); e.next(); }, 'product_costs');
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('product')); e.next(); }, 'product_costs');
onRecordAfterDeleteSuccess((e) => { require(`${__hooks}/lib/sync.js`).touchProduct($app, e.record.getString('product')); e.next(); }, 'product_costs');
