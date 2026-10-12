// Cobro de pedidos de la tienda en línea con Clip (Checkout Redireccionado), sobre el plugin clip-payment-links.
// El plugin crea el link y confirma el pago contra la API de Clip; aquí solo se ata un link a un pedido y se
// registra el cobro cuando el plugin avisa (onPaid). Las credenciales son variables de entorno de la instancia.
const U = require(`${__hooks}/lib/util.js`);
const L = require(`${__hooks}/lib/loyalty.js`);
const PL = `${__hooks}/clip-payment-links`;

const MIN_AMOUNT = 1; // Clip no cobra menos de $1.00

function service() { return require(`${PL}/lib/service.js`); }
function collectionName() { return require(`${PL}/lib/util.js`).loadConfig().collection; }

// ¿Esta instancia tiene Clip configurado? (token, secreto del webhook y URL pública)
function configured() {
  try { return service().configProblems().length === 0; } catch (_) { return false; }
}

// Link vigente (pendiente) de un pedido, o null
function pendingLink(app, orderId) {
  try {
    const rows = app.findRecordsByFilter(collectionName(), 'status = "pending" && provider_id != "" && metadata.order = {:o}', '-created', 1, 0, { o: orderId });
    return rows.length ? rows[0] : null;
  } catch (_) { return null; }
}

// Crea (o reutiliza) el link de pago de un pedido pendiente. Nunca lanza: si Clip falla devuelve { error }.
function ensureLink(app, orderId) {
  const order = app.findRecordById('orders', orderId);
  if (order.getString('way_of_payment') !== 'clip' || order.getString('payment_status') !== 'pending') return { url: '' };
  const prev = pendingLink(app, order.id);
  if (prev) return { url: prev.getString('url'), qr_url: prev.getString('qr_url') };
  if (!configured()) return { url: '', error: 'clip_not_configured' };
  const total = order.getFloat('total');
  if (total < MIN_AMOUNT) return { url: '', error: 'clip_min_amount' };
  try {
    const link = service().createLink({ amount: total, description: `Pedido ${order.getString('friendly_id')}`, metadata: { order: order.id, friendly_id: order.getString('friendly_id') } }, { auth: null });
    return { url: link.url, qr_url: link.qrUrl };
  } catch (err) {
    console.log(`[clip] no se pudo crear el link del pedido ${order.id}: ${err}`);
    return { url: '', error: 'clip_unavailable' };
  }
}

function meta(record) {
  try { return JSON.parse(record.getString('metadata') || '{}'); } catch (_) { return {}; }
}

// El plugin confirmó el pago (una sola vez): registra el cobro y cierra el pago del pedido.
function onPaid(record) {
  const orderId = String(meta(record).order || '');
  if (!orderId) return;
  $app.runInTransaction((tx) => {
    const order = tx.findRecordById('orders', orderId);
    const paid = U.r2(record.getInt('amount_cents') / 100);
    const note = `Clip recibo ${record.getString('receipt_no')} · $${paid}`;
    if (order.getString('payment_status') !== 'pending') {
      // p. ej. el pedido se canceló mientras el cliente pagaba: el dinero ya entró, requiere atención humana
      U.create(tx, 'order_events', { order: order.id, type: 'comment', content: `ATENCIÓN: pago de Clip sobre un pedido ${order.getString('payment_status')}. ${note}`, location: order.getString('location') });
      return;
    }
    const pct = order.getFloat('loyalty_reward_percentage');
    const reward = pct > 0 ? U.r2(paid * pct / 100) : 0;
    U.create(tx, 'order_payments', { order: order.id, method: 'card', total: paid, change: 0, made_at: U.nowStr(), loyalty_points_reward: reward });
    order.set('payment_status', 'completed');
    tx.save(order);
    U.create(tx, 'order_events', { order: order.id, type: 'online_payment', content: note, location: order.getString('location') });
    const client = tx.findRecordById('clients', order.getString('client'));
    if (reward > 0 && client.getString('type') === 'account_client') L.addPoints(tx, client, reward, 'order_payment_earn', order.id, '');
  });
}

// El link falló o venció. No se cancela el pedido aquí: el cliente puede pedir otro link; el barrido lo cancela.
function onFailed(record) {
  const orderId = String(meta(record).order || '');
  if (!orderId) return;
  try {
    const order = $app.findRecordById('orders', orderId);
    U.create($app, 'order_events', { order: order.id, type: 'comment', content: `Link de Clip sin pago: ${record.getString('error') || record.getString('provider_status')}`, location: order.getString('location') });
  } catch (_) {}
}

// Barrido: cancela los pedidos de Clip sin pago ni link vigente tras `hours` (libera lo comprometido)
function expireUnpaid(app, hours) {
  const cutoff = U.nowStr(new Date(Date.now() - hours * 3600000));
  let rows = [];
  try { rows = app.findRecordsByFilter('orders', 'origin = "online_catalog" && way_of_payment = "clip" && payment_status = "pending" && made_at < {:c} && deleted_at = ""', 'made_at', 100, 0, { c: cutoff }); } catch (_) {}
  for (const o of rows) {
    if (pendingLink(app, o.id)) continue;
    app.runInTransaction((tx) => {
      const fresh = tx.findRecordById('orders', o.id);
      if (fresh.getString('payment_status') !== 'pending') return;
      fresh.set('payment_status', 'cancelled'); fresh.set('shipping_status', 'cancelled'); tx.save(fresh);
      U.create(tx, 'order_events', { order: fresh.id, type: 'cancel', content: 'Cancelado: pago con Clip no completado', location: fresh.getString('location') });
    });
  }
}

module.exports = { MIN_AMOUNT, configured, pendingLink, ensureLink, onPaid, onFailed, expireUnpaid };
