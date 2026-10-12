# Análisis profundo del modelo de datos de Pulpos TPV (v2, sin facturación)

Fuentes, de más a menos confiable:

1. **Cliente web (JS)**: enums de Prisma, lista de los **156 modelos** con sus columnas exactas (`Prisma.<Modelo>ScalarFieldEnum`) y esquemas zod de validación → `pulpos-model-catalog.md` y `pulpos-data/*.json`.
2. **Respuestas reales de la API** de una cuenta de prueba, tras crear datos de cada módulo (productos de cada tipo, ventas contado/crédito/mixtas/pendientes, compras, ajustes, traspaso, fabricación, cotización, promoción, lealtad, corte de caja, usuarios).
3. **Errores de validación** del servidor (zod y errores de negocio), que revelan reglas.

Todo es inferencia sobre el comportamiento observable; los nombres internos del backend pueden diferir. La facturación (CFDI) queda fuera.

> **Correcciones respecto a la v1:** (a) `OrderPayment.cancelsPaymentId` **no** es una reversa de cobro: apunta al pago `CREDIT` que ese pago liquida. (b) Los reembolsos **no** son pagos negativos: tienen sus propias tablas. (c) Producto y "perfil" son dos tablas 1:1 y las variantes viven en el perfil.

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
- Reglas: `name` obligatorio; `sku` y `barcode` únicos por cuenta (`SKU_IN_USE`, `BARCODE_IN_USE`); no se borra un producto ya vendido, cotizado, transferido o comprado (`PRODUCT_ALREADY_SOLD_QUOTED_TRANSFERRED_OR_PURCHASED`).

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
| `ORDER_DELETE` | reversa al eliminar venta (solo visto en el enum; no probado) |
| `STOCK_ADJUSTMENT` | EXIT resta; **COUNT fija el valor absoluto** (133 → 95) |
| `TRANSFER_SEND` / `TRANSFER_RECEIVE` | −origen al enviar, +destino al recibir (dos movimientos) |
| `MANUFACTURING_MATERIAL_USE` | −materiales al **iniciar** la orden |
| `MANUFACTURING_PRODUCTION` | +producto terminado al **finalizar** |
| `MANUFACTURING_MATERIAL_RETURN` | devolución de material no usado |
| `PURCHASE_DELETE`, `TRANSFER_DELETE`, `LOCATION_DELETE`, `STOCK_ADJUSTMENT_DELETE`, `ADJUSTMENT_CHANGE_STOCK_TRACKING` | solo en el enum; no probados |

- **Traspaso**: `Transfer(origin, destination, status DRAFT→SENT→RECEIVED)` + `TransferItem(quantitySent, quantityReceived, quantityUnit)` + `TransferItemBatchQuantity` + `TransferEvent(type CREATED|SENT|RECEIVED|UPDATED_WHILE_DRAFT|COMMENT, content)`. Origen y destino pueden ser la misma ubicación.
- **Ajuste**: `StockAdjustment(type ENTRY|EXIT|COUNT, status DRAFT|COMPLETED, reason, locationId)` + `StockAdjustmentItem(previousQuantity, inputQuantity, unitCost, unitPrice)` + `…BatchQuantity` + `StockAdjustmentEvent`. En borrador no mueve stock; `complete` lo aplica. Razones: CORRECTION, RECOUNT, EXPIRATION, THEFT_OR_LOSS, DETERIORATION, GIFT, MASSIVE_EDITION, PLAN_LIMITATION.
- **Fabricación**: `ManufacturingOrder(status CREATED→STARTED→FINISHED|CANCELLED, initialQuantity, manufacturedQuantity, startedAt, finishedAt)` + `ManufacturingOrderMaterialItem(materialId, quantity, quantityUnit)` + `ManufacturingOrderEvent(CREATED|STARTED|FINISHED|CANCELLED|COMMENT|USE_MATERIAL_STOCK|RETURN_MATERIAL_STOCK)`. `finishOrder` recibe `manufacturedQuantity` y `returnUnusedMaterials`; `cancelOrder` recibe `returnMaterials`.
- **Reglas de venta contra stock**: vender más de lo disponible devuelve `InsufficientStock` (409) mientras `allowSellingOutOfStock=false`. El **stock disponible** = total − comprometido (pedidos pendientes, `committedOrders`).

## 6. Ventas

**Order** (cabecera) → `OrderItemProduct[]` (+ `OrderItemProductBatchQuantity` por lote) → `OrderPayment[]` → `OrderDebt` (0..1) → `OrderRefund[]` → `OrderJournal` (eventos). Más `OrderItemCartDiscount[]`, `OrderItemProductDiscount`, `OrderDeliveryCost`, `OrderOnlinePayment`, `OrderPaymentNotification`.

- **Estados independientes**: `paymentStatus` (COMPLETED | PENDING | CANCELLED | REFUNDED) y `shippingStatus` (PENDING | COMPLETED | CANCELLED | RETURNED). Una venta a crédito queda `COMPLETED` aunque tenga deuda: **la deuda no es un estado**.
- `origin`: `POS`, `POS_SAVE_AS_ORDER` (pedido guardado: `payments=[]`, `deliverProducts=false` → `PENDING/PENDING`), `ONLINE_CATALOG`, `DIRECT_INVOICE`. `wayOfPayment`: TO_AGREE_AFTER_PURCHASE, MERCADOPAGO, BANK_TRANSFER, CREDIT, COLLECT_ON_DELIVERY. `shippingMethod`: TO_AGREE_AFTER_PURCHASE, PICKUP, DELIVERY.
- **Snapshot en la partida**: `name`, `unitPrice`, `unitCostNet`, `totalCostNet`, `quantity`, `quantityUnit`, `priceType` (DEFAULT|PERSONALIZED), `priceBreakpoint`, `customPriceTypeId`, `satCategoryCode`, `type` + impuestos aplicados (M:N a `Tax`) + `discountId`. Con eso la analítica calcula margen sin tocar el catálogo.
- **Precio personalizado** (`PERSONALIZED`) permitido por `allowPersonalizedPrices`; vender bajo costo solo se bloquea si `minProfitMargin` está configurado (probado: sin margen mínimo, se permitió vender a $5 un producto con costo $8).
- **Pagos**: una fila por método; mixtos permitidos (`CASH 100 + CREDIT 56`). Campos: `method`, `customPaymentMethodId`, `total`, `change`, `cashierId`, `madeAt`, `loyaltyPointsReward`, `unifiedDebtPaymentId`, `orderPaymentNotificationId`, `cancelsPaymentId`.
- **Crédito (modelo exacto)**, verificado:
  1. Se crea `OrderDebt(originalDebt = total de la venta, currentDebt, dueDate, paymentIdCredit)`.
  2. El pago `CREDIT` guarda como `total` **la deuda viva** y **se decrementa** con cada abono.
  3. Cada abono (incluidos los pagos iniciales de la misma venta) es un `OrderPayment` con `cancelsPaymentId = id del pago CREDIT`. Ejemplo real: venta 156 = `CASH 100` + `CREDIT 56`; `originalDebt 156 → 56`; abono `CARD 20` → `currentDebt 36` y `CREDIT.total 36`.
  4. `UnifiedDebtPayment` agruparía un abono que cubre varias ventas (inferido por nombre y por `payOrdersDebt`; no probado); `ClientDebtLimit(clientId, limit/useDefaultLimit)` limita el crédito por cliente (default en `AccountSettings`). `Client.totalDebt` es derivado.
- **Lealtad** (`LoyaltyProgram`: `rewardPercentage`, `minCartTotalLimitation`, recompensas por producto/categoría, limitaciones por lista de precios y ubicación): el puntaje se otorga **por pago**, no por venta (`OrderPayment.loyaltyPointsReward = pago × %`). `LoyaltyProgramMovement(previousQuantity, currentQuantity, origin, orderId)` es otro libro mayor (ORDER_EARN, ORDER_SPEND, ORDER_PAYMENT_EARN, reversas, ADJUSTMENT). `Client.loyaltyPoints` es el saldo.
- **Reembolso** (`orders.refundItems`): `OrderRefund(reason, totalRefunded, subtotalRefunded, cancelledDebt, orderSnapshot)` + `OrderItemRefund(orderItemId, quantityRefunded)` + `…BatchQuantity` + `OrderRefundPayment(method, totalRefunded, cashierId, customPaymentMethodId)`. Genera `ORDER_RETURN` en inventario. **Si `cashierId` va nulo, el reembolso no cuenta en el corte de caja** (observado: `refund = 0` en el corte). `paymentStatus` de la venta no cambió con un reembolso parcial.
- **Cancelación** (`orders.cancel`): solo si el pago está `PENDING` (`Cannot cancel an order whose payment is not pending`). Una venta cobrada se **reembolsa** o se **elimina** (`deleteMany`, con reversa de stock `ORDER_DELETE`).
- `completeShipping` exige fecha de vencimiento si la venta no está pagada completa (crea deuda).
- **Cotizaciones**: `Quotation(status CREATED|SOLD, validFrom, expiresAt, clientNote, subtotal, withTaxes, sellerId, customPriceTypeId)` + `QuotationItem` + `QuotationManualEntryItem` (partida libre con costo e impuestos, sin producto) + descuentos + `QuotationJournal`. Cada partida es **producto o entrada manual** (`Quotation item must have either product or manual entry item`). Al vender, `Order.quotationId` enlaza el origen.
- **Promociones**: `Promotion(type CART_TOTAL|SINGLE_TARGET|MULTI_TARGET|MULTI_TARGET_ADVANCED, application MANUAL|AUTOMATIC, validFrom/Until, restrictToClients, daysOfWeekLimitation[])` con subtipos (`CartTotalPromotion`, `SingleTargetPromotion`, `MultiTargetPromotion`: 2x1, 3x2, 2ª al 50%, etc.) y limitaciones por cliente, lista de precios y ubicación. `OrderItemProductDiscount.promotionId` registra cuál se aplicó.
- **Prescription** (farmacia): receta ligada a la venta (`prescriptionNumber`, `prescriberName`, `prescriberLicence`).

## 7. Compras y gastos ("outlays")

- **Purchase** y **Expense** son modelos separados pero se listan unificados (`outlays.getOutlays`, `type` PURCHASE|EXPENSE). Estado **derivado**: `DRAFT`, `HAS_DEBT`, `PAID`.
- `Purchase(status DRAFT|COMPLETED, providerId, locationId, madeAt, total, folio, notes, requestId)` + `PurchaseItem(quantity, quantityUnit, sellUnitFactor, netUnitCost, unitDiscountPercentage)` + `PurchaseItemProductBatchQuantity` (crea `ProductBatch` al comprar productos con lote) + impuestos por partida.
- **Pago o deuda al completar**: `payment` es *o* `{madeAt,total,cashierId?}` (paga ahora, genera `CashMovement` tipo `PURCHASE_PAYMENT` si sale de caja) *o* `{dueDate,totalDebt}` (crea `PurchaseDebt`). `DRAFT` no lleva pago. Pagos posteriores: `PurchasePayment`.
- `Expense(concept, madeAt, total, locationId, providerId?)` + `ExpensePayment` + `ExpenseDebt` (columnas del catálogo). **No pude crear un gasto** por API (la validación es una unión opaca), así que su flujo se asume análogo al de compras pero sin confirmar.
- `Provider(name, contactName, contactPhone, contactEmail)`.
- Compra completada → movimiento `PURCHASE_CREATE`. **No verificado** si actualiza `Product.cost` (la compra de prueba usó el mismo costo que ya tenía el producto).

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

## 13. Pendiente por confirmar

- Fórmulas exactas: impuestos incluidos vs añadidos, redondeo, orden de descuentos y cálculo de `minProfitMargin`.
- Cálculo del costo del producto tras una compra (último costo vs promedio).
- Reglas de `batchStrategy=AUTOMATIC` (FEFO) y cómo se reparte `OrderItemProductBatchQuantity`.
- Conversión cotización → venta, `payOrdersDebt`/`UnifiedDebtPayment`, cancelaciones de compras y traspasos.
- Esquema de sincronización offline: solo se confirmó que `createFromOfflineOrderSync` valida la misma forma que `orders.create`; no se vio la cola local ni cómo se resuelven conflictos.
- Columnas sin tipo en el catálogo (65 modelos): se deducen de muestras y se completarán con más capturas.
