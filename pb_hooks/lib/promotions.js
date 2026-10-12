// Motor de promociones (servidor). Opera sobre las partidas ya calculadas:
//   línea = { product, qty, price, gross, disc, discAmount, total }
// Las promociones por partida llenan `disc` (type fixed + promotion); las de carrito devuelven descuentos de carrito.
// Una partida con descuento manual no recibe promociones por partida. No se acumulan promociones sobre la misma
// partida: gana la que más descuenta. De carrito se aplica la mejor automática más las manuales elegidas.
const U = require(`${__hooks}/lib/util.js`);

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MULTI = { two_for_one: [2, 1, 100], three_for_two: [3, 1, 100], second_fifty_percent: [2, 1, 50], third_fifty_percent: [3, 1, 50] };

function inList(rec, field, id) { const l = rec.getStringSlice(field); return !l.length || l.indexOf(id) !== -1; }

function utcOffset(app) {
  const b = U.first(app, 'business', 'id != ""');
  return b ? b.getInt('utc_offset_minutes') : 0;
}

// ¿Aplica la promoción en este contexto? ctx = { client, listId, locationId, now }
function eligible(app, promo, cx) {
  if (promo.getString('deleted_at') || promo.getString('ended_at')) return false;
  const now = cx.now.getTime();
  const from = promo.getString('valid_from'), until = promo.getString('valid_until');
  if (from && new Date(from.replace(' ', 'T')).getTime() > now) return false;
  if (until && new Date(until.replace(' ', 'T')).getTime() < now) return false;
  if (!inList(promo, 'price_lists', cx.listId) || !inList(promo, 'locations', cx.locationId)) return false;
  const days = U.all(app, 'promotion_days', 'promotion = {:p}', { p: promo.id }).map((d) => d.getString('weekday'));
  if (days.length) {
    const local = new Date(now + cx.offset * 60000);
    if (days.indexOf(DAYS[local.getUTCDay()]) === -1) return false;
  }
  const r = promo.getString('restrict_to_clients');
  if (r === 'registered_clients') return !!cx.client && cx.client.getString('type') === 'account_client';
  if (r === 'clients_list') return !!cx.client && !!U.first(app, 'promotion_clients', 'promotion = {:p} && client = {:c}', { p: promo.id, c: cx.client.id });
  return true;
}

function matcher(app, promo, role) {
  const ts = U.all(app, 'promotion_targets', 'promotion = {:p} && role = {:r}', { p: promo.id, r: role });
  return (line) => ts.some((t) => (t.getString('product') && t.getString('product') === line.product.id) || (t.getString('category') && t.getString('category') === line.product.getString('category')));
}

// Reparte `count` unidades de descuento entre las líneas más baratas primero. Devuelve {lineIndex: monto}
function cheapestUnits(lines, idxs, count, pct) {
  const units = [];
  for (const i of idxs) for (let k = 0; k < Math.floor(lines[i].qty); k++) units.push({ i, price: lines[i].price });
  units.sort((a, b) => a.price - b.price);
  const out = {};
  for (const u of units.slice(0, count)) out[u.i] = U.r2((out[u.i] || 0) + u.price * pct / 100);
  return out;
}

// Descuento por partida que daría la promoción: {lineIndex: monto}
function lineDiscounts(app, promo, lines) {
  const type = promo.getString('type'), out = {};
  const free = (i) => !lines[i].disc;
  if (type === 'single_target') {
    const m = matcher(app, promo, 'single'), amt = promo.getFloat('amount'), pct = promo.getString('amount_type') === 'percentage';
    if (!(amt > 0)) return out;
    lines.forEach((l, i) => {
      if (!free(i) || !m(l)) return;
      const d = pct ? U.r2(l.gross * amt / 100) : U.r2(Math.min(amt * l.qty, l.gross));
      if (d > 0 && d < l.gross + 0.001) out[i] = d;
    });
  } else if (type === 'multi_target') {
    const kind = promo.getString('multi_target_type');
    const [trig, disc, pct] = MULTI[kind] || [promo.getInt('trigger_quantity'), promo.getInt('discounted_quantity'), promo.getFloat('discounted_percentage')];
    if (!(trig > 0) || !(disc > 0) || !(pct > 0)) return out;
    const m = matcher(app, promo, 'trigger'); const alt = matcher(app, promo, 'single');
    const idxs = [];
    lines.forEach((l, i) => { if (free(i) && (m(l) || alt(l))) idxs.push(i); });
    const units = idxs.reduce((s, i) => s + Math.floor(lines[i].qty), 0);
    const groups = Math.floor(units / trig);
    return groups > 0 ? cheapestUnits(lines, idxs, groups * disc, pct) : out;
  } else if (type === 'multi_target_advanced') {
    const mt = matcher(app, promo, 'trigger'), md = matcher(app, promo, 'discounted');
    const trig = promo.getInt('trigger_quantity'), disc = promo.getInt('discounted_quantity'), pct = promo.getFloat('discounted_percentage');
    if (!(trig > 0) || !(disc > 0) || !(pct > 0)) return out;
    const tIdx = [], dIdx = [];
    lines.forEach((l, i) => { if (mt(l)) tIdx.push(i); if (free(i) && md(l)) dIdx.push(i); });
    const groups = Math.floor(tIdx.reduce((s, i) => s + Math.floor(lines[i].qty), 0) / trig);
    return groups > 0 ? cheapestUnits(lines, dIdx, groups * disc, pct) : out;
  }
  return out;
}

// opts: { client, listId, locationId, manual: [promotionId], auto: bool }
// Modifica las líneas (disc/discAmount/total) y devuelve { cart: [descuentos de carrito], applied: [{promotion, name, amount}] }
function apply(app, lines, opts) {
  const cx = { client: opts.client, listId: opts.listId, locationId: opts.locationId, now: new Date(), offset: utcOffset(app) };
  const manual = opts.manual || [];
  const all = app.findRecordsByFilter('promotions', 'deleted_at = "" && ended_at = ""', '', 500, 0);
  const picked = all.filter((p) => (p.getString('application') === 'automatic' ? opts.auto !== false : manual.indexOf(p.id) !== -1) && eligible(app, p, cx));
  for (const id of manual) if (!picked.some((p) => p.id === id)) throw U.fail(422, 'La promoción no aplica a esta venta', 'promotion_not_applicable');

  const applied = [];
  // por partida: la mejor promoción de cada línea
  const best = {};
  for (const p of picked.filter((x) => x.getString('type') !== 'cart_total')) {
    const d = lineDiscounts(app, p, lines);
    let used = false;
    for (const k of Object.keys(d)) if (d[k] > 0 && (!best[k] || d[k] > best[k].amount)) { best[k] = { amount: d[k], promo: p }; used = true; }
    if (!used && manual.indexOf(p.id) !== -1) throw U.fail(422, `La promoción ${p.getString('name')} no aplica a esta venta`, 'promotion_not_applicable');
  }
  const perPromo = {};
  for (const k of Object.keys(best)) {
    const l = lines[k], b = best[k], amt = Math.min(b.amount, l.gross);
    l.disc = { type: 'fixed', value: amt, title: b.promo.getString('name'), promotion: b.promo.id };
    l.discAmount = amt; l.total = U.r2(l.gross - amt);
    perPromo[b.promo.id] = { promotion: b.promo.id, name: b.promo.getString('name'), amount: U.r2(((perPromo[b.promo.id] || {}).amount || 0) + amt) };
  }
  Object.keys(perPromo).forEach((k) => applied.push(perPromo[k]));

  // de carrito
  const base = U.r2(lines.reduce((s, l) => s + l.total, 0));
  const carts = [];
  for (const p of picked.filter((x) => x.getString('type') === 'cart_total')) {
    const amt = p.getFloat('amount');
    if (!(amt > 0) || base < p.getFloat('min_cart_subtotal')) { if (manual.indexOf(p.id) !== -1) throw U.fail(422, `La promoción ${p.getString('name')} no aplica a esta venta`, 'promotion_not_applicable'); continue; }
    const d = p.getString('amount_type') === 'percentage' ? U.r2(base * amt / 100) : U.r2(amt);
    if (d <= 0 || d >= base) continue;
    carts.push({ promo: p, amount: d, manual: manual.indexOf(p.id) !== -1 });
  }
  const out = [];
  const autoBest = carts.filter((c) => !c.manual).sort((a, b) => b.amount - a.amount)[0];
  for (const c of carts.filter((x) => x.manual).concat(autoBest ? [autoBest] : [])) {
    out.push({ type: 'fixed', amount: c.amount, title: c.promo.getString('name'), promotion: c.promo.id, loyalty_points_used: 0 });
    applied.push({ promotion: c.promo.id, name: c.promo.getString('name'), amount: c.amount });
  }
  return { cart: out, applied };
}

module.exports = { apply };
