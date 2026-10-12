# API de ventas (rutas del servidor)

Todas requieren sesión (`Authorization: <token del usuario>`) y escriben **dentro de una transacción**: o se guarda todo
(venta, partidas, impuestos, costos, pagos, deuda, inventario, puntos, bitácora) o nada. El cliente **nunca** escribe estas
tablas directo (sus reglas de creación/edición son `null`); solo las lee según permisos y sucursales.

Los errores traen `status`, `message` y `data: { "<codigo>": {...} }`: el **código de máquina es el nombre de la clave**
(PocketBase reemplaza los valores). Ej.: `{"status":422,"message":"Los pagos no cubren el total","data":{"payment_mismatch":{...}}}`.

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `POST /api/tpv/orders` | `order.create` | Crea la venta (contado, mixta, crédito o pedido guardado) |
| `GET /api/tpv/orders/{id}` | `order.read` | Venta completa: partidas, impuestos, lotes, pagos, deuda, descuentos, bitácora |
| `POST /api/tpv/orders/{id}/payments` | `order.register_payment_and_shipping` | Cobra una venta con pago pendiente |
| `POST /api/tpv/orders/{id}/deliver` | `order.register_payment_and_shipping` | Entrega: baja el inventario comprometido |
| `POST /api/tpv/orders/{id}/debt-payments` | `order.register_payment_and_shipping` | Abono a la deuda de una venta |
| `POST /api/tpv/debt-payments` | `order.register_payment_and_shipping` | Un abono que cubre varias ventas del mismo cliente |
| `POST /api/tpv/orders/{id}/refund` | `order.refund` | Reembolso de partidas |
| `POST /api/tpv/orders/{id}/cancel` | `order.cancel` | Cancela una venta con pago pendiente |
| `DELETE /api/tpv/orders/{id}` | `order.cancel` | Borrado lógico (revierte inventario y puntos) |

## Crear una venta

```jsonc
POST /api/tpv/orders
{
  "request_id": "uuid",                 // obligatorio; idempotencia (reintentos y venta offline)
  "location": "<sucursal>", "cashier": "<caja>",
  "client": "<cliente>",                // opcional; por defecto "Público en General"
  "seller": "<vendedor>",               // opcional · order.assign_salesman
  "price_list": "<lista>",              // opcional; si no, la del cliente → la de la sucursal → la predeterminada
  "origin": "pos" | "pos_save_as_order",// pos_save_as_order = pedido guardado · order.save_counter_order
  "items": [{
    "product": "<id>", "quantity": 2,
    "unit_price": 10,                   // opcional · solo si cambia el precio · order.apply_personalized_price
    "discount": { "type": "percentage" | "fixed", "value": 10, "title": "" },   // por partida · order.admin_discount
    "batches": [{ "batch": "<id>", "quantity": 2 }]   // opcional (estrategia manual); si no, FEFO
  }],
  "cart_discounts": [
    { "type": "percentage" | "fixed", "value": 5 },   // order.admin_discount
    { "loyalty_points_used": 10 }                      // canje de puntos: 1 punto = $1
  ],
  "payments": [
    { "method": "cash", "total": 100, "change": 0 },   // change solo en efectivo
    { "method": "credit" }                             // sin importe: lo que falte
  ],
  "debt_due_date": "2026-11-30",        // obligatorio con crédito
  "deliver_products": true,             // false = comprometer sin entregar · order.postpone_products_delivery
  "delivery_cost": 0, "notes": "", "quotation": "<id>",
  "is_offline": false, "made_at": "2026-10-12T15:00:00Z"   // venta offline (máx. 7 días atrás)
}
```

Respuesta: `{ order, items[], payments[], cart_discounts[], debt, events[], warnings[] }`
(`items[].cost` solo con `product.read_cost`). Si el `request_id` ya existe devuelve esa venta con `idempotent: true`.

### Lo que decide el servidor (el cliente solo manda id y cantidad)
- **Precio**: de `product_prices` por lista y cantidad (breakpoint más alto que no la rebase; si falta en la lista, el de la lista predeterminada).
- **Totales**: `subtotal = Σ cantidad × precio` (antes del descuento por partida) · cada partida guarda `total` ya con su descuento · `discounts` = solo descuentos de **carrito** · `total = subtotal − descuentos de partida − descuentos de carrito + envío`. Los porcentajes de carrito se calculan sobre `subtotal − descuentos de partida`.
- **Costo, impuestos y descuento** se guardan como snapshot en la partida (`order_item_costs`, `order_item_taxes`, `order_item_discounts`).
- **Combos**: partida padre al precio del combo + una partida por componente (precio 0, `combo_parent`) para bajar su inventario.
- **Folios**: `order_number` por serie (la de la caja) y `friendly_id` de 7 caracteres.
- **Inventario**: si se entrega, baja el saldo (producto o lote) y escribe `order_create` en el libro; si no, queda **comprometido** (se descuenta de la disponibilidad). Con lotes y estrategia `automatic` (o sin lotes indicados) reparte **FEFO**.
- **Pagos**: la suma de pagos netos (`total − change`) debe igualar el total; sin pagos la venta queda `pending`. `credit` no trae importe.
- **Crédito**: la fila `credit` guarda la **deuda viva**; `order_debts.original_debt` = total de la venta; los demás pagos de la misma venta apuntan a ella con `settles_payment`.
- **Lealtad**: tasa por partida (producto → categoría → general) con mínimo de carrito y límites por lista/sucursal; se guarda `loyalty_reward_percentage` y los puntos se acreditan **por pago** (`order_earn`); el canje es un descuento de carrito (`order_spend`).

### Reglas que ahora se aplican en el servidor (en Pulpos solo estaban en la pantalla)
| Regla | Código |
|---|---|
| Permisos finos y acceso a sucursal/caja/lista | `permission_denied`, `location_forbidden`, `cashier_forbidden`, `price_list_forbidden` |
| Existencias (salvo `allow_selling_out_of_stock`) | `insufficient_stock` (409) |
| Total y pagos cuadran | `payment_mismatch` (422) |
| Margen mínimo (`block` rechaza, `warn` avisa) | `margin_below_minimum` (422) |
| Límite de crédito del cliente | `debt_limit_exceeded` (422) |
| Cliente con deuda vencida (si está activado) | `client_has_overdue_debt` (422) |
| Crédito solo a clientes registrados y con fecha | `credit_requires_client`, `invalid_due_date` |
| Puntos suficientes para canjear | `insufficient_loyalty_points` |
| Precios con ≤ 2 decimales, descuentos válidos | `invalid_price`, `invalid_discount` |
| Licencia vigente (solo lectura al vencer) | `trial_expired`, `payment_overdue`… (402) |

## Ciclo de vida
- **Cobrar pendiente** `payments`: `{ cashier, payments[], debt_due_date? }`; debe cubrir exacto el saldo (o usar `credit`). Acredita puntos (`order_payment_earn`).
- **Entregar** `deliver`: `{ cashier?, debt_due_date? }`; si el pago está pendiente, entrega **a crédito** (requiere fecha, cliente registrado y `order.create_with_credit`).
- **Abonar** `debt-payments`: `{ method, total, change?, cashier }`; baja `order_debts.current_debt` y el `total` del pago `credit`; acredita puntos. `POST /api/tpv/debt-payments` con `{ payments:[{ order, method, total, cashier }] }` crea un `unified_debt_payment` común.
- **Reembolsar** `refund`: `{ reason, items:[{ order_item, quantity }], payments:[{ method, total, cashier? }] }`. El monto se prorratea con el descuento de carrito; **primero cancela deuda viva** (`cancelled_debt`) y el resto se devuelve con `payments` (deben sumar exacto). Devuelve inventario (`order_return`, por lote si aplica), revierte puntos en proporción y pasa la venta a `refunded` si todo se reembolsó. Sin `cashier` el reembolso no entra al corte de caja.
- **Cancelar**: solo con pago `pending` (si ya se había entregado, regresa el inventario).
- **Eliminar**: borrado lógico con `order_delete`; no procede si tiene reembolsos (`order_has_refunds`).

## Supuestos y límites de esta primera versión
- Los precios se consideran **con impuestos incluidos**. `with_taxes` se guarda pero **aún no** quita ni suma impuestos al total (falta investigar cómo lo hace Pulpos).
- **No se aplican promociones automáticas**; solo se guarda `promotion` como referencia en descuentos.
- Margen = `(precio neto − costo) / precio neto`, con el descuento de carrito prorrateado (Pulpos no documenta su fórmula).
- El costo de un combo es el de su propio `product_costs`; los componentes se registran con costo 0 para no duplicar.
- El inventario inicial aún se carga con superusuario: llegará con las rutas de **ajustes, compras y traspasos** (fase de inventario).
- Falta: tienda en línea pública, cotizaciones (CRUD con totales), reportes (`analytics`), corte de caja y fabricación.

# Cotizaciones
Rutas en `pb_hooks/quotations.pb.js`. Se calculan como una venta (precio por lista y escalón de cantidad, descuentos), pero no mueven inventario, pagos ni puntos.

| Ruta | Permiso |
|---|---|
| `POST /api/tpv/quotations` | `quotation.create` |
| `GET /api/tpv/quotations/{id}` | `quotation.read` |
| `PUT /api/tpv/quotations/{id}` (reemplaza partidas; solo `created`) | `quotation.edit` |
| `DELETE /api/tpv/quotations/{id}` (borrado lógico; no si ya se vendió) | `quotation.edit` |
| `POST /api/tpv/quotations/{id}/convert` | `quotation.read` + los de una venta |

Body: `{ location, client?, seller?, price_list?, expires_at?, client_note?, notes?, with_taxes?, items:[…], cart_discounts?:[{type,value,title}] }`. Partida de producto: `{ product, quantity, unit_price?, discount?:{type,value,title}, taxes?:[id] }`; partida manual: `{ manual:true, name, quantity, sell_price, manual_cost?, taxes? }`.
Permisos finos: `quotation.admin_discount` (descuentos), `quotation.apply_personalized_price` (+ ajuste de precios personalizados activo), `quotation.manage_manual_entry`, `quotation.remove_and_add_taxes`. `manual_cost` solo se ve con `product.read_cost`.
Vigencia: `expires_at` o `quotation_default_validity_days`; `client_note` por defecto toma `quotation_fixed_note`. Respuesta: cotización con `items` (con `taxes` y `discount`), `cart_discounts` y `total` = subtotal − descuentos de carrito.

**Convertir**: `{ request_id, cashier, payments, … }` arma la venta con los productos, cantidades, cliente, vendedor, lista y descuentos de la cotización, y la crea con las reglas normales (la cotización pasa a `sold`). Los precios se recalculan con la lista vigente (los personalizados se conservan). Errores: `manual_items_not_sellable` (las partidas manuales no se venden), `quotation_expired`, `quotation_already_sold`.
Supuestos míos: no hay aviso de existencias insuficientes al cotizar; los combos se guardan como una sola partida (sin `combo_parent`); la cotización vencida no se puede convertir.

# Impuestos y promociones

## Impuestos (precio con impuestos incluidos)
Los precios de venta **incluyen** impuestos (convención del comercio en México). Cada partida guarda en `order_item_taxes` el desglose del total de la partida **ya con descuentos** (el descuento de carrito se prorratea): `amount` es el impuesto contenido.
- Base gravable `b = total / ((1 + IEPS) × (1 + IVA))`; IEPS = `b × i`; IVA = `(b + IEPS) × v`. Exento y retenido no entran en la base; las retenciones se guardan como `is_withheld` con `amount = b × %` (informativas: no cambian el total).
- `with_taxes = false` (venta sin desglose): se guardan las filas con `amount = 0` y el total es el mismo. **Supuesto mío**: en Pulpos no pude verificar si `withTaxes` cambia el total; aquí solo decide si se desglosa.
- Cotizaciones: mismo desglose en `quotation_item_taxes.amount`.
- Reporte: `GET /api/tpv/analytics/taxes?from&to` (`report.view_finance_reports`): por impuesto/tasa, ventas gravadas, impuesto, devuelto por reembolsos (proporcional a lo reembolsado) y neto; `totals.collected` (trasladado) y `totals.withheld`.
- Zona horaria: `business.utc_offset_minutes` (alta: `utc_offset_minutes` en `POST /api/tpv/setup`; México centro = -360). La usan los días de las promociones y es el `tz_offset` por defecto de la analítica.

## Promociones
Se crean con la API de colecciones (`promotions` + `promotion_targets`, `promotion_clients`, `promotion_days`; permiso `promotion.admin`). El servidor las aplica al crear la venta y la cotización:
- **Vigencia**: `valid_from`/`valid_until` (vacío = abierto), `ended_at` la termina, `promotion_days` (hora local del negocio), `price_lists`/`locations` (vacío = todas), `restrict_to_clients`: `no_restriction` · `registered_clients` · `clients_list`.
- **`single_target`** (`promotion_targets` rol `single`, producto o categoría): `amount` en `percentage` o `fixed` (fijo = **por unidad**, tope el importe de la partida).
- **`multi_target`**: `multi_target_type` = `two_for_one`, `three_for_two`, `second_fifty_percent`, `third_fifty_percent` o `custom` (`trigger_quantity`, `discounted_quantity`, `discounted_percentage`). Objetivos con rol `trigger`; cada grupo de `trigger_quantity` unidades regala/descuenta `discounted_quantity` de las **más baratas** del conjunto (mezclando productos).
- **`multi_target_advanced`**: compra N de los `trigger` y descuenta M unidades de los `discounted` (las más baratas) al porcentaje indicado.
- **`cart_total`**: descuento de carrito (`percentage`/`fixed`) si el subtotal (ya con descuentos por partida) llega a `min_cart_subtotal`.
- **Reglas de combinación**: una partida con descuento manual no recibe promoción; en una partida gana la promoción que más descuenta (no se acumulan); de carrito se aplica la mejor automática más las manuales elegidas, y se suman a los descuentos de carrito manuales.
- **Registro**: el descuento de la partida queda en `order_item_discounts.promotion` (tipo `fixed` con el monto); el de carrito en `order_cart_discounts.promotion`. Como en Pulpos, `Order.discounts` solo suma los de carrito. La respuesta trae `promotions: [{promotion, name, amount}]`.
- **Automáticas** (`application = automatic`) se aplican solas; `apply_promotions: false` las desactiva (exige `order.admin_discount`). **Manuales**: `promotions: [id]` en el cuerpo de la venta (en cotización exige `quotation.admin_promotions`); si no aplican → 422 `promotion_not_applicable`.
- **Vista previa**: `dry_run: true` en `POST /api/tpv/orders` corre todo (precios, promociones, impuestos y reglas) y deshace la transacción; devuelve la venta calculada sin guardar nada ni mover inventario.
- Al convertir una cotización, los descuentos que vinieron de promociones se recalculan con las reglas vigentes (no se duplican); los manuales se conservan.
- No se aplican en la tienda en línea (supuesto mío).
