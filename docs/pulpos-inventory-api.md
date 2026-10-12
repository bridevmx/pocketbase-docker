# API de inventario, compras, gastos y fabricación

Todas las rutas requieren sesión (`users`), respetan la licencia (solo lectura / suspendida → bloqueado) y se ejecutan en **una transacción**: si algo falla no queda nada a medias. Los errores traen el código de máquina como *nombre de clave* en `data` (igual que ventas). El cliente nunca escribe estas colecciones directamente.

Inventario se mueve **solo** a través del libro `stock_movements` (`previous_quantity` → `current_quantity`, `origin`, y la relación al documento origen).

## Ajustes de inventario (incluye la carga inicial)
| Ruta | Permiso | Qué hace |
|---|---|---|
| `POST /api/tpv/stock-adjustments` | `stock_adjustment.complete` (borrador: `…manage_draft`) | Crea y, si `status != "draft"`, aplica |
| `POST /api/tpv/stock-adjustments/{id}/complete` | `stock_adjustment.complete` | Aplica un borrador |
| `DELETE /api/tpv/stock-adjustments/{id}` | borrador: `manage_draft`; completado: `complete` | Completado: revierte con movimientos `stock_adjustment_delete` |

Body: `{ type: entry|exit|count, location, reason?, notes?, status?, items:[{ product, quantity, unit_cost?, unit_price?, batches?:[{ batch | code, expires_at?, fabricated_at?, quantity }] }] }`

- `entry` suma, `exit` resta, `count` **fija** la existencia contada (guarda la previa).
- Productos con lotes exigen `batches` (se crean si el código es nuevo); sin lotes los rechazan.
- Una entrada con `unit_cost` actualiza el costo con promedio ponderado.
- Salida sin existencia → 409 `insufficient_stock` (salvo `allow_negative_stock_movements`).

## Traspasos
`POST /api/tpv/transfers` (`transfer.manage_draft`) → `POST …/{id}/send` (`transfer.send`, acceso al origen) → `POST …/{id}/receive` (`transfer.receive`, acceso al destino) · `DELETE …/{id}`.

- Crear: `{ origin, destination, items:[{ product, quantity | batches }] }` (borrador, no mueve nada).
- Enviar: descuenta del origen; con lotes reparte FEFO (o los lotes indicados) y los registra.
- Recibir: por defecto todo; `{ items:[{ item, quantity_received, batches? }] }` para faltantes (no se puede recibir más de lo enviado; el faltante queda en el evento).
- Borrar: borrador se descarta; **enviado** devuelve el inventario al origen; recibido → 409.

## Compras
`POST /api/tpv/purchases` · `POST …/{id}/complete` (borradores) · `POST …/{id}/payments` · `DELETE …/{id}`; permiso `outlay.register_payment`.

Body: `{ request_id, status?, location, provider?, made_at?, folio?, notes?, due_date?, cashier?, items:[{ product, quantity, unit_cost, discount_percentage?, taxes?:[id], batches? }], payments:[{ method, total }] }`

- Total por partida = cantidad × costo neto con descuento + impuestos. **El costo del producto usa el neto (sin impuestos)** con promedio ponderado: `(existencia_total × costo + entrada × costo_nuevo) / (existencia_total + entrada)`. Ej.: 71 @ 8 + 10 @ 10 → 8.2469.
- Pagos: lo no pagado queda en `purchase_debts` (con `due_date`). Un pago `cash` exige `cashier` de esa sucursal y genera un `cash_movement` negativo (`purchase_payment`).
- `request_id` hace idempotente el envío. Abonos: `…/payments` (no más que la deuda).
- Borrar: revierte inventario (`purchase_delete`) y anula los movimientos de caja; el costo promedio no se recalcula hacia atrás.

## Gastos
`POST /api/tpv/expenses` · `POST …/{id}/payments` · `DELETE …/{id}`; mismo permiso. Body: `{ location, concept, total, made_at?, provider?, folio?, taxes?:[id], due_date?, cashier?, payments? }`. `total` ya incluye impuestos (los impuestos se guardan solo como detalle). Misma lógica de deuda y caja.

## Fabricación (función `manufacturing` del plan → 402 si no)
`POST /api/tpv/manufacturing-orders` (`…create`) → `…/{id}/start` (`…start`) → `…/{id}/finish` (`…finish`) · `…/{id}/cancel` (`…cancel`).

- Crear: `{ product, location, initial_quantity, materials? }`; sin `materials` usa la receta × cantidad.
- Iniciar: consume materiales (FEFO si llevan lotes). Terminar: `{ manufactured_quantity?, batch? }` produce existencias y fija el costo del producto con el promedio ponderado del costo de materiales consumidos ÷ unidades producidas.
- Cancelar: si ya inició, devuelve los materiales; terminada → 409.

## Supuestos míos (Pulpos no lo expone)
- Permiso de compras/gastos: `outlay.register_payment`. Compras y gastos no se editan (se borran y se recrean).
- Cantidades en la unidad de venta del producto (`sell_unit_factor = 1`).
- Entradas (compra, recepción de traspaso, producción) nunca fallan por existencia.
- Los ajustes no tienen `request_id`: el cliente debe evitar reenvíos.
