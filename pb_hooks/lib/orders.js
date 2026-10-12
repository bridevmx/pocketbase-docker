// Creación de ventas. TODO se calcula y valida aquí, en el servidor: el cliente solo manda
// producto, cantidad y (si tiene permiso) precio/descuentos; los totales, costos, impuestos,
// folios, inventario, deuda y puntos los decide el servidor.
const U = require(`${__hooks}/lib/util.js`);
const S = require(`${__hooks}/lib/stock.js`);
const L = require(`${__hooks}/lib/loyalty.js`);
const LIC = require(`${__hooks}/lib/license.js`);

const must = (app, col, id, label) => {
  try { return app.findRecordById(col, String(id)); } catch (_) { throw U.fail(404, `${label} no existe`, 'not_found'); }
};

// ───────── precio ─────────
function priceFor(app, product, listId, defaultListId, qty) {
  const tryList = (list) => {
    const r = U.first(app, 'product_prices', 'product = {:p} && price_list = {:l} && min_quantity <= {:q} && price > 0', { p: product.id, l: list, q: qty });
    // el breakpoint más alto que no rebase la cantidad
    if (!r) return null;
    const rows = app.findRecordsByFilter('product_prices', 'product = {:p} && price_list = {:l} && min_quantity <= {:q}', '-min_quantity', 1, 0, { p: product.id, l: list, q: qty });
    return { price: rows[0].getFloat('price'), breakpoint: rows[0].getFloat('min_quantity'), list };
  };
  return tryList(listId) || tryList(defaultListId);
}

function currentDebt(app, clientId) {
  const q = new DynamicModel({ q: 0.5 });
  app.db().newQuery('SELECT COALESCE(SUM(d.current_debt),0) AS q FROM order_debts d JOIN orders o ON o.id = d."order" WHERE o.client = {:c} AND o.deleted_at = \'\'').bind({ c: clientId }).one(q);
  return q.q;
}
function hasOverdueDebt(app, clientId) {
  const today = U.nowStr().substring(0, 10);
  const q = new DynamicModel({ n: 0 });
  app.db().newQuery('SELECT COUNT(*) AS n FROM order_debts d JOIN orders o ON o.id = d."order" WHERE o.client = {:c} AND o.deleted_at = \'\' AND d.current_debt > 0 AND d.due_date != \'\' AND substr(d.due_date,1,10) < {:t}').bind({ c: clientId, t: today }).one(q);
  return q.n > 0;
}
function debtLimitFor(client, st) {
  if (client.getBool('uses_default_debt_limit')) return st ? st.getFloat('default_client_debt_limit') : 0;
  return client.getFloat('debt_limit');
}

function parseDueDate(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw U.fail(400, 'debt_due_date debe ser AAAA-MM-DD', 'invalid_due_date');
  return s + ' 00:00:00.000Z';
}

// Valida los pagos recibidos. El pago `credit` no trae importe: lo decide el servidor (lo que falte).
function parsePayments(tx, rawPays) {
  rawPays = Array.isArray(rawPays) ? rawPays : [];
  const enabled = {};
  for (const m of U.all(tx, 'enabled_payment_methods', 'enabled = true')) enabled[m.getString('method')] = true;
  const pays = [];
  let paidNet = 0, credit = null;
  for (const p of rawPays) {
    const method = String(p.method || '');
    if (!enabled[method]) throw U.fail(400, `El método de pago ${method} no está habilitado`, 'payment_method_disabled');
    let custom = '';
    if (p.custom_payment_method) {
      const cpm = must(tx, 'custom_payment_methods', p.custom_payment_method, 'El método de pago');
      if (cpm.getString('method') !== method || cpm.getBool('hidden') || cpm.getString('deleted_at') || !cpm.getBool('allows_income')) throw U.fail(400, 'Método de pago personalizado inválido', 'invalid_payment_method');
      custom = cpm.id;
    }
    if (method === 'credit') {
      if (credit) throw U.fail(400, 'Solo puede haber un pago a crédito', 'duplicate_credit');
      credit = { method, custom };
      continue;
    }
    const t = Number(p.total), ch = Number(p.change || 0);
    if (!(t > 0) || U.hasMoreThan2Decimals(t) || ch < 0 || (ch > 0 && method !== 'cash') || ch > t) throw U.fail(400, 'Pago inválido', 'invalid_payment');
    pays.push({ method, custom, total: U.r2(t), change: U.r2(ch), net: U.r2(t - ch) });
    paidNet = U.r2(paidNet + (t - ch));
  }
  return { pays, credit, paidNet };
}

// ───────── serialización ─────────
function serialize(app, order, ctx) {
  const canCost = ctx ? ctx.has('product.read_cost') : false;
  const items = U.all(app, 'order_items', 'order = {:o}', { o: order.id }, 'created').map((it) => {
    const o = it.publicExport();
    o.taxes = U.all(app, 'order_item_taxes', 'order_item = {:i}', { i: it.id }).map((t) => t.publicExport());
    o.batches = U.all(app, 'order_item_batches', 'order_item = {:i}', { i: it.id }).map((b) => b.publicExport());
    const d = it.getString('discount');
    o.discount = d ? app.findRecordById('order_item_discounts', d).publicExport() : null;
    if (canCost) { const c = U.first(app, 'order_item_costs', 'order_item = {:i}', { i: it.id }); o.cost = c ? c.publicExport() : null; }
    return o;
  });
  const debt = U.first(app, 'order_debts', 'order = {:o}', { o: order.id });
  return {
    order: order.publicExport(),
    items,
    payments: U.all(app, 'order_payments', 'order = {:o} && deleted_at = ""', { o: order.id }, 'created').map((p) => p.publicExport()),
    cart_discounts: U.all(app, 'order_cart_discounts', 'order = {:o}', { o: order.id }).map((d) => d.publicExport()),
    debt: debt ? debt.publicExport() : null,
    events: U.all(app, 'order_events', 'order = {:o}', { o: order.id }, 'created').map((e) => e.publicExport()),
  };
}

// ───────── creación ─────────
function createOrder(app, user, body) {
  const ctx = U.userCtx(app, user);
  U.need(ctx, 'order.create', 'No tienes permiso para vender');
  LIC.assertWritable(app);

  const requestId = String(body.request_id || '').trim();
  if (!requestId || requestId.length > 60) throw U.fail(400, 'Falta request_id (UUID de la venta)', 'request_id_required');
  const existing = U.first(app, 'orders', 'request_id = {:r}', { r: requestId });
  if (existing) return Object.assign({ idempotent: true }, serialize(app, existing, ctx));

  let result;
  try {
    app.runInTransaction((tx) => { result = build(tx, ctx, body, requestId); });
  } catch (err) {
    // dos envíos simultáneos del mismo request_id: gana el primero, el segundo devuelve esa venta
    const again = U.first(app, 'orders', 'request_id = {:r}', { r: requestId });
    if (again) return Object.assign({ idempotent: true }, serialize(app, again, ctx));
    throw err;
  }
  return result;
}

function build(tx, ctx, body, requestId) {
  const user = ctx.user;
  const st = U.settings(tx);
  const warnings = [];
  const origin = body.origin === 'pos_save_as_order' ? 'pos_save_as_order' : 'pos';
  if (origin === 'pos_save_as_order') U.need(ctx, 'order.save_counter_order');

  // ── contexto: sucursal, caja, cliente, vendedor, lista de precios
  const location = must(tx, 'locations', body.location, 'La sucursal');
  if (location.getString('deleted_at') || location.getString('type') !== 'branch') throw U.fail(400, 'La venta debe hacerse en una sucursal', 'invalid_location');
  if (!ctx.canUseLocation(location.id)) throw U.fail(403, 'No tienes acceso a esa sucursal', 'location_forbidden');
  const cashier = must(tx, 'cashiers', body.cashier, 'La caja');
  if (cashier.getString('location') !== location.id || cashier.getString('deleted_at')) throw U.fail(400, 'La caja no pertenece a esa sucursal', 'invalid_cashier');
  if (!ctx.canUseCashier(cashier.id)) throw U.fail(403, 'No tienes acceso a esa caja', 'cashier_forbidden');

  const client = body.client ? must(tx, 'clients', body.client, 'El cliente') : U.first(tx, 'clients', 'type = "general_public"');
  if (!client || client.getString('deleted_at')) throw U.fail(400, 'Cliente inválido', 'invalid_client');
  const isAccountClient = client.getString('type') === 'account_client';

  let seller = null;
  if (body.seller) {
    U.need(ctx, 'order.assign_salesman');
    seller = must(tx, 'sellers', body.seller, 'El vendedor');
  }

  const defaultList = U.first(tx, 'price_lists', 'is_default = true && deleted_at = ""');
  const listId = body.price_list || client.getString('default_price_list') || location.getString('default_price_list') || (defaultList ? defaultList.id : '');
  if (!listId) throw U.fail(400, 'No hay lista de precios', 'no_price_list');
  must(tx, 'price_lists', listId, 'La lista de precios');
  if (!ctx.canUsePriceList(listId)) throw U.fail(403, 'No tienes acceso a esa lista de precios', 'price_list_forbidden');

  // ── partidas
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > 200) throw U.fail(400, 'La venta necesita entre 1 y 200 partidas', 'invalid_items');
  const allowPersonalized = st && st.getBool('allow_personalized_prices');
  const lines = [];
  for (const it of rawItems) {
    const product = must(tx, 'products', it.product, 'El producto');
    const name = product.getString('name');
    if (product.getString('deleted_at') || !product.getBool('is_sellable') || product.getBool('is_variant_group')) throw U.fail(400, `${name} no se puede vender`, 'product_not_sellable');
    const qty = Number(it.quantity);
    if (!(qty > 0) || U.r4(qty) !== qty) throw U.fail(400, `Cantidad inválida de ${name}`, 'invalid_quantity');

    let price, breakpoint = 0, priceType = 'default', plist = listId;
    const priced = priceFor(tx, product, listId, defaultList ? defaultList.id : '', qty);
    if (it.unit_price !== undefined && it.unit_price !== null && (!priced || Number(it.unit_price) !== priced.price)) {
      U.need(ctx, 'order.apply_personalized_price', 'No puedes cambiar precios');
      if (!allowPersonalized) throw U.fail(403, 'Los precios personalizados están desactivados', 'personalized_prices_disabled');
      price = Number(it.unit_price);
      priceType = 'personalized';
    } else {
      if (!priced) throw U.fail(400, `${name} no tiene precio en la lista`, 'no_price');
      price = priced.price; breakpoint = priced.breakpoint; plist = priced.list;
    }
    if (!(price > 0) || U.hasMoreThan2Decimals(price)) throw U.fail(400, `Precio inválido de ${name}`, 'invalid_price');

    const gross = U.r2(qty * price);
    let disc = null, discAmount = 0;
    if (it.discount) {
      U.need(ctx, 'order.admin_discount', 'No puedes aplicar descuentos');
      const type = it.discount.type, value = Number(it.discount.value);
      if (['percentage', 'fixed'].indexOf(type) === -1 || !(value > 0)) throw U.fail(400, 'Descuento inválido', 'invalid_discount');
      discAmount = type === 'percentage' ? U.r2(gross * value / 100) : U.r2(value);
      if ((type === 'percentage' && value > 100) || discAmount > gross) throw U.fail(400, 'El descuento excede el importe', 'invalid_discount');
      disc = { type, value, title: it.discount.title || '', promotion: it.discount.promotion || '' };
    }
    const costRec = U.first(tx, 'product_costs', 'product = {:p}', { p: product.id });
    const line = {
      product, name, qty, price, breakpoint, priceType, priceList: plist, gross, disc, discAmount,
      total: U.r2(gross - discAmount), unitCost: costRec ? costRec.getFloat('cost') : 0, batches: it.batches, children: [],
    };
    if (product.getString('type') === 'combo') {
      const cis = U.all(tx, 'combo_items', 'combo = {:c}', { c: product.id });
      if (!cis.length) throw U.fail(400, `El combo ${name} no tiene componentes`, 'empty_combo');
      for (const ci of cis) {
        const child = must(tx, 'products', ci.getString('item'), 'El componente');
        line.children.push({ product: child, name: child.getString('name'), qty: U.r4(qty * ci.getFloat('quantity')) });
      }
    }
    lines.push(line);
  }

  // ── totales (el cliente no los manda; los calcula el servidor)
  const subtotal = U.r2(lines.reduce((s, l) => s + l.gross, 0));
  const itemDiscounts = U.r2(lines.reduce((s, l) => s + l.discAmount, 0));
  const base = U.r2(subtotal - itemDiscounts);

  const cartDiscounts = [];
  let loyaltyUsed = 0;
  for (const d of Array.isArray(body.cart_discounts) ? body.cart_discounts : []) {
    const used = Number(d.loyalty_points_used || 0);
    if (used > 0) { // canje de puntos = descuento fijo 1 punto = $1
      if (!isAccountClient) throw U.fail(400, 'Solo clientes registrados canjean puntos', 'loyalty_requires_client');
      if (!L.activeProgram(tx)) throw U.fail(400, 'El programa de lealtad no está activo', 'loyalty_inactive');
      loyaltyUsed = U.r2(loyaltyUsed + used);
      cartDiscounts.push({ type: 'fixed', amount: U.r2(used), title: d.title || 'Canje de puntos', promotion: '', loyalty_points_used: U.r2(used) });
      continue;
    }
    U.need(ctx, 'order.admin_discount', 'No puedes aplicar descuentos');
    const value = Number(d.value !== undefined ? d.value : d.amount);
    if (['percentage', 'fixed'].indexOf(d.type) === -1 || !(value > 0) || (d.type === 'percentage' && value > 100)) throw U.fail(400, 'Descuento de carrito inválido', 'invalid_discount');
    cartDiscounts.push({ type: d.type, amount: d.type === 'percentage' ? U.r2(base * value / 100) : U.r2(value), title: d.title || '', promotion: d.promotion || '', loyalty_points_used: 0 });
  }
  if (loyaltyUsed > client.getFloat('loyalty_points') + 0.0001) throw U.fail(422, 'El cliente no tiene suficientes puntos', 'insufficient_loyalty_points');
  const discounts = U.r2(cartDiscounts.reduce((s, d) => s + d.amount, 0));
  if (discounts > base) throw U.fail(400, 'Los descuentos exceden el total', 'invalid_discount');
  const deliveryCost = body.delivery_cost ? U.r2(Number(body.delivery_cost)) : 0;
  if (deliveryCost < 0) throw U.fail(400, 'Costo de envío inválido', 'invalid_delivery_cost');
  const total = U.r2(base - discounts + deliveryCost);
  if (!(total > 0)) throw U.fail(400, 'El total debe ser mayor a cero', 'invalid_total');
  const factor = base > 0 ? (base - discounts) / base : 1; // prorrateo del descuento de carrito en cada partida

  // ── margen mínimo (regla de negocio que Pulpos solo aplicaba en la pantalla)
  if (st && st.getBool('min_profit_margin_enabled') && st.getFloat('min_profit_margin') > 0) {
    const min = st.getFloat('min_profit_margin');
    const bad = [];
    for (const l of lines) {
      if (l.unitCost <= 0) continue;
      const net = (l.total * factor) / l.qty;
      const margin = net > 0 ? ((net - l.unitCost) / net) * 100 : -100;
      if (margin < min) bad.push(`${l.name} (${U.r2(margin)}%)`);
    }
    if (bad.length) {
      if (st.getString('min_profit_margin_policy') === 'block') throw U.fail(422, `Margen menor al mínimo de ${min}%: ${bad.join(', ')}`, 'margin_below_minimum');
      warnings.push({ code: 'margin_below_minimum', items: bad });
    }
  }

  // ── pagos
  const { pays, credit, paidNet } = parsePayments(tx, body.payments);
  let remaining = 0;
  let dueDate = '';
  if (credit) {
    U.need(ctx, 'order.create_with_credit', 'No puedes vender a crédito');
    if (!isAccountClient) throw U.fail(400, 'El crédito requiere un cliente registrado', 'credit_requires_client');
    dueDate = parseDueDate(body.debt_due_date);
    remaining = U.r2(total - paidNet);
    if (!(remaining > 0)) throw U.fail(400, 'No queda saldo para el crédito', 'invalid_credit');
    const lim = debtLimitFor(client, st);
    if (lim > 0 && currentDebt(tx, client.id) + remaining > lim + 0.0001) throw U.fail(422, `Excede el límite de crédito del cliente ($${lim})`, 'debt_limit_exceeded');
  } else if (pays.length && !U.near(paidNet, total)) {
    throw U.fail(422, paidNet < total ? 'Los pagos no cubren el total' : 'Los pagos exceden el total', 'payment_mismatch');
  }
  if (isAccountClient && st && st.getBool('restrict_selling_to_clients_with_overdue_debt') && hasOverdueDebt(tx, client.id)) {
    throw U.fail(422, 'El cliente tiene deuda vencida', 'client_has_overdue_debt');
  }

  // ── entrega: se descuenta inventario si se entrega ahora; si no, queda comprometido
  const deliver = origin === 'pos' && body.deliver_products !== false;
  if (origin === 'pos' && body.deliver_products === false) U.need(ctx, 'order.postpone_products_delivery');
  const allowOut = !!(st && st.getBool('allow_selling_out_of_stock'));

  // ── folio por serie (primer write de la transacción: serializa ventas concurrentes)
  let series = cashier.getString('order_series') ? tx.findRecordById('order_series', cashier.getString('order_series')) : U.first(tx, 'order_series', 'is_default = true && deleted_at = ""');
  if (!series) throw U.fail(400, 'No hay serie de folios', 'no_series');
  const orderNumber = series.getInt('next_number') || 1;
  series.set('next_number', orderNumber + 1);
  tx.save(series);

  // ── disponibilidad (después del lock de la transacción)
  const need = {};
  for (const l of lines) {
    const targets = l.children.length ? l.children : [l];
    for (const t of targets) {
      if (t.product.getString('type') === 'service' || !t.product.getBool('is_stockable')) continue;
      need[t.product.id] = { product: t.product, qty: U.r4((need[t.product.id] ? need[t.product.id].qty : 0) + t.qty) };
    }
  }
  if (!allowOut) {
    const short = [];
    for (const k of Object.keys(need)) if (S.available(tx, need[k].product, location.id) < need[k].qty) short.push(need[k].product.getString('name'));
    if (short.length) throw U.fail(409, `Inventario insuficiente: ${short.join(', ')}`, 'insufficient_stock');
  }

  // ── lealtad: tasa de la venta
  let loyaltyPct = 0;
  const program = isAccountClient ? L.activeProgram(tx) : null;
  if (program && L.appliesTo(program, listId, location.id) && total >= program.getFloat('min_cart_total')) {
    let points = 0;
    for (const l of lines) points += l.total * factor * L.rateFor(tx, program, l.product) / 100;
    loyaltyPct = U.r4(points / total * 100);
  }

  const madeAt = (() => {
    if (!body.made_at) return U.nowStr();
    const d = new Date(String(body.made_at).replace(' ', 'T'));
    const diff = Date.now() - d.getTime();
    if (isNaN(d.getTime()) || diff < -300000 || diff > 7 * 86400000) throw U.fail(400, 'made_at fuera del rango permitido', 'invalid_made_at');
    return U.nowStr(d);
  })();

  // ── escritura
  const quotation = body.quotation ? must(tx, 'quotations', body.quotation, 'La cotización') : null;
  if (quotation && quotation.getString('status') !== 'created') throw U.fail(409, 'La cotización ya está vendida', 'quotation_already_sold');

  const paymentStatus = pays.length || credit ? 'completed' : 'pending';
  const order = U.create(tx, 'orders', {
    order_number: orderNumber, friendly_id: U.friendlyId(tx, 'orders'), series: series.id, location: location.id, client: client.id,
    seller: seller ? seller.id : '', price_list: listId, quotation: quotation ? quotation.id : '', origin, payment_status: paymentStatus,
    shipping_status: deliver ? 'completed' : 'pending', way_of_payment: body.way_of_payment || 'to_agree_after_purchase',
    shipping_method: body.shipping_method || 'to_agree_after_purchase', subtotal, discounts, original_total: base, total,
    with_taxes: body.with_taxes !== false, delivery_cost: deliveryCost, loyalty_reward_percentage: loyaltyPct, notes: body.notes || '',
    made_at: madeAt, request_id: requestId, is_offline: !!body.is_offline, created_by: user.id,
  });

  for (const l of lines) {
    const item = U.create(tx, 'order_items', {
      order: order.id, product: l.product.id, name: l.name, type: l.product.getString('type'), quantity: l.qty, unit: l.product.getString('sell_unit'),
      unit_price: l.price, total: l.total, price_type: l.priceType, price_breakpoint: l.breakpoint, price_list: l.priceList,
      discount: l.disc ? U.create(tx, 'order_item_discounts', { type: l.disc.type, value: l.disc.value, title: l.disc.title, promotion: l.disc.promotion }).id : '',
    });
    U.create(tx, 'order_item_costs', { order_item: item.id, unit_cost: l.unitCost, total_cost: U.r2(l.unitCost * l.qty) });
    for (const taxId of l.product.getStringSlice('taxes')) {
      const tax = tx.findRecordById('taxes', taxId);
      U.create(tx, 'order_item_taxes', { order_item: item.id, tax: tax.id, type: tax.getString('type'), percentage: tax.getFloat('percentage'), is_withheld: tax.getBool('is_withheld') });
    }
    const targets = [];
    if (l.children.length) {
      for (const c of l.children) {
        const ci = U.create(tx, 'order_items', { order: order.id, product: c.product.id, name: c.name, type: c.product.getString('type'), quantity: c.qty, unit: c.product.getString('sell_unit'), unit_price: 0, total: 0, price_type: 'default', price_breakpoint: 0, price_list: listId, combo_parent: item.id });
        U.create(tx, 'order_item_costs', { order_item: ci.id, unit_cost: 0, total_cost: 0 });
        targets.push({ item: ci, product: c.product, qty: c.qty, batches: null });
      }
    } else targets.push({ item, product: l.product, qty: l.qty, batches: l.batches });

    if (deliver) {
      for (const t of targets) {
        if (t.product.getString('type') === 'service' || !t.product.getBool('is_stockable')) continue;
        if (t.product.getBool('batches_enabled')) {
          const strategy = st ? st.getString('batch_strategy') : 'manual';
          const alloc = S.allocateBatches(tx, t.product, location.id, t.qty, strategy === 'manual' ? t.batches : null, allowOut);
          for (const a of alloc) {
            S.move(tx, { product: t.product.id, batch: a.batch, location: location.id, delta: -a.quantity, origin: 'order_create', refs: { order: order.id }, user: user.id, allowNegative: allowOut });
            U.create(tx, 'order_item_batches', { order_item: t.item.id, batch: a.batch, quantity: a.quantity });
          }
        } else {
          S.move(tx, { product: t.product.id, location: location.id, delta: -t.qty, origin: 'order_create', refs: { order: order.id }, user: user.id, allowNegative: allowOut });
        }
      }
    }
  }

  for (const d of cartDiscounts) U.create(tx, 'order_cart_discounts', { order: order.id, type: d.type, amount: d.amount, title: d.title, promotion: d.promotion, loyalty_points_used: d.loyalty_points_used });

  // pagos (el crédito primero: los demás pagos lo "liquidan" en parte, como en Pulpos)
  let creditPay = null;
  if (credit) {
    creditPay = U.create(tx, 'order_payments', { order: order.id, method: 'credit', custom_payment_method: credit.custom, total: remaining, change: 0, cashier: cashier.id, made_at: madeAt, created_by: user.id });
    U.create(tx, 'order_debts', { order: order.id, original_debt: total, current_debt: remaining, due_date: dueDate, credit_payment: creditPay.id });
  }
  let earned = 0;
  for (const p of pays) {
    const reward = loyaltyPct > 0 ? U.r2(p.net * loyaltyPct / 100) : 0;
    earned = U.r2(earned + reward);
    U.create(tx, 'order_payments', { order: order.id, method: p.method, custom_payment_method: p.custom, total: p.total, change: p.change, cashier: cashier.id, made_at: madeAt, loyalty_points_reward: reward, settles_payment: creditPay ? creditPay.id : '', created_by: user.id });
  }

  // puntos: primero el canje, luego lo ganado
  if (loyaltyUsed > 0) L.addPoints(tx, client, -loyaltyUsed, 'order_spend', order.id, user.id);
  if (earned > 0) L.addPoints(tx, client, earned, 'order_earn', order.id, user.id);

  U.create(tx, 'order_events', { order: order.id, type: deliver ? 'product_delivery' : 'products_committed', user: user.id, location: location.id });

  if (quotation) {
    quotation.set('status', 'sold');
    tx.save(quotation);
    U.create(tx, 'quotation_events', { quotation: quotation.id, type: 'sold', user: user.id, content: `Venta #${orderNumber}` });
  }

  const out = serialize(tx, order, ctx);
  out.warnings = warnings;
  return out;
}

module.exports = { createOrder, priceFor, serialize, must, parsePayments, currentDebt, hasOverdueDebt, debtLimitFor, parseDueDate };
