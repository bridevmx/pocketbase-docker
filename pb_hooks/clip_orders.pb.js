/// <reference path="../pb_data/types.d.ts" />

// Pedidos de la tienda en línea pagados con Clip (ver lib/clip_pay.js y el plugin clip-payment-links).
// Reintento de pago: devuelve el link vigente o crea uno nuevo. El folio corto del pedido hace de "clave".
routerAdd('POST', '/api/shop/orders/{friendly_id}/pay', (e) => {
  const U = require(`${__hooks}/lib/util.js`);
  const CP = require(`${__hooks}/lib/clip_pay.js`);
  const o = U.first($app, 'orders', 'friendly_id = {:f} && origin = "online_catalog" && way_of_payment = "clip" && deleted_at = ""', { f: String(e.request.pathValue('friendly_id')).toUpperCase() });
  if (!o) throw U.fail(404, 'Pedido no encontrado', 'not_found');
  if (o.getString('payment_status') !== 'pending') throw U.fail(409, 'El pedido no tiene pago pendiente', 'order_payment_not_pending');
  const r = CP.ensureLink($app, o.id);
  if (!r.url) throw U.fail(503, 'No se pudo generar el link de pago', r.error || 'clip_unavailable');
  return e.json(200, { friendly_id: o.getString('friendly_id'), payment_url: r.url, payment_qr_url: r.qr_url || '' });
});

// Cancela los pedidos de Clip que nunca se pagaron (el link dura 72 h)
cronAdd('clipOrdersExpire', '17 * * * *', () => {
  require(`${__hooks}/lib/clip_pay.js`).expireUnpaid($app, 73);
});
