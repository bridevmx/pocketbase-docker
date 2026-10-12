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

94 colecciones, 0 campos `json`.

## 2. Convenciones

- Nombres en inglés, `snake_case`. Valores de `select` en minúsculas (`cash`, `debit_card`…).
- **Una instancia de PocketBase = un negocio** (ver sección 2.1). No existe columna `account`: el aislamiento entre negocios es la propia instancia (contenedor, base y archivos separados).
- **Borrado lógico**: `deleted_at` (date) donde Pulpos usa `deletedAt`. Los índices únicos de SKU, código de barras, lotes y ruta de lista de precios son parciales (`… WHERE deleted_at = ""`), así que un SKU liberado se puede reutilizar.
- `created` / `updated` en todas las colecciones (autodate).
- **Dinero y cantidades**: `number` (float64). La moneda es una sola por cuenta (`accounts.currency`, hoy `mxn`), no una columna por monto. El redondeo (2 decimales de precio, costo promedio con más precisión) lo aplican los hooks.
- **`bool` y `number` nunca son `required`**: en PocketBase `required` significa `true` / distinto de 0.
- **Nulos numéricos**: PocketBase no distingue 0 de vacío. Convenciones: `default_client_debt_limit = 0` ⇒ sin límite; `clients.uses_default_debt_limit` indica si usa el del negocio; `account_settings.min_profit_margin_enabled` activa el margen mínimo; `loyalty_programs.min_cart_total = 0` ⇒ sin mínimo.
- Relaciones múltiples (`rels`) solo para M:N puras sin atributos (impuestos del producto, accesos del usuario, listas/sucursales de una promoción). Si la relación lleva datos, es una colección propia.

### 2.1 Modelo SaaS: una instancia por negocio

| Pieza | Responsabilidad |
|---|---|
| **Panel de control** (fuera de este repo; hoy `tools/provision-business.sh` + `tools/set-license.mjs`) | alta de instancias, subdominio, plan y cobro, suspensión, respaldos, despliegue de migraciones |
| **Instancia** (este repo) | un negocio: sus usuarios, datos y reglas |
| **`license`** (1 fila) | plan, estado (`trial`/`active`/`past_due`/`suspended`/`cancelled`), vencimientos y **topes ya calculados** (usuarios, sucursales, almacenes). Solo la escribe el superusuario (el panel) |
| **`license_features`** | funciones habilitadas (plan + add-ons) |

La instancia solo **aplica** la licencia: prueba o pago vencido (con 3 días de gracia) ⇒ solo lectura (`402`); `suspended`/`cancelled` ⇒ no inicia sesión y las sesiones abiertas reciben `403`; los topes impiden crear más usuarios o sucursales de las contratadas. Código de error de máquina = nombre de la clave en `data` (`trial_expired`, `payment_overdue`, `plan_limit_users`…).
Alta del negocio: `GET/POST /api/tpv/setup` (una sola vez). Si el panel creó la licencia antes, se respeta; si no, arranca en prueba de 14 días.
Despliegue: `deploy/docker-compose.business.yml` (sin puertos publicados, 256 MB) + `deploy/Caddyfile` (comodín `<slug>.tpv.ejemplo.com` → `pb-<slug>`).

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
| `config` | cualquier usuario autenticado | solo `role = admin` |
| `master` | permiso (`product.read`, `client.read`…) | permiso (`product.create`, `product.edit`…) |
| `doc` | permiso + **sucursales del usuario** | **solo el servidor** (rutas/hooks transaccionales) |
| `system` | nadie | nadie (counters, credenciales de Mercado Pago) |
| `custom` | autenticados | `business`/`pos_settings`: admin; `license`/`license_features`: solo superusuario |

- **Permisos finos**: `users.permissions` → `permissions.key` (`order.create`, `product.read_cost`…); la regla es `role = "admin" || @request.auth.permissions.key ?= "…"`. El catálogo (75 permisos, con dependencias) se siembra desde la matriz de Pulpos, sin facturación/WhatsApp/IA/conciliación.
- **Sucursales**: un usuario no admin solo ve documentos de las ubicaciones de `users.locations` (ventas, compras, gastos, traspasos, ajustes, fabricación y todas sus partidas hijas).
- **Usuarios**: nadie se puede dar `role = admin` ni tocar `is_owner`; el dueño no se puede borrar; un no admin solo edita sus datos personales.
- **Documentos**: ventas, pagos, deudas, reembolsos, movimientos de stock, cortes, compras, etc. **no se pueden crear ni editar desde el cliente**, porque cada operación toca varias tablas y debe ser atómica.
- La tienda pública no lee colecciones: se servirá desde rutas propias que expongan solo lo necesario.

## 6. Hooks incluidos

- `bootstrap.pb.js`: `GET/POST /api/tpv/setup` — alta única del negocio: negocio + licencia (si el panel no la creó) + dueño admin + valores por defecto (lista "Precio Público", sucursal principal, serie, caja, cliente "Público en General", configuración, métodos de pago, unidades).
- `license.pb.js`: guardia de escrituras por API (licencia y topes), bloqueo de login y de sesiones abiertas si la licencia está suspendida/cancelada, y `GET /api/tpv/subscription`.
- `lib/`: `license.js` (estado, topes, funciones), `guard.js`, `bootstrap.js`. Los handlers de PocketBase no ven funciones declaradas a nivel de archivo, por eso la lógica vive en módulos que se cargan con `require()` dentro del handler.

## 7. Estado de la lógica transaccional

**Hecho — ventas** ([`pulpos-sales-api.md`](pulpos-sales-api.md)): crear venta (contado, mixta, crédito, pedido guardado, offline con `request_id`), cobro posterior, entrega, abonos (uno o varios), reembolsos, cancelación y borrado, con inventario FEFO, lealtad, descuentos y las reglas de negocio validadas en servidor.

**Pendiente (en este orden sugerido):**

| Fase | Contenido |
|---|---|
| Inventario | ajustes (con carga de inventario inicial), traspasos, compras y gastos (costo promedio ponderado, deuda, `cash_movements`), fabricación |
| Caja | `prepare` / `finish` del corte con el desglose esperado |
| Cotizaciones | alta con totales y conversión a venta |
| Tienda en línea | rutas públicas por subdominio: `validateCart`, `createOrder` con precios del servidor y stock comprometido |
| Analítica | ventas por periodo/producto/cliente/categoría/vendedor/pago, inventario y margen |
| Impuestos y promociones | `with_taxes`, promociones automáticas |

## 8. Validación

- `node tools/build-schema.mjs` regenera `pb_migrations/*` y `docs/pulpos-schema.md` desde `schema/*.mjs` (no editar la migración a mano).
- `PB_BIN=/ruta/pocketbase tools/smoke.sh` levanta un PocketBase temporal y corre las comprobaciones (69 de instancia + 85 de ventas): alta única, unicidad con borrado lógico, permisos finos, costos ocultos, acotado por sucursal, documentos de solo servidor, idempotencia, topes de licencia, prueba/pago vencido, suspensión.
- Las migraciones son reversibles (`migrate down`).
