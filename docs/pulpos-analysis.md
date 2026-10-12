# Análisis profundo del modelo de datos de Pulpos TPV (v4, sin facturación)

Fuentes, de más a menos confiable:

1. **Cliente web (JS)**: enums de Prisma, lista de los **156 modelos** con sus columnas exactas (`Prisma.<Modelo>ScalarFieldEnum`) y esquemas zod de validación → `pulpos-model-catalog.md` y `pulpos-data/*.json`.
2. **Respuestas reales de la API** de una cuenta de prueba, tras crear datos de cada módulo (productos de cada tipo, ventas contado/crédito/mixtas/pendientes, compras, ajustes, traspaso, fabricación, cotización, promoción, lealtad, corte de caja, usuarios).
3. **Errores de validación** del servidor (zod y errores de negocio), que revelan reglas.

Todo es inferencia sobre el comportamiento observable; los nombres internos del backend pueden diferir. La facturación (CFDI) queda fuera.

> **Correcciones de la v3 (segunda ronda de pruebas):** (d) `products.deleteMany` es **borrado lógico y sí se permite aunque el producto tenga ventas** (las partidas conservan su snapshot); el error `PRODUCT_ALREADY_SOLD_…` del bundle no aplica a ese flujo. (e) El servidor **no aplica** margen mínimo, límite de deuda ni restricción por deuda vencida, ni valida `total` contra las partidas (sección 14). (f) El costo del producto sí cambia con compras: **costo promedio ponderado**. (g) Los gastos sí se pudieron crear (payload capturado de la UI).
>
> **Correcciones de la v2 respecto a la v1:** (a) `OrderPayment.cancelsPaymentId` **no** es una reversa de cobro: apunta al pago `CREDIT` que ese pago liquida. (b) Los reembolsos **no** son pagos negativos: tienen sus propias tablas. (c) Producto y "perfil" son dos tablas 1:1 y las variantes viven en el perfil.

---

## 1. Arquitectura

| Aspecto | Hallazgo |
|---|---|
| Stack | Next.js + **tRPC** (`/api/backend/<router>.<proc>`), **superjson**, **Prisma** sobre **PostgreSQL** (hay columna `tsvector` en `User`). |
| Auth | AWS Cognito (`User.openIdSub` = `sub`). Proveedores `PASSWORD` y `GOOGLE`. |
| Multi-tenant | Casi toda tabla lleva `accountId`. **Catálogos globales** con `accountId = null` (impuestos, regímenes fiscales, cliente "Público en General"). |
| IDs | `cuid` en texto. Además `userFriendlyId` de 7 caracteres (alfabeto sin 0/O/1/I/L) en `Order`, `Quotation` y `Client`. |
| Folios | `orderNumber`, `purchaseNumber`, `quotationNumber`, `transferNumber`, `stockAdjustmentNumber`, `manufacturingOrderNumber`: consecutivos por cuenta (BigInt). Las ventas además por `OrderSeries`. |
| Dinero | `Decimal` serializado como string + `*Currency` (hoy solo `MXN`). |
| Fechas | `createdAt/updatedAt` en todo; **soft delete** `deletedAt` casi universal. `userIdCreatedBy` como auditoría. |
| Idempotencia | `Order.requestId` (UUID), `Purchase.requestId`. Existe un procedimiento aparte `orders.createFromOfflineOrderSync` con la **misma forma** que `orders.create` → el modo offline encola la venta completa y la reenvía. |
| Precisión | La API recibe `Decimal` con transformador `Prisma.Decimal`; el cliente calcula totales y el servidor valida. |
| Analítica | Router `analytics.*` hace agregaciones en servidor: `salesByPeriod/Product/Client/Category/Seller/PaymentMethod`, `inventoryValue`, `inventory`, `stock`, `purchases`, `expenses`. |
| Unidades | `MEASURE_UNITS` = catálogo SAT completo (cientos de claves) + `enabledUnits` por cuenta; `MeasureUnit` ya trae etiquetas singular/plural. |

## 2. Mapa de dominios (156 modelos)

Cuenta/config 30 · Catálogo y precios 13 · Inventario 16 · Ventas 40 · Compras y gastos 10 · Caja 4 · Facturación 8 · Canales, WhatsApp, IA y servicios digitales 30 · Conciliación 5. Detalle completo en `pulpos-model-catalog.md`.

Para un TPV propio **sin** facturación, canales ni IA, el núcleo es de unas **45–50 tablas** (secciones 3 a 8).

## 3. Cuenta, ubicaciones, usuarios y seguridad

- **Account** ← `BusinessProfile` (1:1: nombre, giro `BusinessType`, `typeOfSale` retail/mayoreo, `ticketDetailsId`), `AccountSettings`, `StockSettings`, `OrderSettings`, `QuotationSettings`, `ManufacturingSettings`, `EmailSendingConfiguration`. **Settings por módulo en tablas 1:1**, no un JSON único.
  - `OrderSettings`: `batchStrategy` (MANUAL/AUTOMATIC), `allowSellingOutOfStock`, `notifyInsufficientStockForSale`, `restrictSellingToClientsWithOverdueDebt`, `minProfitMargin` + `minProfitMarginPolicy` (WARN/BLOCK).
  - `StockSettings`: `allowMovingNegativeStock`, `notifyMovingNegativeStock`.
  - `AccountSettings`: `allowPersonalizedPrices`, `defaultClientDebtLimit`, `enabledUnits[]`, métodos de pago permitidos, feature flags (`MANUFACTURING`, `BANK_RECONCILIATIONS`, `WHATSAPP_SALES_CHANNEL`).
- **Location**: `type` BRANCH | WAREHOUSE, `isDefault`, `defaultPriceTypeId`, `addressId`. No encontré un procedimiento `locations.create` (solo `update`/`delete`); la cuenta de prueba tiene 1 sucursal y 0 almacenes y los planes limitan ambos, así que la creación probablemente pasa por el flujo de plan/add-ons (inferido, no probado).
- **Cashier**: caja de una sucursal (`locationId`, `orderSeriesId` opcional). **OrderSeries** (`name`, `nextNumber`, `onlyLocation`, `isDefault`).
- **User**: `role` ADMIN | USER | SUPERADMIN, `isAccountOwner`, `advancedPermissions[]`. Un usuario no-admin recibe **listas de acceso**: `accessBranches`, `accessWarehouses`, `accessCashiers`, `accessPriceTypes` (tablas puente).
- **Seller** (vendedor): propio (`name/surname`) o enlazado a un `User` (`createFromUser`).
- **CustomPaymentMethod**: método propio sobre un método base (`method` = p. ej. FOOD_VOUCHER, `allowsIncome`, `allowsSpend`, `hiddenAt`, `reconciliationSourceId`).
- `PaymentMethod`: CASH, CARD, TRANSFER, CHECK, CREDIT, DEBIT_CARD, PAYMENT_INTERMEDIARY, ELECTRONIC_WALLET, ELECTRONIC_MONEY, SERVICE_CARD, FOOD_VOUCHER.

## 4. Catálogo de productos

**Dos tablas 1:1 con el mismo id**: `ProductProfile` (nombre, slug, descripción, barcode, sku, categoría, marca, `hiddenAt`, `displayInCatalog`, `isSellable`, `isManufactured`, `parentId`, `variantConfig` JSON) y `Product` (`profileId`, `type`, `sellUnit`, `cost`, `costType` NET/GROSS, `isStockable`, `batchesEnabled`, `prescriptionRequired`, `satCategoryCode`). `Product.id == profileId`.

Tipos (`ProductType`): `PRODUCT`, `SERVICE` (no stockable), `COMBO` (kit).

- **Variantes**: el producto "Playera" crea un **perfil padre sin Product** que guarda `variantConfig = [{type:"Talla", values:[CH,M]}]`; cada variante es un `ProductProfile` hijo (`parentId`) **con su propio `Product`**, sku, barcode, costo, precios y stock. Se pueden ocultar (`hiddenAt`), pero al menos una debe quedar visible.
- **Combos**: `ProductCombination(comboId, comboItemId, quantity)`. El combo tiene precio propio; al venderlo se generan partidas hijas (`OrderItemProduct.inComboId`).
- **Fabricados**: `isManufactured` + `ManufacturingBlueprintItem(productId, materialId, quantity)` (receta).
- **Precios**: `CustomPriceType` (lista; una `isDefault` = "Precio Público") + `ProductCustomPrice(productId, customPriceTypeId, price, breakpoint)`. El `breakpoint` implementa precio por volumen ("desde N unidades"); la partida guarda el `priceBreakpoint` aplicado. **Crear una lista crea una `CatalogVariantConfig`** (`path`, `hidden`) para exponerla en la tienda en línea.
- **Impuestos**: `Tax` global (`type` VAT/IEPS/ISR, `percentage`, `isExempt`, `isWithheld`) con M:N a `Product`.
- **Otros**: `ProductCategory` (+ foto), `ProductBrand`, `ProductProfilePhoto`→`Image`, `ProductStorage(productId, locationId, placement)` (ubicación física en almacén), `SatCategory`.
- Reglas: `name` obligatorio; `sku` y `barcode` únicos por cuenta (`SKU_IN_USE`, `BARCODE_IN_USE`); `products.deleteMany` hace **soft delete** (`ProductProfile.deletedAt`) incluso con historial: `products.byId` pasa a 404, desaparece de la búsqueda y las partidas viejas conservan `productId` + snapshot. (El código `PRODUCT_ALREADY_SOLD_QUOTED_TRANSFERRED_OR_PURCHASED` existe en el bundle pero no se disparó en este flujo.) `SKU_IN_USE` y `BARCODE_IN_USE` se aplican en el servidor (409).

## 5. Inventario (el corazón)

- **ProductStock(productId, locationId, stockQuantity, minStockQuantity)**: saldo materializado. **Debe existir la fila por ubicación**: un producto stockable creado sin fila hace fallar `startOrder/finishOrder` de fabricación con `Record to update not found`.
- **Productos con lotes** (`batchesEnabled`): el saldo vive en `ProductBatch(code, expiresAt, fabricatedAt)` + `ProductBatchStock(productBatchId, locationId, stockQuantity)`; **`ProductStock` queda vacío**.
- **StockMovement = bitácora append-only**: `previousQuantity → currentQuantity`, `locationId`, `productProfileId`, `origin`, `originId` (documento origen), `discriminatorType` (BASIC | BATCH | VARIANT) + `discriminatorId` (el lote), `adjustmentReason`.

Orígenes observados con datos reales:

| origin | Efecto verificado |
|---|---|
| `PRODUCT_CREATE` | 0 → stock inicial (también por lote) |
| `PURCHASE_CREATE` | +cantidad comprada (95 → 145) |
| `ORDER_CREATE` | −cantidad vendida (por lote si aplica) |
| `ORDER_RETURN` | +devolución (reembolso) |
| `ORDER_DELETE` | **verificado**: +cantidad al eliminar la venta (72 → 73) |
| `STOCK_ADJUSTMENT` | EXIT resta; **COUNT fija el valor absoluto** (133 → 95) |
| `TRANSFER_SEND` / `TRANSFER_RECEIVE` | −origen al enviar, +destino al recibir (dos movimientos) |
| `MANUFACTURING_MATERIAL_USE` | −materiales al **iniciar** la orden |
| `MANUFACTURING_PRODUCTION` | +producto terminado al **finalizar** |
| `MANUFACTURING_MATERIAL_RETURN` | **verificado**: al cancelar una orden iniciada con `returnMaterials=true` |
| `TRANSFER_DELETE` | **verificado**: borrar un traspaso ya recibido genera **dos** movimientos (revierte destino y origen) |
| `STOCK_ADJUSTMENT_DELETE` | **verificado**: borrar el ajuste restaura el stock (90 → 93) |
| `PURCHASE_DELETE`, `LOCATION_DELETE`, `ADJUSTMENT_CHANGE_STOCK_TRACKING` | solo en el enum; no probados |

- **Traspaso**: `Transfer(origin, destination, status DRAFT→SENT→RECEIVED)` + `TransferItem(quantitySent, quantityReceived, quantityUnit)` + `TransferItemBatchQuantity` + `TransferEvent(type CREATED|SENT|RECEIVED|UPDATED_WHILE_DRAFT|COMMENT, content)`. Origen y destino pueden ser la misma ubicación.
- **Ajuste**: `StockAdjustment(type ENTRY|EXIT|COUNT, status DRAFT|COMPLETED, reason, locationId)` + `StockAdjustmentItem(previousQuantity, inputQuantity, unitCost, unitPrice)` + `…BatchQuantity` + `StockAdjustmentEvent`. En borrador no mueve stock; `complete` lo aplica. Razones: CORRECTION, RECOUNT, EXPIRATION, THEFT_OR_LOSS, DETERIORATION, GIFT, MASSIVE_EDITION, PLAN_LIMITATION.
- **Fabricación**: `ManufacturingOrder(status CREATED→STARTED→FINISHED|CANCELLED, initialQuantity, manufacturedQuantity, startedAt, finishedAt)` + `ManufacturingOrderMaterialItem(materialId, quantity, quantityUnit)` + `ManufacturingOrderEvent(CREATED|STARTED|FINISHED|CANCELLED|COMMENT|USE_MATERIAL_STOCK|RETURN_MATERIAL_STOCK)`. `finishOrder` recibe `manufacturedQuantity` y `returnUnusedMaterials`; `cancelOrder` recibe `returnMaterials`.
- **Reglas de venta contra stock**: vender más de lo disponible devuelve `InsufficientStock` (409) mientras `allowSellingOutOfStock=false`; con `true` se permite y el saldo queda **negativo** (verificado: −3).
- **Lotes**: con `batchStrategy=AUTOMATIC` el servidor reparte la venta por **FEFO** (primero el lote que caduca antes): 45 L → 39 del lote L-2610 + 6 del L-2611, guardado en `OrderItemProductBatchQuantity`. Con `MANUAL` y sin lote indicado también descontó del primer lote. El **stock disponible** = total − comprometido (pedidos pendientes, `committedOrders`).

## 6. Ventas

**Order** (cabecera) → `OrderItemProduct[]` (+ `OrderItemProductBatchQuantity` por lote) → `OrderPayment[]` → `OrderDebt` (0..1) → `OrderRefund[]` → `OrderJournal` (eventos). Más `OrderItemCartDiscount[]`, `OrderItemProductDiscount`, `OrderDeliveryCost`, `OrderOnlinePayment`, `OrderPaymentNotification`.

- **Reglas de pago al crear** (verificadas): la suma de pagos debe **cubrir** el total (`Venta inválida` si falta); el excedente se acepta como cambio; sin pagos queda `PENDING`; `ELECTRONIC_WALLET` es un método más y **no consume puntos de lealtad** (aun así acumuló 2%).
- **Estados independientes**: `paymentStatus` (COMPLETED | PENDING | CANCELLED | REFUNDED) y `shippingStatus` (PENDING | COMPLETED | CANCELLED | RETURNED). Una venta a crédito queda `COMPLETED` aunque tenga deuda: **la deuda no es un estado**.
- `origin`: `POS`, `POS_SAVE_AS_ORDER` (pedido guardado: `payments=[]`, `deliverProducts=false` → `PENDING/PENDING`), `ONLINE_CATALOG`, `DIRECT_INVOICE`. `wayOfPayment`: TO_AGREE_AFTER_PURCHASE, MERCADOPAGO, BANK_TRANSFER, CREDIT, COLLECT_ON_DELIVERY. `shippingMethod`: TO_AGREE_AFTER_PURCHASE, PICKUP, DELIVERY.
- **Snapshot en la partida**: `name`, `unitPrice`, `unitCostNet`, `totalCostNet`, `quantity`, `quantityUnit`, `priceType` (DEFAULT|PERSONALIZED), `priceBreakpoint`, `customPriceTypeId`, `satCategoryCode`, `type` + impuestos aplicados (M:N a `Tax`) + `discountId`. Con eso la analítica calcula margen sin tocar el catálogo.
- **Precio personalizado** (`PERSONALIZED`) lo permite `allowPersonalizedPrices` en la UI. **`minProfitMargin` NO se aplica en el servidor**: con margen 20% y política `BLOCK`, una venta por API a $9 con costo $8.25 se aceptó (igual con `WARN`). Es una regla de interfaz.
- **Pagos**: una fila por método; mixtos permitidos (`CASH 100 + CREDIT 56`). Campos: `method`, `customPaymentMethodId`, `total`, `change`, `cashierId`, `madeAt`, `loyaltyPointsReward`, `unifiedDebtPaymentId`, `orderPaymentNotificationId`, `cancelsPaymentId`.
- **Crédito (modelo exacto)**, verificado:
  1. Se crea `OrderDebt(originalDebt = total de la venta, currentDebt, dueDate, paymentIdCredit)`.
  2. El pago `CREDIT` guarda como `total` **la deuda viva** y **se decrementa** con cada abono.
  3. Cada abono (incluidos los pagos iniciales de la misma venta) es un `OrderPayment` con `cancelsPaymentId = id del pago CREDIT`. Ejemplo real: venta 156 = `CASH 100` + `CREDIT 56`; `originalDebt 156 → 56`; abono `CARD 20` → `currentDebt 36` y `CREDIT.total 36`.
  4. **Abono a varias ventas** (`orders.payOrdersDebt`, verificado): crea **un** `UnifiedDebtPayment` y un `OrderPayment` por venta, todos con el mismo `unifiedDebtPaymentId`; cada `OrderDebt.currentDebt` baja a 0 y la fila `CREDIT.total` queda en 0.
  5. `ClientDebtLimit(clientId, limit)` y `restrictSellingToClientsWithOverdueDebt` **no se aplican en el servidor** (probado: venta a crédito que excedía el límite de $50 y venta a cliente con deuda vencida se aceptaron). `Client.totalDebt` es derivado.
  6. Crédito exige fecha: `Due date is required to register a debt`.
- **Lealtad**: detalle verificado en la sección 18 (puntos por pago, canje como descuento de carrito, tasas por producto/categoría, mínimo de carrito).
- **Descuentos** (dos niveles distintos): *por partida* (`OrderItemProductDiscount` ligado por `OrderItemProduct.discountId`: `type` PERCENTAGE|FIXED, `percentage` —que guarda el monto cuando es FIXED—, `title`, `promotionId`) y *de carrito* (`OrderItemCartDiscount`: `type`, `amount`, `loyaltyPointsUsed`). Regla del servidor verificada: con descuento por partida, **`subtotal` = Σ cantidad × precio unitario sin descuento**, la partida lleva `total` ya con descuento (10% de 30 → 27) y **`Order.discounts` solo suma descuentos de carrito**, nunca los de partida. Las promociones automáticas generan estos mismos registros con `promotionId`.
- **Reembolso** (`orders.refundItems`): `OrderRefund(reason, totalRefunded, subtotalRefunded, cancelledDebt, orderSnapshot)` + `OrderItemRefund(orderItemId, quantityRefunded)` + `…BatchQuantity` + `OrderRefundPayment(method, totalRefunded, cashierId, customPaymentMethodId)`. Genera `ORDER_RETURN` en inventario. **Si `cashierId` va nulo, el reembolso no cuenta en el corte de caja** (observado: `refund = 0` en el corte). `paymentStatus` de la venta no cambió con un reembolso parcial.
- **Cancelación** (`orders.cancel`): solo si el pago está `PENDING` (`Cannot cancel an order whose payment is not pending`). Una venta cobrada se **reembolsa** o se **elimina** (`deleteMany`, con reversa de stock `ORDER_DELETE`).
- `completeShipping` exige fecha de vencimiento si la venta no está pagada completa (crea deuda).
- **Conversión cotización → venta** (verificado): se crea la venta normal con `quotationId` y la cotización pasa a `SOLD`.
- **Cotizaciones**: `Quotation(status CREATED|SOLD, validFrom, expiresAt, clientNote, subtotal, withTaxes, sellerId, customPriceTypeId)` + `QuotationItem` + `QuotationManualEntryItem` (partida libre con costo e impuestos, sin producto) + descuentos + `QuotationJournal`. Cada partida es **producto o entrada manual** (`Quotation item must have either product or manual entry item`). Al vender, `Order.quotationId` enlaza el origen.
- **Promociones**: `Promotion(type CART_TOTAL|SINGLE_TARGET|MULTI_TARGET|MULTI_TARGET_ADVANCED, application MANUAL|AUTOMATIC, validFrom/Until, restrictToClients, daysOfWeekLimitation[])` con subtipos (`CartTotalPromotion`, `SingleTargetPromotion`, `MultiTargetPromotion`: 2x1, 3x2, 2ª al 50%, etc.) y limitaciones por cliente, lista de precios y ubicación. `OrderItemProductDiscount.promotionId` registra cuál se aplicó.
- **Prescription** (farmacia): receta ligada a la venta (`prescriptionNumber`, `prescriberName`, `prescriberLicence`).

## 7. Compras y gastos ("outlays")

- **Purchase** y **Expense** son modelos separados pero se listan unificados (`outlays.getOutlays`, `type` PURCHASE|EXPENSE). Estado **derivado**: `DRAFT`, `HAS_DEBT`, `PAID`.
- `Purchase(status DRAFT|COMPLETED, providerId, locationId, madeAt, total, folio, notes, requestId)` + `PurchaseItem(quantity, quantityUnit, sellUnitFactor, netUnitCost, unitDiscountPercentage)` + `PurchaseItemProductBatchQuantity` (crea `ProductBatch` al comprar productos con lote) + impuestos por partida.
- **Pago o deuda al completar**: `payment` es *o* `{madeAt,total,cashierId?}` (paga ahora, genera `CashMovement` tipo `PURCHASE_PAYMENT` si sale de caja) *o* `{dueDate,totalDebt}` (crea `PurchaseDebt`). `DRAFT` no lleva pago. Pagos posteriores: `PurchasePayment`.
- `Expense(concept, expenseNumber, madeAt, total, locationId, providerId?, folio, notes)` + impuestos (`taxes[]`, M:N implícita con `Tax`; la UI captura el total "con impuestos" y calcula $100 + 16% = $116) + `ExpensePayment` + `ExpenseDebt`. Payload real: pagar ahora = `{concept, madeAt, total, totalCurrency, providerId, locationId, notes, folio, taxes[], paymentMadeAt, method, customPaymentMethodId}`; **posponer** = el mismo sin los campos de pago y con `debtDueDate`. Pagos posteriores: `expenses.registerPayment`; para compras `purchases.registerDebtPayment` (que con `CASH` crea `CashMovement`, con `CARD` no). Estados verificados: `PAID`, `HAS_DEBT`.
- `Provider(name, contactName, contactPhone, contactEmail)`.
- Compra completada → `PURCHASE_CREATE` **y recalcula `Product.cost` como promedio ponderado** (verificado: 71 pzas a $8 + 10 a $10 → $8.247).
- Pagos de compra: `PurchaseDebt(originalDebt, currentDebt, dueDate)` baja con cada `PurchasePayment(method, total, cashMovementId)` (verificado: 180 → 100 tras pagar 80).

## 8. Caja

- **CashMovement(type, amount, details, cashierId, userId)**: `type` = `MANUAL_MOVEMENT` (entrada positiva, retiro **negativo**), `PURCHASE_PAYMENT`, `EXPENSE_PAYMENT`.
- **CashierAudit** (corte) en 2 pasos: `prepare` crea un **borrador** con `periodStart` = último corte (o 1970 en el primero) y `periodEnd` = ahora; `finish` lo cierra (`status` DRAFT → COMPLETED).
- **CashierAuditItem** por método: `totalExpected` (calculado) vs `totalAudited` (contado) + `detail`:

  `orderPayment` + `debtPayment` + `refund` + `outlayPayment` (negativo) + `movementsInTotal` (+ `cashWidthdrawal` negativo) = `total`.

  Verificado: CASH esperado 208 = ventas 58 + abonos 100 + entradas de caja 500 − pago de compra 400 − retiro 50. La deuda pagada con efectivo en el momento de la venta cuenta como `debtPayment`.

## 9. Clientes

`Client(type GENERAL_PUBLIC | ACCOUNT_CLIENT, name, surname, phoneNumber (+52…), email, addressId, fiscalProfileId, defaultPriceTypeId, loyaltyPoints, aiAgentEnabled, lastDebtReminderSentAt)`. El **cliente "Público en General"** es global (sin `accountId`) y evita `clientId` nulo en ventas de mostrador. Portal de clientes y notificaciones de pago (`OrderPaymentNotification` PENDING/ACCEPTED/REJECTED) permiten que el cliente reporte un abono.

## 10. Canales y otros (resumen)

Catálogo en línea (`Catalog`, `CatalogConfiguration`, banners, fotos, `CatalogVariantConfig` por lista de precios, `LocationStockVisibilityToCatalog`, pagos Mercado Pago), WhatsApp (`WhatsAppBusinessCredentials`, `PlatformConversation/Message/Audio`), agente IA (`StoreAgent*`, `AiConversation`), asistente de soporte, servicios digitales/recargas (`ExternalDigitalService*`, `OrderDigitalServiceItem`, GestoPagos), conciliación bancaria (`Reconciliation*`, fuentes BANK/DIGITAL_BANK/CREDIT_CARD ligadas a métodos de pago). Detalle de columnas en el catálogo.

## 11. Decisiones de normalización (resumen)

1. Producto = perfil + producto 1:1; variantes como perfiles hijos.
2. Dos **libros mayores** append-only (stock y lealtad) + saldo materializado.
3. **Snapshot** en partidas (precio, costo, nombre, impuestos).
4. Pagos 1:N por método; crédito = deuda + pagos que "cancelan" el pago CREDIT; **reembolsos en tablas propias**.
5. Estados ortogonales de pago y envío; deuda derivada.
6. Precios en tabla por (producto × lista × breakpoint).
7. Catálogos globales con `accountId` nulo.
8. Settings por módulo 1:1.
9. Eventos (`*Event`, `OrderJournal`) para trazabilidad de documentos con ciclo de vida.
10. Estado derivado (deuda, saldo, `availableStock`, `PAID/HAS_DEBT`) calculado, no almacenado.

## 12. Procedimientos de la API (referencia de flujos)

`orders`: create, createFromOfflineOrderSync, addPayments, payOrderDebt, payOrdersDebt, refundItems, cancel, completeShipping, setShippingMethod, assignClient, assignSeller, editNotes, createComment, updateDueDate, deleteMany, byId, getJournal · `products`: create, updatePrice, bulkUpdateVat, deleteMany, upsertManyFromImport, byId, getStockById, getLastStockMovementsForProduct (máx. 10) · `purchases`/`expenses`: create, update, byId · `stockAdjustments`: create, complete, delete · `transfers`: create, send, receive, update, delete · `manufacturing`: createOrder, startOrder, finishOrder, cancelOrder · `cashierAudits`: prepare, finish, createCashMovement, deleteCashMovement · `quotations`, `promotions` (create/activate/end/delete), `loyaltyProgram`, `clients` (upsertWithFiscalData, import, updateDebtLimit, sendClientDebtReminder), `users`, `sellers`, `providers`, `analytics.*`.

## 13. Sincronización offline (verificado en el JS de la web)

El modo offline **no depende del APK**: el APK (<4 MB) es un contenedor y toda la lógica está en la web. Solo **`/pos`** funciona sin conexión.

| Capa | Detalle |
|---|---|
| Service worker | `/sw.js` estático. Precachea el HTML y los chunks de `/pos` (caché `pulpos-shell:/pos`) y recursos en `pulpos-shell-runtime`. Se registra con scope `/`. |
| Base local | **IndexedDB `pulpos-offline-<accountId>`**, versión 2, una por cuenta (si cambia la cuenta sin recargar, loguea error). |
| Stores | `searchableProducts` (`id`, `normalizedName`, `barcode`, `sku`, `parentId`, `priceTypeIdsWithPrice`, `hasGeneralPrice`; índices por nombre normalizado, barcode, sku), `productPayloads` (`id`, `payload` JSON string), `pendingOrders` (índice por `createdAt`), `meta` (`key`,`value`), `queryCache` (`key`,`value`). |
| Cola de ventas | `PendingOrderRecord`: `id` (uuid = `requestId`), `createdAt`, `accountId`, `cashierId`, `payload` (JSON string de la venta), `lockedUntil`, `attempts`, `lastAttemptAt`, `lastError`, `appVersion`. |
| Caché de lecturas | react-query persistido (máx. **24 h**, con `buster`) solo para: `users.me/getUsers`, `locations.*`, `cashiers.*`, `taxes.getAll`, `accountSettings.*`, `orders.getSettings`, `manufacturing.getSettings`, `accounts.myBusinessProfile`, `customPriceTypes.*`, `loyaltyProgram.get`, `measureUnits.getAccountUnitsForDisplay`. |
| Catálogo local | `useScheduledProductCacheSync` + `products.getProductsChangedSince({since, pagination})` (sincronización **delta**). |
| Envío | `useScheduledOfflineOrderSync`: revisa cada **120 s** y al volver la red; para cada registro llama `orders.createFromOfflineOrderSync` con el `requestId` como cabecera/idempotencia. |
| Reintentos | Backoff exponencial: espera `min(30 s × 2^(intentos−1), 30 min)`; primer intento inmediato. |
| Concurrencia | **Candado por registro**: se "reclama" el registro (`lockedUntil`; considera huérfano tras 120 s) para que dos pestañas no lo envíen a la vez. |
| Seguridad de datos | Salta registros de otra cuenta (`wrong-account`); distingue fallo de red (`isNetworkFailure`) de error de negocio y guarda `lastError`. Tras sincronizar invalida `products.simpleSearch` y `orders.getOrderStats`. |

Para replicarlo: cola local con id idempotente, endpoint de sync con la misma forma que la venta online, deduplicación por `requestId` en servidor y delta de catálogo por `updatedAt`.

## 14. Qué valida el servidor y qué solo la interfaz

**Servidor (probado)**
- `InsufficientStock` (409) si `allowSellingOutOfStock=false`.
- `subtotal` = suma de `total` de partidas; `discounts` = descuentos de carrito calculados (10% de 20 = 2; mandar 5 → `Venta inválida`).
- Precios con **máximo 2 decimales** (33.333 → inválido; 33.33 × 3 sí).
- Suma de pagos ≥ total; crédito requiere `debtDueDate`.
- `SKU_IN_USE`, `BARCODE_IN_USE`; `cancel` solo con pago `PENDING`; teléfono de cliente en formato `+52…`.
- Fabricación exige fila `ProductStock` del material y del producto terminado.

**NO validado por el servidor (probado con API directa)**
- **`total` de la venta**: se aceptó total 14, 16 y 1000 para subtotal 15.
- Margen mínimo (`minProfitMargin`/`BLOCK`), límite de deuda del cliente, restricción por deuda vencida.
- **Permisos finos**: un usuario `USER` sin ningún permiso avanzado pudo leer ventas y productos, crear proveedores, borrar una venta, crear movimientos de caja y **cambiar `OrderSettings`**. Solo `users.getUsers` devolvió `UNAUTHORIZED`. Los permisos se aplican en la UI (oculta menús).
- Lección para tu app: replicar las reglas de negocio **y los permisos en el servidor** (en PocketBase, con `API rules`/hooks), no solo en el cliente. Convendría avisar a Pulpos de la brecha de autorización.

## 15. Matriz de permisos (UI)

Modelo tipo CASL: `subject` + `action`, con `requires` (dependencias) e `implies`. Completo en `pulpos-data/permissions.json`.

| Sujeto | Acciones |
|---|---|
| ORDER | read, create, edit, refund, cancel, export, **createWithCredit**, **applyPersonalizedPrice**, adminDiscount, adminPromotions, manageManualEntry, removeAndAddTaxes, assignSalesman, sellDigitalService, postponeProductsDelivery, saveCounterOrder, registerPaymentAndShipping |
| QUOTATION | read, create, edit, adminPromotions, adminDiscount, removeAndAddTaxes, manageManualEntry, applyPersonalizedPrice |
| PRODUCT | read, create, edit, **readCost, editCost, editStock**, readAllLocationsStock, export, import, PRODUCT_CATEGORY.admin |
| STOCK_ADJUSTMENT | read, manageDraft, complete |
| TRANSFER | read, manageDraft, send, receive |
| PURCHASE/OUTLAY/EXPENSE/PROVIDER | OUTLAY.read, PURCHASE.create, EXPENSE.create, OUTLAY.registerPayment, PROVIDER.admin, OUTLAY.export |
| CASHIER_AUDIT / CASH_MOVEMENT | readCurrent, create, read, export, CASH_MOVEMENT.create |
| CLIENT | read, create, import, edit, **editDebtLimit**, export |
| MANUFACTURING_ORDER | read, create, start, finish, cancel, export |
| REPORT | viewSalesReports, viewFinanceReports, viewInventoryReports, viewPurchasesReports |
| CATALOG, PROMOTION, INVOICE, RECONCILIATION, WHATSAPP, AI_AGENTS | read/admin/enable/customize… |

Los permisos se asignan por usuario junto con listas de acceso a sucursales, almacenes, cajas y listas de precios.

## 16. Planes y add-ons

`subscriptions.getSubscription`: plan `Pro-Mid-2024` (mensual MXN, 14 días de prueba) y **add-ons**: `EXTRA_BRANCH`, `EXTRA_USER`, `MANUFACTURING`, `BANK_RECONCILIATION`, `WHITE_LABEL`, `CATALOG_PLUS`, `AI_SELLER`. Las sucursales/almacenes extra y los usuarios extra son de pago; los *feature flags* (`accountFeatures`) los habilitan. Por eso no hay `locations.create` libre en la cuenta de prueba. Servicios digitales (recargas, pago de servicios) usan un catálogo global sembrado desde GestoPago (`phoneRecharges` con Telcel y otras, `referenceType` PHONE_NUMBER/BARCODE/CUSTOM).

## 17. Catálogo en línea (tienda pública)

**Administración (app principal)**
- `Catalog(subdomain, deactivatedAt)` 1:1 con `CatalogConfiguration` (`name`, `phoneNumber`, redes, `emailContact`, `configProductsWithoutStock` SHOW|HIDE, `configAcquisitionLimit` LIMIT_TO_STOCK|UNLIMITED, `configCategories` SHOW|HIDE, `locationOfOriginId`, `uiVariant` RETAIL|WHOLESALE, `areClientCatalogsEnabled`, `isVolumePricingEnabled`).
- Hijas 1:1 creadas junto con el catálogo: `CatalogOrderPaymentConfiguration` (`wayOfPayments[]`, instrucciones por forma de pago), `CatalogOrderShippingConfiguration` (`shippingMethods[]`, `pickUpAddressId`, `deliveryDefaultPrice`, instrucciones) y `CatalogHomePagePersonalization` (`title`, `mainButtonText`, `showHeroPhoto`, `heroPhotoId`). Además `CatalogBanner`, `CatalogPhoto` (HERO), `LocationStockVisibilityToCatalog` (qué sucursales suman al stock visible) y `MercadoPagoCredentials` por cuenta.
- Procedimientos: `catalog.create({subdomain, name, phoneNumber})`, `updateDomain`, `activate`/`deactivate`, `createBanner`, `createPhoto`, `myCatalog`, `getVariants`.
- Reglas: `subdomain` solo **minúsculas y números** (sin guiones). La URL pública es `https://<subdominio>.pulpos.shop`.
- **Variantes de catálogo**: cada `CustomPriceType` crea una `CatalogVariantConfig(path, hidden, customPriceTypeId)`; la tienda de la lista "Mayoreo" vive en `/mayoreo/` y se muestra solo si `hidden=false`. Los **catálogos por cliente** viven en `/clientes/<código>/` (código = `userFriendlyId` del cliente; `clients.findByCode`).

**Tienda pública (otra app tRPC, sin sesión)**
- Resuelve el negocio por cabeceras, no por cookies: `x-catalog-subdomain`, `x-catalog-variant-slug` (`public` o el `path` de la lista) y `x-catalog-client-code`.
- Procedimientos públicos (solo 8): `catalog.config`, `categories.highlightedCategories`, `products.search({sort:{field:'soldCount',direction}, pagination:{limit,offset}})`, `products.getById`, `clients.findByCode`, `world.getStates({country:'MX'})`, `checkout.validateCart`, `checkout.createOrder`, `checkout.getPaymentUrl` (Mercado Pago; `NOT_FOUND` sin credenciales).
- `validateCart({items:[{quantity, product:{id}}]})` → por producto `available`, `hasEnoughStock`, `currentPrices[]` (con breakpoints). `quantity` viaja como `Decimal`.
- `createOrder({client:{name, mobilePhone, email}, cart:{items, shippingMethod, wayOfPayment}})` → crea una `Order` con `origin = ONLINE_CATALOG`, `paymentStatus/shippingStatus = PENDING`, `userIdCreatedBy = null`.
  - **Los precios y costos los calcula el servidor** desde la BD; el cliente solo manda id y cantidad (a diferencia del POS, que manda todo).
  - **Cliente**: si el teléfono ya existe reutiliza ese `Client` (pedido B con otro nombre/correo no creó otro); si no, crea un `ACCOUNT_CLIENT`. Con la variante `mayoreo` la venta lleva `customPriceTypeId` de esa lista.
  - **Stock**: no se descuenta; se **compromete** (`committedStock`: 4, `availableStock` 64 → 60, `committedOrders[]`). Con `LIMIT_TO_STOCK`, pedir más de lo disponible devuelve `Some items exceed available stock`.
  - Comparte la numeración de folios de la cuenta (`orderNumber` 44, 45…).
- Cierre del ciclo (administrador): el pedido aparece en `orders.getOrders` y en `getNonDeliveredOrderStats`; se cobra con `addPayments` y se entrega con `completeShipping`, momento en que baja el stock real.
- Cloudflare rechaza user-agents genéricos (error 1010); un navegador o `curl` pasan.

## 18. Programa de lealtad (verificado)

- **Configuración** (`loyaltyProgram.create/update`, formulario): `rewardPercentage` 0–100, `productSpecificRewards[{productProfileId, rewardPercentage}]`, `categorySpecificRewards[{categoryId, rewardPercentage}]`, `minCartTotalLimitation` (nullable), `priceListLimitationIds[]`, `locationLimitationIds[]`; `activate`/`deactivate` (`deactivatedAt`). Constantes del cliente: **1 punto = $1** (`LOYALTY_POINTS_MULTIPLIER = 1`), mínimo acreditable 0.01.
- **Solo clientes con cuenta** (`ACCOUNT_CLIENT`) acumulan; "Público en General" no.
- **Tasa por venta**: se calcula **partida por partida** (producto específico → categoría → general) y se guarda como snapshot `Order.loyaltyPointsRewardPercentage` = puntos ÷ total. Ejemplo real: servicio $100 al 10% + jugo $50 de categoría al 5% → 12.5 pts → 8.33%. Venta bajo el `minCartTotalLimitation` → 0%.
- **Importante**: el servidor usa el `product.connect.id` y el **`categoryId` que manda el POS** en cada partida; si el cliente no manda la categoría, esa partida cae a la tasa general (probado: 11 en vez de 12.5).
- **Acumulación**: se paga **por cada `OrderPayment`** (`loyaltyPointsReward = pago × tasa`), no por la venta; un abono posterior de deuda también suma (ej.: abono de $20 → 0.4 pts). Cada cambio de saldo escribe un `LoyaltyProgramMovement(origin, previousQuantity, currentQuantity, orderId)`.
- **Canje (era el pendiente)**: gastar puntos es un **descuento de carrito** `OrderItemCartDiscount{type: FIXED, amount, loyaltyPointsUsed}`; genera `ORDER_SPEND` (saldo 4.58 → 3.58 al canjear 1 pt por $1) y la venta nueva acumula sobre el total ya con descuento (14 × 2% = 0.28). `ELECTRONIC_WALLET` **no** es el canje (solo es otro método de pago).
- **Orígenes de movimiento** (`LoyaltyProgramMovementOrigin`): ganar = ORDER_EARN, ORDER_PAYMENT_EARN, ORDER_ASSIGN_CLIENT, reversas de gasto; gastar = ORDER_SPEND, ORDER_REMOVE_CLIENT, ORDER_PAYMENT_DELETE_REVERT, ORDER_DELETE_EARN_REVERT, ORDER_REFUND_EARN_REVERT; más ADJUSTMENT (`loyaltyProgram.updateClientPoints{clientId, newQuantity, adjustmentReason}`).
- Las reversas (borrar/reembolsar una venta devuelve o quita puntos) existen como orígenes; **no las probé**.

## 19. Pendiente por confirmar

- **APK**: no pude descargarlo (apkpure detrás de Cloudflare). No es necesario para el offline (está en la web).
- Reversas de lealtad al reembolsar o eliminar una venta; prioridad entre recompensa de producto vs categoría cuando ambas aplican a la misma partida.
- Pago de pedidos online con Mercado Pago (`getPaymentUrl`) y flujo de `wayOfPayment`≠ "por acordar": requiere credenciales de Mercado Pago.
- Banners y fotos del catálogo (subida de imágenes: `images.getUploadUrl` + `catalog.createBanner/createPhoto`); no probé la subida.
- Importaciones masivas y borrar sucursal: **fuera de alcance** por decisión del proyecto.
- Segunda sucursal/almacén (add-on de pago).
- Columnas sin tipo: el catálogo ya trae tipos del esquema oficial (526 columnas) más **523 inferidas de respuestas reales** (marcadas `~`); quedan 399 sin dato, casi todas en modelos de facturación, IA, WhatsApp y conciliación.
