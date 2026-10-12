/// <reference path="../pb_data/types.d.ts" />

// Rutas transaccionales de ventas. Todo se valida y calcula en el servidor; el cliente nunca escribe
// ventas, pagos, deudas ni inventario directamente (esas colecciones no aceptan escrituras por la API).
// Documentación de entradas/salidas: docs/pulpos-sales-api.md



routerAdd('POST', '/api/tpv/orders', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders.js`).createOrder($app, e.auth, e.requestInfo().body || {}));
}, $apis.requireAuth('users'));

routerAdd('GET', '/api/tpv/orders/{id}', (e) => {
  const O = require(`${__hooks}/lib/orders.js`);
  const U = require(`${__hooks}/lib/util.js`);
  const ctx = U.userCtx($app, e.auth);
  U.need(ctx, 'order.read');
  const order = O.must($app, 'orders', e.request.pathValue('id'), 'La venta');
  if (order.getString('deleted_at') || !ctx.canUseLocation(order.getString('location'))) throw new NotFoundError('La venta no existe');
  return e.json(200, O.serialize($app, order, ctx));
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tpv/orders/{id}/payments', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).addPayments($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {}));
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tpv/orders/{id}/deliver', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).deliver($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {}));
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tpv/orders/{id}/debt-payments', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).payDebt($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {}));
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tpv/debt-payments', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).payOrdersDebt($app, e.auth, e.requestInfo().body || {}));
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tpv/orders/{id}/refund', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).refund($app, e.auth, e.request.pathValue('id'), e.requestInfo().body || {}));
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tpv/orders/{id}/cancel', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).cancel($app, e.auth, e.request.pathValue('id')));
}, $apis.requireAuth('users'));

routerAdd('DELETE', '/api/tpv/orders/{id}', (e) => {
  return e.json(200, require(`${__hooks}/lib/orders_ops.js`).remove($app, e.auth, e.request.pathValue('id')));
}, $apis.requireAuth('users'));
