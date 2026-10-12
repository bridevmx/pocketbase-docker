# Analítica (solo lectura, agregada en el servidor)

`GET /api/tpv/analytics/{sales|inventory|purchases|expenses|finance}` (sesión requerida). Se calcula con SQL en el servidor, así que el cliente no baja las ventas para sumarlas.

Parámetros comunes: `from`, `to` (AAAA-MM-DD **locales**, `to` incluyente; por defecto el mes en curso), `tz_offset` (minutos respecto a UTC, México centro = `-360`; el servidor guarda UTC, sin él los días se cortan en UTC), `location` (solo si el usuario tiene acceso; sin él, todas sus sucursales; el admin ve todas). Rango máximo ~2 años.

| Ruta | Permiso | Parámetros extra |
|---|---|---|
| `sales` | `report.view_sales_reports` | `group` = `day`(default) · `week` · `month` · `product` · `category` · `client` · `seller` · `payment_method` · `location`; `payment_status` = `completed`/`pending` |
| `inventory` | `report.view_inventory_reports` | `low=true` (agotados o bajo mínimo), `limit` |
| `purchases` | `report.view_purchases_reports` | `group` = `day`/`week`/`month`(default)/`provider`/`product` |
| `expenses` | `report.view_purchases_reports` | `group` = `day`/`week`/`month`/`provider`/`concept` |
| `finance` | `report.view_finance_reports` | cobrado en el periodo + por cobrar/por pagar a hoy |

## Reglas de cálculo
- **Ventas** = pedidos no borrados ni cancelados con `made_at` en el periodo (incluye los pendientes de cobro; filtra con `payment_status`). `total` por día excluye el envío; `gross` = antes de descuentos; `discounts` = por partida + carrito.
- **Por producto/categoría/cliente/vendedor/sucursal**: sobre las partidas, repartiendo el descuento de carrito en proporción, de modo que **la suma de las filas = total de ventas**. Los componentes de combo no suman (el combo ya lleva el precio).
- **Costo y margen**: del *snapshot* de costo de cada partida (no del costo actual). Solo se devuelven con `product.read_cost`; sin él desaparecen `cost`, `margin` y `margin_percentage`.
- `totals`: `orders`, `total`, `delivery`, `refunds` (reembolsos creados en el periodo), `net_total = total − refunds`, `average_ticket`. Los reembolsos no se restan por producto/categoría (solo en `totals`).
- **`payment_method`** = dinero cobrado (ventas y abonos, neto de cambio) por fecha de pago; excluye `credit` (no es dinero).
- **Inventario**: existencia sumada por producto (producto o lotes) en las sucursales permitidas, `min_quantity`, `below_minimum`; con costo, `value = existencia positiva × costo actual` y total del inventario.
- **Compras/gastos**: total y `outstanding_debt` (deuda viva) por grupo; por producto solo compras (con cantidad).
- **Finanzas**: `receivable` (deuda de clientes, vencida = `due_date` anterior a hoy, top 10 deudores), `payable` (compras + gastos, con vencido) y `collected` (cobrado por método en el periodo).

## Supuestos míos
- Las ventas pendientes (pedido guardado, tienda en línea sin cobrar) cuentan como venta; usa `payment_status=completed` para solo cobradas.
- No hay reporte por hora ni por usuario/caja (el corte de caja ya cubre la caja).
- El valor del inventario usa el costo promedio actual; no es valuación histórica.
