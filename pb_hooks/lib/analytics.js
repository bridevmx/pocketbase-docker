// Analítica: agregaciones en el servidor (SQL). Solo lectura. Las fechas son locales del negocio:
// from/to = AAAA-MM-DD (to incluyente) y tz_offset = minutos respecto a UTC (México centro = -360).
const U = require(`${__hooks}/lib/util.js`);

const GROUPS_TIME = { day: 7, month: 10 };

function params(ctx, q, opts) {
  const biz = U.first($app, 'business', 'id != ""');
  const off = q.tz_offset === undefined || q.tz_offset === '' ? (biz ? biz.getInt('utc_offset_minutes') : 0) : parseInt(q.tz_offset);
  if (!isFinite(off) || Math.abs(off) > 840) throw U.fail(400, 'tz_offset inválido', 'invalid_tz_offset');
  const day = (v, def) => {
    const s = String(v || def || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z').getTime())) throw U.fail(400, 'Fecha inválida (AAAA-MM-DD)', 'invalid_date');
    return s;
  };
  const today = new Date(Date.now() + off * 60000).toISOString().substring(0, 10);
  const from = day(q.from, today.substring(0, 8) + '01'), to = day(q.to, today);
  if (to < from) throw U.fail(400, 'El rango de fechas es inválido', 'invalid_date');
  const span = (new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000;
  if (span > 800) throw U.fail(400, 'El rango máximo es de ~2 años', 'range_too_large');
  const utc = (d, add) => U.nowStr(new Date(new Date(d + 'T00:00:00Z').getTime() + (add || 0) * 86400000 - off * 60000));
  // sucursales permitidas: las del usuario (admin: todas) o la pedida
  let locs = null;
  if (q.location) {
    if (!/^[a-z0-9]+$/i.test(q.location)) throw U.fail(400, 'Sucursal inválida', 'invalid_location');
    if (!ctx.canUseLocation(q.location)) throw U.fail(403, 'No tienes acceso a esa sucursal', 'location_forbidden');
    locs = [q.location];
  } else if (!ctx.isAdmin) locs = ctx.user.getStringSlice('locations');
  const inList = (col) => (locs === null ? '1=1' : locs.length ? `${col} IN (${locs.map((l) => `'${String(l).replace(/[^a-z0-9]/gi, '')}'`).join(',')})` : '1=0');
  return { from, to, off, start: utc(from), end: utc(to, 1), locs, inList, shift: `${off >= 0 ? '+' : '-'}${Math.abs(off)} minutes` };
}

// Cubeta de tiempo en hora local
function bucket(col, p, group) {
  const local = `datetime(substr(${col},1,19), '${p.shift}')`;
  if (group === 'month') return `substr(${local},1,7)`;
  if (group === 'week') return `strftime('%Y-W%W', ${local})`;
  return `substr(${local},1,10)`;
}

const rows = (app, sql, bind, shape) => {
  const out = arrayOf(new DynamicModel(shape));
  app.db().newQuery(sql).bind(bind).all(out);
  return out;
};
const one = (app, sql, bind, shape) => {
  const m = new DynamicModel(shape);
  app.db().newQuery(sql).bind(bind).one(m);
  return m;
};
const r2 = U.r2;

// ═════════ VENTAS ═════════
// group: day | week | month | product | category | client | seller | payment_method | location
function sales(app, user, q) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'report.view_sales_reports', 'No tienes permiso para ver reportes de ventas');
  const p = params(ctx, q);
  const group = String(q.group || 'day');
  const canCost = ctx.has('product.read_cost');
  const statusSql = q.payment_status === 'completed' ? "AND o.payment_status = 'completed'" : q.payment_status === 'pending' ? "AND o.payment_status = 'pending'" : '';
  const base = `o.deleted_at = '' AND o.payment_status != 'cancelled' ${statusSql} AND o.made_at >= {:s} AND o.made_at < {:e} AND ${p.inList('o.location')}`;
  const bind = { s: p.start, e: p.end };
  let list;
  const shape = { key: '', label: '', orders: 0, quantity: 0.5, gross: 0.5, discounts: 0.5, total: 0.5, cost: 0.5 };

  if (GROUPS_TIME[group] || group === 'week') {
    const b = bucket('o.made_at', p, group);
    list = rows(app, `SELECT ${b} AS key, ${b} AS label, COUNT(*) AS orders, 0.5 AS quantity, COALESCE(SUM(o.subtotal),0) AS gross,
      COALESCE(SUM(o.subtotal - o.original_total + o.discounts),0) AS discounts, COALESCE(SUM(o.total - o.delivery_cost),0) AS total,
      COALESCE(SUM((SELECT SUM(c.total_cost) FROM order_item_costs c JOIN order_items i ON i.id = c.order_item WHERE i."order" = o.id)),0) AS cost
      FROM orders o WHERE ${base} GROUP BY 1 ORDER BY 1`, bind, shape);
  } else if (group === 'payment_method') {
    list = rows(app, `SELECT op.method AS key, op.method AS label, COUNT(DISTINCT o.id) AS orders, 0.5 AS quantity, 0.5 AS gross, 0.5 AS discounts, COALESCE(SUM(op.total - op.change),0) AS total, 0.5 AS cost
      FROM order_payments op JOIN orders o ON o.id = op."order"
      WHERE op.deleted_at = '' AND op.method != 'credit' AND o.deleted_at = '' AND o.payment_status != 'cancelled' AND op.made_at >= {:s} AND op.made_at < {:e} AND ${p.inList('o.location')}
      GROUP BY op.method ORDER BY total DESC`, bind, shape);
  } else {
    const keys = {
      product: { key: "COALESCE(oi.product,'')", label: 'MAX(oi.name)', join: '' },
      category: { key: "COALESCE(pr.category,'')", label: "COALESCE(MAX(pc.name),'Sin categoría')", join: "LEFT JOIN products pr ON pr.id = oi.product LEFT JOIN product_categories pc ON pc.id = pr.category" },
      client: { key: 'o.client', label: "COALESCE(MAX(cl.name),'')", join: 'LEFT JOIN clients cl ON cl.id = o.client' },
      seller: { key: "COALESCE(o.seller,'')", label: "COALESCE(MAX(se.name),'Sin vendedor')", join: 'LEFT JOIN sellers se ON se.id = o.seller' },
      location: { key: 'o.location', label: "COALESCE(MAX(lo.name),'')", join: 'LEFT JOIN locations lo ON lo.id = o.location' },
    };
    const k = keys[group];
    if (!k) throw U.fail(400, 'group inválido', 'invalid_group');
    // el descuento de carrito se reparte entre las partidas en proporción; los hijos de combo no suman (total 0)
    list = rows(app, `SELECT ${k.key} AS key, ${k.label} AS label, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.quantity),0) AS quantity,
      COALESCE(SUM(oi.quantity * oi.unit_price),0) AS gross,
      COALESCE(SUM(oi.quantity * oi.unit_price - oi.total * (o.original_total - o.discounts) * 1.0 / NULLIF(o.original_total,0)),0) AS discounts,
      COALESCE(SUM(oi.total * (o.original_total - o.discounts) * 1.0 / NULLIF(o.original_total,0)),0) AS total,
      COALESCE(SUM(oic.total_cost),0) AS cost
      FROM order_items oi JOIN orders o ON o.id = oi."order" ${k.join} LEFT JOIN order_item_costs oic ON oic.order_item = oi.id
      WHERE ${base} AND oi.combo_parent = '' GROUP BY 1 ORDER BY total DESC LIMIT 500`, bind, shape);
  }

  const out = list.map((r) => {
    const o = { key: r.key, label: r.label, orders: r.orders, total: r2(r.total) };
    if (group !== 'payment_method') {
      o.gross = r2(r.gross); o.discounts = r2(r.discounts);
      if (group === 'product' || group === 'category') o.quantity = U.r4(r.quantity);
      if (canCost) { o.cost = r2(r.cost); o.margin = r2(r.total - r.cost); o.margin_percentage = r.total > 0 ? r2((r.total - r.cost) / r.total * 100) : 0; }
    }
    return o;
  });
  // totales del periodo (siempre por venta, para que cuadren con "day")
  const t = one(app, `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS total, COALESCE(SUM(o.delivery_cost),0) AS delivery FROM orders o WHERE ${base}`, bind, { orders: 0, total: 0.5, delivery: 0.5 });
  const rf = one(app, `SELECT COALESCE(SUM(r.total_refunded),0) AS q FROM order_refunds r JOIN orders o ON o.id = r."order" WHERE o.deleted_at = '' AND r.created >= {:s} AND r.created < {:e} AND ${p.inList('o.location')}`, bind, { q: 0.5 });
  return {
    from: p.from, to: p.to, group, items: out,
    totals: { orders: t.orders, total: r2(t.total), delivery: r2(t.delivery), refunds: r2(rf.q), net_total: r2(t.total - rf.q), average_ticket: t.orders ? r2(t.total / t.orders) : 0 },
  };
}

// ═════════ INVENTARIO ═════════
// query: location, low=true (solo bajo mínimo), limit
function inventory(app, user, q) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'report.view_inventory_reports', 'No tienes permiso para ver reportes de inventario');
  const p = params(ctx, q);
  const canCost = ctx.has('product.read_cost');
  const list = rows(app, `SELECT p.id AS id, p.name AS name, p.sku AS sku, COALESCE(c.cost,0) AS cost,
      (SELECT COALESCE(SUM(ps.quantity),0) FROM product_stocks ps WHERE ps.product = p.id AND ${p.inList('ps.location')})
      + (SELECT COALESCE(SUM(bs.quantity),0) FROM batch_stocks bs JOIN batches b ON b.id = bs.batch WHERE b.product = p.id AND ${p.inList('bs.location')}) AS quantity,
      (SELECT COALESCE(SUM(ps.min_quantity),0) FROM product_stocks ps WHERE ps.product = p.id AND ${p.inList('ps.location')}) AS min_quantity
    FROM products p LEFT JOIN product_costs c ON c.product = p.id
    WHERE p.deleted_at = '' AND p.type = 'product' AND p.is_stockable = 1 AND p.is_variant_group = 0 ORDER BY p.name LIMIT 5000`, {}, { id: '', name: '', sku: '', cost: 0.5, quantity: 0.5, min_quantity: 0.5 });
  let items = list.map((r) => {
    const o = { id: r.id, name: r.name, sku: r.sku, quantity: U.r4(r.quantity), min_quantity: U.r4(r.min_quantity), below_minimum: r.min_quantity > 0 && r.quantity <= r.min_quantity };
    if (canCost) { o.cost = U.r4(r.cost); o.value = r2(Math.max(0, r.quantity) * r.cost); }
    return o;
  });
  const totals = { products: items.length, units: U.r4(items.reduce((s, i) => s + Math.max(0, i.quantity), 0)), out_of_stock: items.filter((i) => i.quantity <= 0).length, below_minimum: items.filter((i) => i.below_minimum).length };
  if (canCost) totals.value = r2(items.reduce((s, i) => s + i.value, 0));
  if (String(q.low) === 'true') items = items.filter((i) => i.below_minimum || i.quantity <= 0);
  return { items: items.slice(0, Math.min(parseInt(q.limit) || 1000, 5000)), totals };
}

// ═════════ COMPRAS Y GASTOS ═════════
// kind: purchases | expenses; group: day | week | month | provider | product (solo compras)
function outlays(app, user, kind, q) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'report.view_purchases_reports', 'No tienes permiso para ver reportes de compras');
  const p = params(ctx, q);
  const group = String(q.group || 'month');
  const t = kind === 'purchases' ? 'purchases' : 'expenses';
  const debts = kind === 'purchases' ? 'purchase_debts' : 'expense_debts';
  const fk = kind === 'purchases' ? 'purchase' : 'expense';
  const bind = { s: p.start, e: p.end };
  const where = `x.deleted_at = '' ${kind === 'purchases' ? "AND x.status = 'completed'" : ''} AND x.made_at >= {:s} AND x.made_at < {:e} AND ${p.inList('x.location')}`;
  const shape = { key: '', label: '', count: 0, total: 0.5, debt: 0.5, quantity: 0.5 };
  let list;
  if (group === 'product') {
    if (kind !== 'purchases') throw U.fail(400, 'group inválido', 'invalid_group');
    list = rows(app, `SELECT i.product AS key, MAX(pr.name) AS label, COUNT(DISTINCT x.id) AS count, COALESCE(SUM(i.total),0) AS total, 0.5 AS debt, COALESCE(SUM(i.quantity),0) AS quantity
      FROM purchase_items i JOIN purchases x ON x.id = i.purchase JOIN products pr ON pr.id = i.product WHERE ${where} GROUP BY i.product ORDER BY total DESC LIMIT 500`, bind, shape);
  } else {
    let key, label, join = '';
    if (group === 'provider') { key = "COALESCE(x.provider,'')"; label = "COALESCE(MAX(pv.name),'Sin proveedor')"; join = 'LEFT JOIN providers pv ON pv.id = x.provider'; }
    else if (group === 'concept' && kind === 'expenses') { key = 'x.concept'; label = 'x.concept'; }
    else if (GROUPS_TIME[group] || group === 'week') { key = label = bucket('x.made_at', p, group); }
    else throw U.fail(400, 'group inválido', 'invalid_group');
    list = rows(app, `SELECT ${key} AS key, ${label} AS label, COUNT(*) AS count, COALESCE(SUM(x.total),0) AS total, COALESCE(SUM(d.current_debt),0) AS debt, 0.5 AS quantity
      FROM ${t} x LEFT JOIN ${debts} d ON d.${fk} = x.id ${join} WHERE ${where} GROUP BY 1 ORDER BY ${GROUPS_TIME[group] || group === 'week' ? '1' : 'total DESC'} LIMIT 500`, bind, shape);
  }
  const items = list.map((r) => { const o = { key: r.key, label: r.label, count: r.count, total: r2(r.total) }; if (group === 'product') o.quantity = U.r4(r.quantity); else o.outstanding_debt = r2(r.debt); return o; });
  return { from: p.from, to: p.to, kind, group, items, totals: { count: items.reduce((s, i) => s + i.count, 0), total: r2(items.reduce((s, i) => s + i.total, 0)) } };
}

// ═════════ FINANZAS: por cobrar, por pagar y lo cobrado ═════════
function finance(app, user, q) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'report.view_finance_reports', 'No tienes permiso para ver reportes financieros');
  const p = params(ctx, q);
  const today = new Date(Date.now() + p.off * 60000).toISOString().substring(0, 10);
  const bind = { t: today };
  const recv = one(app, `SELECT COALESCE(SUM(d.current_debt),0) AS total, COALESCE(SUM(CASE WHEN d.due_date != '' AND substr(d.due_date,1,10) < {:t} THEN d.current_debt ELSE 0 END),0) AS overdue, COUNT(DISTINCT o.client) AS clients
    FROM order_debts d JOIN orders o ON o.id = d."order" WHERE d.current_debt > 0 AND o.deleted_at = '' AND ${p.inList('o.location')}`, bind, { total: 0.5, overdue: 0.5, clients: 0 });
  const top = rows(app, `SELECT o.client AS key, COALESCE(MAX(c.name),'') AS label, COALESCE(SUM(d.current_debt),0) AS total, 0 AS count, 0.5 AS debt, 0.5 AS quantity
    FROM order_debts d JOIN orders o ON o.id = d."order" LEFT JOIN clients c ON c.id = o.client WHERE d.current_debt > 0 AND o.deleted_at = '' AND ${p.inList('o.location')}
    GROUP BY o.client ORDER BY total DESC LIMIT 10`, {}, { key: '', label: '', total: 0.5, count: 0, debt: 0.5, quantity: 0.5 });
  const pay = (debts, t, fk, extra) => one(app, `SELECT COALESCE(SUM(d.current_debt),0) AS total, COALESCE(SUM(CASE WHEN d.due_date != '' AND substr(d.due_date,1,10) < {:t} THEN d.current_debt ELSE 0 END),0) AS overdue
    FROM ${debts} d JOIN ${t} x ON x.id = d.${fk} WHERE d.current_debt > 0 AND x.deleted_at = '' ${extra} AND ${p.inList('x.location')}`, bind, { total: 0.5, overdue: 0.5 });
  const pp = pay('purchase_debts', 'purchases', 'purchase', "AND x.status = 'completed'"), ep = pay('expense_debts', 'expenses', 'expense', '');
  const collected = sales(app, user, Object.assign({}, q, { group: 'payment_method' }));
  return {
    as_of: today,
    receivable: { total: r2(recv.total), overdue: r2(recv.overdue), clients: recv.clients, top_debtors: top.map((r) => ({ client: r.key, name: r.label, debt: r2(r.total) })) },
    payable: { purchases: { total: r2(pp.total), overdue: r2(pp.overdue) }, expenses: { total: r2(ep.total), overdue: r2(ep.overdue) }, total: r2(pp.total + ep.total) },
    collected: { from: p.from, to: p.to, by_method: collected.items.map((i) => ({ method: i.key, total: i.total })), total: r2(collected.items.reduce((s, i) => s + i.total, 0)) },
  };
}

// ═════════ IMPUESTOS ═════════
// Impuesto incluido en las ventas del periodo (por impuesto/tasa), menos lo devuelto en reembolsos.
function taxes(app, user, q) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'report.view_finance_reports', 'No tienes permiso para ver reportes financieros');
  const p = params(ctx, q);
  const bind = { s: p.start, e: p.end };
  const f = '(o.original_total - o.discounts) * 1.0 / NULLIF(o.original_total,0)';
  const sold = rows(app, `SELECT ot.tax AS tax, ot.type AS type, ot.percentage AS percentage, ot.is_withheld AS withheld, COALESCE(SUM(ot.amount),0) AS amount, COALESCE(SUM(oi.total * ${f}),0) AS sales
    FROM order_item_taxes ot JOIN order_items oi ON oi.id = ot.order_item JOIN orders o ON o.id = oi."order"
    WHERE o.deleted_at = '' AND o.payment_status != 'cancelled' AND o.made_at >= {:s} AND o.made_at < {:e} AND ${p.inList('o.location')}
    GROUP BY ot.tax, ot.type, ot.percentage, ot.is_withheld`, bind, { tax: '', type: '', percentage: 0.5, withheld: false, amount: 0.5, sales: 0.5 });
  const back = rows(app, `SELECT ot.tax AS tax, ot.type AS type, ot.percentage AS percentage, ot.is_withheld AS withheld, COALESCE(SUM(ot.amount * rfi.quantity_refunded / NULLIF(oi.quantity,0)),0) AS amount, 0.5 AS sales
    FROM order_refund_items rfi JOIN order_refunds r ON r.id = rfi.refund JOIN order_items oi ON oi.id = rfi.order_item
    JOIN order_item_taxes ot ON ot.order_item = oi.id JOIN orders o ON o.id = oi."order"
    WHERE o.deleted_at = '' AND r.created >= {:s} AND r.created < {:e} AND ${p.inList('o.location')}
    GROUP BY ot.tax, ot.type, ot.percentage, ot.is_withheld`, bind, { tax: '', type: '', percentage: 0.5, withheld: false, amount: 0.5, sales: 0.5 });
  const refunded = {};
  for (const b of back) refunded[`${b.tax}|${b.percentage}`] = b.amount;
  const items = sold.map((r) => {
    const rf = refunded[`${r.tax}|${r.percentage}`] || 0;
    return { tax: r.tax, type: r.type, percentage: r.percentage, is_withheld: !!r.withheld, sales: r2(r.sales), amount: r2(r.amount), refunded: r2(rf), net_amount: r2(r.amount - rf) };
  });
  const collected = items.filter((i) => !i.is_withheld);
  return { from: p.from, to: p.to, items, totals: { collected: r2(collected.reduce((s, i) => s + i.net_amount, 0)), withheld: r2(items.filter((i) => i.is_withheld).reduce((s, i) => s + i.net_amount, 0)) } };
}

module.exports = { sales, inventory, outlays, finance, taxes };
