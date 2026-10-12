# Diseño del schema de PocketBase (TPV tipo Pulpos)

Traducción del modelo observado en Pulpos (`pulpos-analysis.md`, `pulpos-model-catalog.md`) a PocketBase 0.40.
El listado completo de colecciones y campos está en [`pulpos-schema.md`](pulpos-schema.md) (generado).

**Restricción del proyecto: no hay ningún campo `json`.** Toda lista, arreglo o estructura anidada es una colección referenciada.

## 1. Alcance

| Incluido | Fuera (por ahora) |
|---|---|
| Cuenta multi-negocio, usuarios, permisos finos, sucursales/almacenes, cajas, series | Facturación (CFDI, facturas globales, perfiles fiscales, SAT) |
| Productos (simple, combo, servicio, variantes, fabricados), precios por lista y volumen, impuestos, lotes | WhatsApp, agente IA, asistente, conversaciones |
| Inventario: saldo, libro de movimientos, traspasos, ajustes, fabricación | Recargas y servicios digitales (GestoPagos) |
| Ventas: partidas, descuentos, pagos mixtos, crédito, abonos, reembolsos, bitácora | Conciliación bancaria |
| Cotizaciones, promociones, programa de lealtad | Suscripción/cobro de planes (Chargebee), afiliados, onboarding |
| Compras, gastos, proveedores, deudas y pagos | Recetas médicas (farmacia) |
| Caja: movimientos y cortes | Importaciones masivas |
| Catálogo en línea (configuración) | Notificaciones de pago del cliente |

93 colecciones, 0 campos `json`.

## 2. Convenciones

- Nombres en inglés, `snake_case`. Valores de `select` en minúsculas (`cash`, `debit_card`…).
- **Multi-tenant**: todas las tablas de negocio llevan `account` (relación a `accounts`). Los catálogos globales (`measure_units`, `permissions`, impuestos con `account` vacío) no.
- **Borrado lógico**: `deleted_at` (date) donde Pulpos usa `deletedAt`. Los índices únicos de SKU, código de barras, lotes y ruta de lista de precios son parciales (`… WHERE deleted_at = ""`), así que un SKU liberado se puede reutilizar.
- `created` / `updated` en todas las colecciones (autodate).
- **Dinero y cantidades**: `number` (float64). La moneda es una sola por cuenta (`accounts.currency`, hoy `mxn`), no una columna por monto. El redondeo (2 decimales de precio, costo promedio con más precisión) lo aplican los hooks.
- **`bool` y `number` nunca son `required`**: en PocketBase `required` significa `true` / distinto de 0.
- **Nulos numéricos**: PocketBase no distingue 0 de vacío. Convenciones: `default_client_debt_limit = 0` ⇒ sin límite; `clients.uses_default_debt_limit` indica si usa el del negocio; `account_settings.min_profit_margin_enabled` activa el margen mínimo; `loyalty_programs.min_cart_total = 0` ⇒ sin mínimo.
- Relaciones múltiples (`rels`) solo para M:N puras sin atributos (impuestos del producto, accesos del usuario, listas/sucursales de una promoción). Si la relación lleva datos, es una colección propia.

## 3. Qué JSON/arreglo de Pulpos pasó a colección

| En Pulpos | En PocketBase |
|---|---|
| `ProductProfile.variantConfig` (JSON) | `variant_options` → `variant_option_values` → `product_variant_values` |
| `OrderJournal.events` y `QuotationJournal.events` (JSON) | `order_events`, `quotation_events` |
| `CashierAuditItem.detail` (JSON) | columnas: `order_payment`, `debt_payment`, `refund`, `outlay_payment`, `movements_in_total`, `cash_withdrawal`, `cash_in` |
| `OrderRefund.orderSnapshot` (JSON) | innecesario: las partidas de la venta son inmutables |
| `User.advancedPermissions[]` | `users.permissions` → `permissions` (catálogo de 75 permisos con `requires`) |
| `AccountSettings.allowedPaymentMethods[]`, `enabledUnits[]`, `accountFeatures` | `account_payment_methods`, `account_units`, `account_features` |
| `Promotion.daysOfWeekLimitation[]` | `promotion_days` |
| `*Promotion.target`, `triggerTarget`, `discountedTarget` | `promotion_targets` (`role` = single / trigger / discounted; producto o categoría) |
| `CatalogOrderPaymentConfiguration.wayOfPayments[]`, `CatalogOrderShippingConfiguration.shippingMethods[]` | `catalog_payment_ways`, `catalog_shipping_methods` |
| `StockMovement.discriminator*` (BASIC/BATCH/VARIANT + id) | `stock_movements.batch` (variantes ya son productos distintos) |
| `StockMovement.origin + originId` (polimórfico) | una relación por tipo de documento: `order`, `purchase`, `transfer`, `stock_adjustment`, `manufacturing_order` |
| `Order…Quantity per batch` | `order_item_batches`, `order_refund_item_batches`, `purchase_item_batches`, `transfer_item_batches`, `stock_adjustment_item_batches` |

## 4. Decisiones de modelado

1. **`products` fusiona `Product` + `ProductProfile`** (en Pulpos eran 1:1 con el mismo id). Las variantes siguen la idea de Pulpos: un padre (`is_variant_group`) sin stock ni precio y hijos (`parent`) con su sku, precios y stock.
2. **El costo es otra colección** (`product_costs`, y `order_item_costs` para el snapshot de la venta). PocketBase no tiene permisos por campo; así `product.read_cost` / `product.edit_cost` se aplican de verdad, algo que Pulpos solo hace en la interfaz.
3. **`price_lists` absorbe `CatalogVariantConfig`**: `catalog_path` y `catalog_hidden` son la ruta pública de esa lista en la tienda.
4. **Configuración en una fila por cuenta** (`account_settings`) en vez de 6 tablas `*Settings`.
5. **Catálogo en línea**: las tablas 1:1 de pago/envío/portada se fusionan en `catalogs`; las listas son `catalog_payment_ways` y `catalog_shipping_methods`.
6. **Crédito** como en Pulpos: `order_debts` (deuda viva) + `order_payments.settles_payment` (cada abono apunta al pago `credit` que liquida) + `unified_debt_payments` para abonos a varias ventas.
7. **Reembolsos** con tablas propias (`order_refunds`, `…_items`, `…_payments`), no pagos negativos.
8. **Partida manual de cotización** (`quotation_items.is_manual`, `manual_cost`) en la misma tabla en vez de `QuotationManualEntryItem`.
9. **Dos libros mayores append-only**: `stock_movements` y `loyalty_movements`, además del saldo materializado (`product_stocks`, `batch_stocks`, `clients.loyalty_points`).
10. **Folios** (`order_number`, `number`): únicos por cuenta (las ventas por serie). `order_series.next_number` y la colección `counters` los asignan los hooks.
11. **Idempotencia**: `orders.request_id` y `purchases.request_id` únicos por cuenta (venta offline y reintentos).

## 5. Seguridad (aprendida de Pulpos)

Pulpos aplica permisos y varias reglas de negocio solo en la interfaz: probé que un usuario sin permisos podía leer, borrar y cambiar configuración por la API. Aquí **todo se aplica en el servidor**, con reglas de PocketBase:

| `kind` | Lectura | Escritura |
|---|---|---|
| `lookup` | cualquier usuario autenticado | nadie (solo migraciones/superusuario) |
| `config` | cualquier usuario de la cuenta | solo `role = admin` |
| `master` | cuenta + permiso (`product.read`, `client.read`…) | cuenta + permiso (`product.create`, `product.edit`…) |
| `doc` | cuenta + permiso + **sucursales del usuario** | **solo el servidor** (rutas/hooks transaccionales) |
| `system` | nadie | nadie (counters, credenciales de Mercado Pago) |

- **Permisos finos**: `users.permissions` → `permissions.key` (`order.create`, `product.read_cost`…); la regla es `role = "admin" || @request.auth.permissions.key ?= "…"`. El catálogo (75 permisos, con dependencias) se siembra desde la matriz de Pulpos, sin facturación/WhatsApp/IA/conciliación.
- **Sucursales**: un usuario no admin solo ve documentos de las ubicaciones de `users.locations` (ventas, compras, gastos, traspasos, ajustes, fabricación y todas sus partidas hijas).
- **Integridad entre cuentas** (`pb_hooks/integrity.pb.js`): en toda escritura (API, rutas y hooks) ninguna relación puede apuntar a un registro de otra cuenta.
- **Usuarios**: un admin crea usuarios solo en su cuenta; nadie se puede dar `role = admin` ni tocar `is_account_owner`; un no admin solo edita sus datos personales.
- **Documentos**: ventas, pagos, deudas, reembolsos, movimientos de stock, cortes, compras, etc. **no se pueden crear ni editar desde el cliente**, porque cada operación toca varias tablas y debe ser atómica.
- La tienda pública no lee colecciones: se servirá desde rutas propias que expongan solo lo necesario.

## 6. Hooks incluidos

- `bootstrap.pb.js`: al crear una cuenta siembra lista "Precio Público", sucursal principal, serie, caja, cliente "Público en General", configuración, métodos de pago, funciones y unidades. Además `POST /api/tpv/signup` crea cuenta + usuario dueño en una transacción.
- `integrity.pb.js`: validación multi-tenant de relaciones.

## 7. Lo que sigue (fase 2: lógica transaccional)

Con las colecciones ya definidas faltan las rutas del servidor que escriben los documentos con las reglas de Pulpos, **ahora validadas en servidor**:

| Ruta | Reglas |
|---|---|
| `POST /api/tpv/orders` (y sync offline por `request_id`) | partidas, descuentos por partida y de carrito, pagos mixtos, crédito con vencimiento, lotes (manual/FEFO), stock negativo según ajuste, **recalcular totales en servidor**, margen mínimo, límite y deuda vencida del cliente, puntos de lealtad |
| abonos, reembolsos, cancelación, eliminación, entrega | `settles_payment`, `unified_debt_payment`, `ORDER_RETURN`/`ORDER_DELETE`, reversas de lealtad |
| compras, gastos y pagos | costo promedio ponderado, deuda, `cash_movements` en efectivo |
| ajustes, traspasos, fabricación | libro de inventario, eventos |
| corte de caja | `prepare` / `finish` con el desglose esperado |
| cotización → venta | `status = sold` |
| tienda en línea (rutas públicas por subdominio) | `validateCart`, `createOrder` con precios del servidor, stock comprometido |
| analítica | ventas por periodo/producto/cliente/categoría/vendedor/pago, inventario |

## 8. Validación

- `node tools/build-schema.mjs` regenera `pb_migrations/*` y `docs/pulpos-schema.md` desde `schema/*.mjs` (no editar la migración a mano).
- `PB_BIN=/ruta/pocketbase tools/smoke.sh` levanta un PocketBase temporal y corre 46 comprobaciones: bootstrap, aislamiento entre negocios, integridad entre cuentas, unicidad con borrado lógico, permisos finos, costos ocultos, acotado por sucursal, documentos de solo servidor e idempotencia.
- Las migraciones son reversibles (`migrate down`).
