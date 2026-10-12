// Programa de lealtad: 1 punto = $1. Libro de movimientos + saldo en clients.loyalty_points.
const U = require(`${__hooks}/lib/util.js`);

function activeProgram(app) {
  return U.first(app, 'loyalty_programs', 'id != "" && deactivated_at = ""');
}

// ¿aplica a esta venta? (límites por lista de precios y sucursal)
function appliesTo(prog, priceListId, locationId) {
  const lists = prog.getStringSlice('price_lists'), locs = prog.getStringSlice('locations');
  if (lists.length && lists.indexOf(priceListId) === -1) return false;
  if (locs.length && locs.indexOf(locationId) === -1) return false;
  return true;
}

// Tasa (%) de una partida: producto específico → categoría → general
function rateFor(app, prog, product) {
  const byProduct = U.first(app, 'loyalty_product_rewards', 'program = {:g} && product = {:p}', { g: prog.id, p: product.id });
  if (byProduct) return byProduct.getFloat('reward_percentage');
  const cat = product.getString('category');
  if (cat) {
    const byCat = U.first(app, 'loyalty_category_rewards', 'program = {:g} && category = {:c}', { g: prog.id, c: cat });
    if (byCat) return byCat.getFloat('reward_percentage');
  }
  return prog.getFloat('reward_percentage');
}

// Cambia el saldo del cliente y deja el movimiento. Nunca deja saldo negativo.
function addPoints(app, client, delta, origin, orderId, userId, reason) {
  delta = U.r2(delta);
  if (!delta) return;
  const previous = client.getFloat('loyalty_points');
  const current = U.r2(Math.max(previous + delta, 0));
  client.set('loyalty_points', current);
  app.save(client);
  U.create(app, 'loyalty_movements', { client: client.id, previous_quantity: previous, current_quantity: current, origin, order: orderId || '', adjustment_reason: reason || '', created_by: userId || '' });
}

module.exports = { activeProgram, appliesTo, rateFor, addPoints };
