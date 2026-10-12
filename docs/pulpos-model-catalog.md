# Catálogo de modelos de Pulpos (156 tablas)

Derivado del cliente web: `Prisma.<Modelo>ScalarFieldEnum` (columnas exactas) + esquemas zod del bundle (tipos) + respuestas reales de la API.
Tipos con `?` = nullable. Tipos con `~` = **inferidos de respuestas reales** de la API (no del esquema oficial; `decimal` = string numérico). `—` = sin dato de tipo todavía. Las relaciones son **inferidas por nombre de columna** y corregidas a mano donde se verificó con datos reales.

## Índice de dominios

- **Cuenta, usuarios y configuración** — 30 modelos: `State`, `AccountSubscriptionStatus`, `Account`, `OnboardingStatus`, `User`, `ResellerProfile`, `BusinessProfile`, `Location`, `TicketDetails`, `Address`, `Image`, `File`, `AccountSettings`, `ManufacturingSettings`, `StockSettings`, `QuotationSettings`, `OrderSettings`, `UpgradePromotion`, `NativeReview`, `PulposAppSuggestion`, `InvoicingSettings`, `EmailSendingConfiguration`, `Logo`, `AccountAffiliation`, `AffiliationPayment`, `UserBankAccount`, `ClientsPaymentsBankAccount`, `PulposAppCommunication`, `Seller`, `PulposGlobalConfiguration`
- **Catálogo de productos y precios** — 13 modelos: `ProductCategory`, `ProductBrand`, `CustomPriceType`, `ProductCustomPrice`, `Product`, `ProductProfile`, `ProductCombination`, `ManufacturingBlueprintItem`, `Tax`, `SatCategory`, `MeasureUnit`, `ProductProfilePhoto`, `ProductCategoryPhoto`
- **Inventario** — 16 modelos: `ProductStock`, `ProductStorage`, `ProductBatchStock`, `ProductBatch`, `StockMovement`, `Transfer`, `TransferItem`, `TransferItemBatchQuantity`, `TransferEvent`, `StockAdjustment`, `StockAdjustmentItem`, `StockAdjustmentItemBatchQuantity`, `StockAdjustmentEvent`, `ManufacturingOrder`, `ManufacturingOrderMaterialItem`, `ManufacturingOrderEvent`
- **Ventas** — 40 modelos: `CustomPaymentMethod`, `OrderPayment`, `OrderPaymentNotification`, `UnifiedDebtPayment`, `OrderOnlinePayment`, `OrderItemProductBatchQuantity`, `OrderItemProduct`, `OrderDeliveryCost`, `OrderItemProductDiscount`, `OrderItemCartDiscount`, `Order`, `OrderSeries`, `OrderRefund`, `OrderItemRefundBatchQuantity`, `OrderItemRefund`, `OrderRefundPayment`, `OrderDebt`, `OrderJournal`, `QuotationJournal`, `ClientDebtLimit`, `Client`, `Quotation`, `QuotationItem`, `QuotationManualEntryItem`, `QuotationItemDiscount`, `QuotationCartDiscount`, `Prescription`, `Promotion`, `PromotionClientLimitation`, `PromotionPriceListLimitation`, `PromotionLocationLimitation`, `CartTotalPromotion`, `SingleTargetPromotion`, `MultiTargetPromotion`, `LoyaltyProgram`, `LoyaltyProgramPriceListLimitation`, `LoyaltyProgramLocationLimitation`, `LoyaltyProgramProductSpecificReward`, `LoyaltyProgramCategorySpecificReward`, `LoyaltyProgramMovement`
- **Compras y gastos** — 10 modelos: `Purchase`, `PurchaseDebt`, `PurchasePayment`, `PurchaseItemProductBatchQuantity`, `PurchaseItem`, `Expense`, `ExpensePayment`, `ExpenseDebt`, `Provider`, `OutlayInvoiceFile`
- **Caja** — 4 modelos: `Cashier`, `CashierAudit`, `CashierAuditItem`, `CashMovement`
- **Facturación (fuera de alcance por ahora)** — 8 modelos: `FiscalProfile`, `SelfInvoiceProfile`, `FiscalRegime`, `FiscalUseCase`, `Invoice`, `InvoiceTypeToSeries`, `PulposSubscriptionInvoice`, `GlobalInvoice`
- **Canales: catálogo, WhatsApp, IA, servicios digitales** — 30 modelos: `StoreAgentKnowledgeFile`, `Catalog`, `CatalogConfiguration`, `LocationStockVisibilityToCatalog`, `CatalogOrderShippingConfiguration`, `CatalogOrderPaymentConfiguration`, `MercadoPagoCredentials`, `CatalogHomePagePersonalization`, `CatalogPhoto`, `CatalogBanner`, `CatalogVariantConfig`, `StoreAgentConfiguration`, `StoreAgentAccessToLocation`, `StoreAgentFAQ`, `StoreAgentDelegationPolicy`, `AiConversation`, `AssistantConversation`, `AssistantMessage`, `AssistantMessageAttachment`, `GestoPagosCredentials`, `ExternalDigitalServiceConfiguration`, `ExternalDigitalServicePaymentNotification`, `ExternalDigitalService`, `OrderDigitalServiceItem`, `GestoPagosRequestLog`, `WhatsAppBusinessCredentials`, `PlatformConversation`, `PlatformMessage`, `PlatformAudio`, `BillableAgentConversation`
- **Conciliación bancaria** — 5 modelos: `Reconciliation`, `ReconciliationMovement`, `ReconciliationMovementToPulposTransaction`, `ReconciliationSource`, `PaymentMethodReconciliationSource`


## Cuenta, usuarios y configuración

### State

| columna | tipo | relación |
|---|---|---|
| `country` | — |  |
| `code` | — |  |

### AccountSubscriptionStatus

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `status` | — |  |
| `trialEndAt` | — |  |
| `activatedAt` | — |  |
| `dueSince` | — |  |
| `cancelledAt` | — |  |
| `pausedAt` | — |  |
| `hasAddedCard` | — |  |
| `paysByTransfer` | — |  |
| `subscription` | — |  |
| `firstActivatedAt` | — |  |

### Account

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `chargebeeSubscriptionId` | string |  |
| `chargebeeCustomerId` | string |  |
| `hubSpotContactId` | string |  |
| `amplitudeId` | ~string |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountType` | ~enum AccountType |  |

### OnboardingStatus

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `hasFinishedExploration` | — |  |
| `hasFinishedConfiguration` | — |  |
| `dismissedFeatures` | — |  |

### User

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `openIdSub` | ~string |  |
| `accountId` | ~string | Account |
| `email` | ~string |  |
| `name` | ~string |  |
| `surname` | ~string |  |
| `phoneNumber` | ~string |  |
| `isAccountOwner` | ~boolean |  |
| `lastLogin` | ~datetime? |  |
| `seenReleaseStartDate` | — |  |
| `updatesHubLastSeenAt` | ~datetime |  |
| `updatesHubLastDismissedAt` | ~datetime |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `slug` | ~string |  |
| `role` | ~enum Role |  |
| `advancedPermissions` | ~array/json |  |
| `defaultPriceTypeId` | — | CustomPriceType |
| `authProviders` | ~array/json |  |

### ResellerProfile

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `userId` | — | User |
| `addressId` | — | Address |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `personalIdentityCode` | — |  |
| `personalIdentityCodeHash` | — |  |
| `commissionPercentage` | — |  |
| `needsToBeActiveToReceivePayments` | — |  |

### BusinessProfile

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `businessName` | string |  |
| `businessType` | enum BusinessType |  |
| `businessTypeCustom` | string? |  |
| `avgMonthlyBilling` | enum AvgMonthlyBilling |  |
| `typeOfSale` | enum TypeOfSale? |  |
| `fiscalCode` | string? |  |
| `numberOfStores` | decimal |  |
| `numberOfEmployees` | ~decimal |  |
| `ticketDetailsId` | ~string | TicketDetails |
| `phoneNumber` | — |  |
| `email` | — |  |
| `selfInvoiceProfileId` | — | SelfInvoiceProfile |
| `accountantsEmails` | ~array/json |  |

### Location

| columna | tipo | relación |
|---|---|---|
| `name` | ~string |  |
| `id` | ~string |  |
| `phoneNumber` | ~string? |  |
| `email` | ~string? |  |
| `type` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `isDefault` | ~boolean |  |
| `defaultPriceTypeId` | ~string? | CustomPriceType |
| `addressId` | — | Address |
| `accountId` | ~string? | Account |
| `userIdCreatedBy` | ~string? | User |
| `invoicingSettingsId` | ~string | InvoicingSettings |

### TicketDetails

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `header` | string? |  |
| `footer` | string? |  |
| `printOnSale` | boolean |  |
| `printOnCounterOrder` | boolean |  |
| `printDuplicate` | boolean |  |
| `logoId` | — | Logo |
| `printingMode` | enum PrintingMode |  |

### Address

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `streetAddress` | string? |  |
| `streetNumber` | string? |  |
| `unitNumber` | string? |  |
| `postalCode` | string? |  |
| `neighbourhood` | string? |  |
| `district` | string? |  |
| `city` | string? |  |
| `country` | — |  |
| `stateCode` | string? |  |

### Image

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `accountId` | ~string | Account |
| `userIdCreatedBy` | ~string | User |
| `url` | ~string |  |
| `filename` | ~string |  |
| `externalId` | ~string |  |
| `imageType` | ~enum ImageType |  |
| `status` | ~enum ImageStatus |  |
| `metadata` | ~json |  |

### File

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `fileName` | string |  |
| `mimeType` | string |  |
| `bucket` | string |  |
| `key` | string |  |
| `url` | string |  |
| `storagePath` | string |  |
| `sizeBytes` | number |  |
| `status` | enum FileStatus |  |
| `access` | enum FileAccess |  |

### AccountSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `allowPersonalizedPrices` | boolean |  |
| `whiteLabelBranding` | boolean |  |
| `allowedPaymentMethods` | enum PaymentMethod |  |
| `enabledUnits` | ~array/json |  |
| `defaultClientDebtLimit` | decimal? |  |
| `showClientsPortalURLOnTickets` | boolean |  |
| `showClientsPortalURLOnPDFs` | boolean |  |
| `accountFeatures` | ~json |  |

### ManufacturingSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `defaultLocationId` | ~string | Location |
| `allowManufacturingMaterialsOutOfStock` | ~boolean |  |

### StockSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `notifyMovingNegativeStock` | ~boolean |  |
| `allowMovingNegativeStock` | ~boolean |  |

### QuotationSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `breakdownTaxesInQuotations` | boolean |  |
| `notifyInsufficientStockForQuotation` | boolean |  |
| `quotationsFixedNote` | string? |  |
| `defaultValidity` | decimal? |  |

### OrderSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `batchStrategy` | enum SettingBatchStrategy |  |
| `allowSellingOutOfStock` | boolean |  |
| `notifyInsufficientStockForSale` | boolean |  |
| `restrictSellingToClientsWithOverdueDebt` | boolean |  |
| `minProfitMargin` | decimal? |  |
| `minProfitMarginPolicy` | enum MinProfitMarginPolicy |  |

### UpgradePromotion

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `createdAt` | — |  |
| `startedAt` | — |  |
| `seen` | — |  |
| `dismissed` | — |  |
| `upgraded` | — |  |
| `content` | — |  |

### NativeReview

| columna | tipo | relación |
|---|---|---|
| `userId` | — | User |
| `accountId` | — | Account |
| `dismissedAt` | — |  |
| `reviewedAt` | — |  |

### PulposAppSuggestion

| columna | tipo | relación |
|---|---|---|
| `id` | string |  |
| `createdAt` | datetime |  |
| `accountId` | cuid | Account |
| `userId` | ~string? | User |
| `content` | string |  |
| `source` | ~enum PlatformSource |  |
| `metadata` | ~json? |  |

### InvoicingSettings

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `globalInvoiceGrouping` | — |  |
| `selfInvoicePolicy` | — |  |
| `selfInvoiceMaxOrderAgeInDays` | — |  |
| `displayBatchDetailsOnInvoice` | — |  |
| `applyTaxWithholdingAutomatically` | — |  |
| `invoiceServicesAsProfessionalServices` | — |  |
| `fiscalProfileId` | — | FiscalProfile |
| `facturapiId` | — |  |
| `facturapiApiKey` | — |  |
| `facturapiOrganization` | — |  |

### EmailSendingConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `emailType` | — |  |

### Logo

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `imageId` | ~string? | Image |
| `type` | ~string |  |

### AccountAffiliation

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `acceptedAt` | — |  |
| `status` | — |  |
| `affiliateId` | — |  |
| `customerAccountId` | — | Account |
| `chargebeePlanId` | — |  |
| `type` | — |  |
| `affiliateNotes` | — |  |
| `derivedLead` | — |  |

### AffiliationPayment

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `processedAt` | — |  |
| `estimatedPaymentDate` | — |  |
| `amount` | — |  |
| `amountCurrency` | — |  |
| `paidByAffiliatedCustomer` | — |  |
| `paidAtByAffiliatedCustomer` | — |  |
| `chargebeeInvoiceId` | — | Invoice |
| `origin` | — |  |
| `status` | — |  |
| `reason` | — |  |
| `notes` | — |  |
| `accountAffiliationId` | — | AccountAffiliation |
| `processedByUserId` | — | User |
| `bankAccountNumber` | — |  |

### UserBankAccount

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountHolder` | string |  |
| `accountNumber` | string |  |
| `routingNumber` | string |  |
| `bankName` | string |  |
| `userId` | — | User |

### ClientsPaymentsBankAccount

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `routingNumber` | string |  |
| `accountHolder` | string |  |
| `bankName` | string |  |
| `accountNumber` | string |  |
| `comments` | string |  |

### PulposAppCommunication

| columna | tipo | relación |
|---|---|---|
| `id` | string |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `type` | enum PulposAppCommunicationType |  |
| `title` | string |  |
| `subtitle` | string |  |
| `startDate` | datetime |  |
| `endDate` | datetime? |  |
| `content` | — |  |
| `segmentation` | — |  |
| `appCommunicationNumber` | number |  |

### Seller

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `userId` | ~string? | User |
| `name` | string |  |
| `surname` | ~string |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |

### PulposGlobalConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `updatedAt` | — |  |
| `supportCallsEnabled` | — |  |


## Catálogo de productos y precios

### ProductCategory

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `name` | string |  |
| `displayInCatalog` | boolean |  |

### ProductBrand

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `name` | string |  |

### CustomPriceType

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `name` | string |  |
| `isDefault` | ~boolean |  |

### ProductCustomPrice

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `productId` | ~string | Product |
| `customPriceTypeId` | ~string | CustomPriceType |
| `price` | decimal |  |
| `priceCurrency` | enum Currency |  |
| `breakpoint` | decimal |  |

### Product

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `accountId` | ~string | Account |
| `userIdCreatedBy` | ~string | User |
| `sellUnit` | ~enum MEASURE_UNIT |  |
| `cost` | ~decimal |  |
| `costCurrency` | ~enum Currency |  |
| `costType` | ~enum CostType |  |
| `satCategoryCode` | ~string? |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `batchesEnabled` | ~boolean |  |
| `prescriptionRequired` | ~boolean |  |
| `type` | ~enum ProductType |  |
| `profileId` | ~string | ProductProfile |
| `isStockable` | ~boolean |  |

### ProductProfile

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `accountId` | ~string | Account |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `userIdCreatedBy` | ~string | User |
| `name` | ~string |  |
| `slug` | ~string |  |
| `description` | ~string? |  |
| `barcode` | ~string? |  |
| `sku` | ~string? |  |
| `categoryId` | ~string? |  |
| `brandId` | — |  |
| `hiddenAt` | — |  |
| `displayInCatalog` | ~boolean |  |
| `isSellable` | ~boolean |  |
| `isTest` | ~boolean |  |
| `parentId` | ~string? | ProductProfile |
| `variantConfig` | ~array/json? |  |
| `isManufactured` | ~boolean |  |

### ProductCombination

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `comboId` | cuid | ProductProfile |
| `comboItemId` | cuid | ProductProfile |
| `quantity` | decimal |  |

### ManufacturingBlueprintItem

| columna | tipo | relación |
|---|---|---|
| `resultingProductProfileId` | — | ProductProfile |
| `materialId` | — | ProductProfile |
| `quantity` | — |  |

### Tax

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `percentage` | number |  |
| `type` | ~string |  |
| `isExempt` | boolean |  |
| `isWithheld` | ~boolean |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### SatCategory

| columna | tipo | relación |
|---|---|---|
| `code` | ~string |  |
| `description` | ~string |  |
| `similarTerms` | ~string |  |
| `parentCode` | ~decimal? |  |

### MeasureUnit

| columna | tipo | relación |
|---|---|---|
| `key` | — |  |
| `spanishName` | — |  |
| `facturapiCode` | — |  |

### ProductProfilePhoto

| columna | tipo | relación |
|---|---|---|
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `imageId` | ~string? | Image |
| `accountId` | cuid | Account |
| `index` | ~number |  |
| `productProfileId` | ~string | ProductProfile |

### ProductCategoryPhoto

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `categoryId` | ~string? |  |
| `imageId` | ~string? | Image |


## Inventario

### ProductStock

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `productId` | ~string | Product |
| `locationId` | ~string? | Location |
| `stockQuantity` | ~decimal |  |
| `minStockQuantity` | ~decimal? |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### ProductStorage

| columna | tipo | relación |
|---|---|---|
| `accountId` | cuid | Account |
| `productId` | ~string | Product |
| `locationId` | ~string? | Location |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `placement` | — |  |

### ProductBatchStock

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `stockQuantity` | ~decimal |  |
| `productBatchId` | ~string | ProductBatch |
| `minStockQuantity` | ~decimal? |  |
| `locationId` | ~string? | Location |

### ProductBatch

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `productId` | ~string | Product |
| `code` | ~string |  |
| `expiresAt` | ~datetime? |  |
| `fabricatedAt` | — |  |
| `deletedAt` | — |  |

### StockMovement

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `userIdCreatedBy` | ~string | User |
| `accountId` | ~string | Account |
| `previousQuantity` | ~decimal |  |
| `currentQuantity` | ~decimal |  |
| `locationId` | ~string | Location |
| `productProfileId` | ~string | ProductProfile |
| `discriminator` | ~string? |  |
| `discriminatorType` | ~string |  |
| `discriminatorId` | ~string? |  |
| `adjustmentReason` | — |  |
| `origin` | ~enum StockMovementOrigin |  |
| `originId` | ~string? |  |

### Transfer

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `transferNumber` | ~bigint |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `accountId` | cuid | Account |
| `status` | ~string |  |
| `originId` | ~string | Location |
| `destinationId` | ~string | Location |

### TransferItem

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `transferId` | ~string | Transfer |
| `productId` | ~string? | Product |
| `quantitySent` | ~decimal |  |
| `quantityReceived` | ~decimal |  |
| `quantityUnit` | ~enum MEASURE_UNIT |  |

### TransferItemBatchQuantity

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `transferItemId` | — | TransferItem |
| `productBatchId` | cuid | ProductBatch |
| `quantitySent` | decimal |  |
| `quantityReceived` | decimal |  |

### TransferEvent

| columna | tipo | relación |
|---|---|---|
| `id` | string |  |
| `createdAt` | datetime |  |
| `transferId` | ~string | Transfer |
| `userIdCreatedBy` | ~string? | User |
| `type` | ~string |  |
| `content` | string |  |

### StockAdjustment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `stockAdjustmentNumber` | ~bigint |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | datetime? |  |
| `accountId` | cuid | Account |
| `locationId` | cuid | Location |
| `userIdCreatedBy` | cuid | User |
| `status` | enum PurchaseStatus |  |
| `type` | ~string |  |
| `reason` | ~enum StockMovementAdjustmentReason? |  |
| `notes` | string? |  |

### StockAdjustmentItem

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `accountId` | ~string | Account |
| `stockAdjustmentId` | ~string | StockAdjustment |
| `productId` | ~string | Product |
| `previousQuantity` | ~decimal |  |
| `inputQuantity` | ~decimal |  |
| `quantityUnit` | ~enum MEASURE_UNIT |  |
| `unitCost` | ~decimal |  |
| `unitPrice` | ~decimal |  |

### StockAdjustmentItemBatchQuantity

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `accountId` | ~string | Account |
| `stockAdjustmentItemId` | — | StockAdjustmentItem |
| `productBatchId` | cuid | ProductBatch |
| `code` | string |  |
| `expiresAt` | datetime |  |
| `fabricatedAt` | datetime? |  |
| `previousQuantity` | — |  |
| `inputQuantity` | decimal? |  |

### StockAdjustmentEvent

| columna | tipo | relación |
|---|---|---|
| `id` | string |  |
| `createdAt` | datetime |  |
| `accountId` | cuid | Account |
| `stockAdjustmentId` | ~string | StockAdjustment |
| `userIdCreatedBy` | ~string? | User |
| `type` | ~string |  |
| `content` | string |  |

### ManufacturingOrder

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `accountId` | ~string | Account |
| `manufacturingOrderNumber` | ~bigint |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `startedAt` | ~datetime? |  |
| `finishedAt` | ~datetime? |  |
| `deletedAt` | — |  |
| `notes` | — |  |
| `status` | ~enum ManufacturingOrderStatus |  |
| `initialQuantity` | ~decimal |  |
| `manufacturedQuantity` | ~decimal? |  |
| `locationId` | ~string | Location |
| `productProfileId` | ~string | ProductProfile |

### ManufacturingOrderMaterialItem

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `materialId` | ~string | ProductProfile |
| `manufacturingOrderId` | ~string | ManufacturingOrder |
| `quantity` | ~decimal |  |
| `quantityUnit` | ~enum MEASURE_UNIT |  |

### ManufacturingOrderEvent

| columna | tipo | relación |
|---|---|---|
| `id` | string |  |
| `createdAt` | datetime |  |
| `manufacturingOrderId` | — | ManufacturingOrder |
| `userIdCreatedBy` | ~string? | User |
| `type` | ~string |  |
| `content` | string |  |


## Ventas

### CustomPaymentMethod

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |
| `hiddenAt` | — |  |
| `accountId` | cuid | Account |
| `name` | string |  |
| `allowsIncome` | ~boolean |  |
| `allowsSpend` | ~boolean |  |
| `method` | ~enum PaymentMethod |  |
| `reconciliationSourceId` | — | ReconciliationSource |

### OrderPayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `madeAt` | datetime |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | datetime? |  |
| `accountId` | ~string | Account |
| `userIdCreatedBy` | cuid | User |
| `orderId` | cuid | Order |
| `method` | enum PaymentMethod |  |
| `total` | ~decimal |  |
| `totalCurrency` | enum Currency |  |
| `cancelsPaymentId` | ~string? | OrderPayment (CREDIT que se liquida) |
| `invoiceId` | — | Invoice |
| `cashierId` | cuid | Cashier |
| `change` | ~decimal |  |
| `unifiedDebtPaymentId` | ~string? | UnifiedDebtPayment |
| `orderPaymentNotificationId` | — | OrderPaymentNotification |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |
| `loyaltyPointsReward` | ~decimal |  |

### OrderPaymentNotification

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `status` | ~enum QuotationStatus |  |
| `clientId` | ~string | Client |
| `amount` | — |  |
| `amountCurrency` | — |  |
| `paymentReceiptImageId` | — | Image |

### UnifiedDebtPayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |

### OrderOnlinePayment

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `externalId` | — |  |
| `paymentMethod` | — |  |
| `status` | — |  |
| `amount` | — |  |
| `payment` | — |  |
| `orderId` | — | Order |
| `orderPaymentId` | — | OrderPayment |

### OrderItemProductBatchQuantity

| columna | tipo | relación |
|---|---|---|
| `quantity` | decimal |  |
| `productBatchId` | cuid | ProductBatch |
| `orderItemProductId` | cuid | OrderItemProduct |

### OrderItemProduct

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `orderId` | ~string | Order |
| `accountId` | ~string | Account |
| `productId` | ~string | Product |
| `customPriceTypeId` | ~string | CustomPriceType |
| `quantity` | ~decimal |  |
| `quantityUnit` | ~enum MEASURE_UNIT |  |
| `unitPrice` | ~decimal |  |
| `unitPriceCurrency` | ~enum Currency |  |
| `unitCostNet` | ~decimal |  |
| `unitCostNetCurrency` | ~enum Currency |  |
| `total` | ~decimal |  |
| `totalCurrency` | ~enum Currency |  |
| `totalCostNet` | ~decimal |  |
| `totalCostNetCurrency` | ~enum Currency |  |
| `priceBreakpoint` | ~decimal |  |
| `name` | ~string |  |
| `type` | ~enum ProductType |  |
| `inComboId` | — | OrderItemProduct |
| `prescriptionId` | — | Prescription |
| `priceType` | ~enum OrderItemPriceType |  |
| `satCategoryCode` | ~string? |  |
| `discountId` | ~string? |  |
| `digitalServiceItemId` | — |  |

### OrderDeliveryCost

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `orderId` | ~string | Order |
| `amount` | ~decimal |  |
| `amountCurrency` | ~enum Currency |  |

### OrderItemProductDiscount

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `type` | enum CartDiscountType |  |
| `percentage` | number |  |
| `title` | string? |  |
| `promotionId` | cuid? | Promotion |

### OrderItemCartDiscount

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `orderId` | cuid | Order |
| `type` | enum CartDiscountType |  |
| `amount` | decimal |  |
| `amountCurrency` | enum Currency |  |
| `title` | string? |  |
| `promotionId` | cuid? | Promotion |
| `loyaltyPointsUsed` | decimal? |  |

### Order

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `userFriendlyId` | string |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `sellerId` | cuid? | Seller |
| `orderSeriesLabel` | — |  |
| `orderNumber` | bigint |  |
| `paymentStatus` | enum OrderPaymentStatus |  |
| `shippingStatus` | enum OrderShippingStatus |  |
| `origin` | enum OrderOrigin |  |
| `subtotal` | decimal |  |
| `subtotalCurrency` | enum Currency |  |
| `discounts` | decimal |  |
| `discountsCurrency` | enum Currency |  |
| `originalTotal` | ~decimal |  |
| `total` | decimal |  |
| `totalCurrency` | enum Currency |  |
| `madeAt` | ~datetime |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `locationId` | ~string | Location |
| `invoiceId` | — | Invoice |
| `clientId` | cuid? | Client |
| `deliveryAddressId` | — | Address |
| `customPriceTypeId` | string | CustomPriceType |
| `orderSeriesId` | ~string | OrderSeries |
| `isTest` | ~boolean |  |
| `isOffline` | ~boolean |  |
| `wayOfPayment` | ~enum OrderWayOfPayment |  |
| `shippingMethod` | ~enum OrderShippingMethod |  |
| `quotationId` | ~string? | Quotation |
| `requestId` | ~string |  |
| `withTaxes` | ~boolean |  |
| `isSellingDigitalService` | ~boolean |  |
| `loyaltyPointsRewardPercentage` | ~decimal |  |
| `notes` | string? |  |

### OrderSeries

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `label` | string? |  |
| `nextNumber` | bigint |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `name` | string |  |
| `isDefault` | ~boolean |  |
| `deletedAt` | — |  |

### OrderRefund

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `orderId` | ~string | Order |
| `reason` | ~enum OrderRefundReason |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `totalRefunded` | ~decimal |  |
| `subtotalRefunded` | ~decimal |  |
| `cancelledDebt` | ~decimal |  |
| `totalCurrency` | ~enum Currency |  |
| `userIdCreatedBy` | ~string | User |
| `orderSnapshot` | — |  |
| `invoiceId` | — | Invoice |

### OrderItemRefundBatchQuantity

| columna | tipo | relación |
|---|---|---|
| `quantity` | — |  |
| `productBatchId` | — | ProductBatch |
| `orderItemRefundId` | — | OrderItemRefund |

### OrderItemRefund

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `orderItemId` | ~string |  |
| `orderRefundId` | ~string | OrderRefund |
| `quantityRefunded` | ~decimal |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### OrderRefundPayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | ~string | Account |
| `orderRefundId` | ~string | OrderRefund |
| `method` | enum PaymentMethod |  |
| `totalRefunded` | ~decimal |  |
| `totalCurrency` | enum Currency |  |
| `cashierId` | cuid | Cashier |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### OrderDebt

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `dueDate` | ~datetime |  |
| `accountId` | ~string | Account |
| `orderId` | ~string | Order |
| `originalDebt` | ~decimal |  |
| `currentDebt` | ~decimal |  |
| `currency` | ~string |  |
| `paymentIdCredit` | ~string | OrderPayment |

### OrderJournal

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `orderId` | ~string | Order |
| `events` | json |  |

### QuotationJournal

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `quotationId` | ~string? | Quotation |
| `events` | json |  |

### ClientDebtLimit

| columna | tipo | relación |
|---|---|---|
| `clientId` | — | Client |
| `accountId` | — | Account |
| `limit` | — |  |

### Client

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `userFriendlyId` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `accountId` | ~string? | Account |
| `userIdCreatedBy` | ~string? | User |
| `addressId` | — | Address |
| `name` | ~string |  |
| `surname` | ~string |  |
| `phoneNumber` | ~string |  |
| `email` | ~string |  |
| `fiscalProfileId` | ~string? | FiscalProfile |
| `type` | ~enum ClientType |  |
| `comments` | — |  |
| `defaultPriceTypeId` | — | CustomPriceType |
| `lastDebtReminderSentAt` | ~datetime? |  |
| `loyaltyPoints` | ~decimal |  |
| `aiAgentEnabled` | ~boolean |  |

### Quotation

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `userFriendlyId` | ~string |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `quotationNumber` | bigint |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `validFrom` | datetime? |  |
| `expiresAt` | datetime? |  |
| `subtotal` | ~decimal |  |
| `subtotalCurrency` | enum Currency |  |
| `status` | enum QuotationStatus |  |
| `clientId` | cuid? | Client |
| `clientNote` | string |  |
| `customPriceTypeId` | ~string? | CustomPriceType |
| `locationId` | cuid? | Location |
| `withTaxes` | boolean |  |
| `notes` | ~string? |  |
| `deliveryAddressId` | — | Address |
| `sellerId` | ~string? | Seller |

### QuotationItem

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `quotationId` | ~string | Quotation |
| `productId` | ~string? | Product |
| `quantity` | decimal |  |
| `quantityUnit` | ~enum MEASURE_UNIT |  |
| `sellPrice` | decimal |  |
| `sellPriceCurrency` | enum Currency |  |
| `customPriceTypeId` | ~string | CustomPriceType |
| `priceBreakpoint` | decimal |  |
| `total` | decimal |  |
| `totalCurrency` | enum Currency |  |
| `type` | enum ProductType |  |
| `inComboId` | string? |  |
| `priceType` | enum QuotationItemPriceType |  |
| `discountId` | string? |  |

### QuotationManualEntryItem

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `quotationItemId` | ~string | QuotationItem |
| `name` | ~string |  |
| `cost` | ~decimal |  |
| `costCurrency` | ~enum Currency |  |

### QuotationItemDiscount

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `type` | enum CartDiscountType |  |
| `percentage` | number |  |
| `title` | string? |  |
| `promotionId` | cuid? | Promotion |

### QuotationCartDiscount

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `quotationId` | — | Quotation |
| `type` | enum CartDiscountType |  |
| `amount` | decimal |  |
| `amountCurrency` | enum Currency |  |
| `title` | string? |  |
| `promotionId` | cuid? | Promotion |

### Prescription

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `prescriptionNumber` | bigint |  |
| `prescriptionCode` | string? |  |
| `prescribedAt` | datetime? |  |
| `prescriberLicence` | string |  |
| `prescriberName` | string |  |
| `additionalInformation` | string? |  |

### Promotion

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `accountId` | ~string | Account |
| `name` | ~string |  |
| `type` | ~enum PromotionType |  |
| `application` | ~enum PromotionApplicationType |  |
| `validFrom` | ~datetime |  |
| `validUntil` | ~datetime |  |
| `userIdCreatedBy` | ~string | User |
| `lastUpdatedByUserId` | — | User |
| `restrictToClients` | ~string |  |
| `daysOfWeekLimitation` | ~array/json |  |

### PromotionClientLimitation

| columna | tipo | relación |
|---|---|---|
| `promotionId` | — | Promotion |
| `clientId` | — | Client |

### PromotionPriceListLimitation

| columna | tipo | relación |
|---|---|---|
| `promotionId` | — | Promotion |
| `customPriceTypeId` | — | CustomPriceType |

### PromotionLocationLimitation

| columna | tipo | relación |
|---|---|---|
| `promotionId` | — | Promotion |
| `locationId` | — | Location |

### CartTotalPromotion

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `accountId` | ~string | Account |
| `promotionId` | ~string | Promotion |
| `amount` | ~decimal |  |
| `amountType` | ~enum ItemDiscountType |  |
| `minCartSubtotal` | — |  |

### SingleTargetPromotion

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `accountId` | ~string | Account |
| `promotionId` | ~string | Promotion |
| `amount` | ~decimal |  |
| `amountType` | ~enum ItemDiscountType |  |
| `target` | — |  |

### MultiTargetPromotion

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `promotionId` | — | Promotion |
| `type` | — |  |
| `triggerTarget` | — |  |
| `triggerQuantity` | — |  |
| `discountedTarget` | — |  |
| `discountedQuantity` | — |  |
| `discountedPercentage` | — |  |

### LoyaltyProgram

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deactivatedAt` | — |  |
| `accountId` | cuid | Account |
| `rewardPercentage` | ~decimal |  |
| `minCartTotalLimitation` | ~decimal? |  |

### LoyaltyProgramPriceListLimitation

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
| `loyaltyProgramId` | — | LoyaltyProgram |
| `customPriceTypeId` | — | CustomPriceType |

### LoyaltyProgramLocationLimitation

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
| `loyaltyProgramId` | — | LoyaltyProgram |
| `locationId` | — | Location |

### LoyaltyProgramProductSpecificReward

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `loyaltyProgramId` | ~string | LoyaltyProgram |
| `productProfileId` | ~string | ProductProfile |
| `rewardPercentage` | ~decimal |  |

### LoyaltyProgramCategorySpecificReward

| columna | tipo | relación |
|---|---|---|
| `accountId` | ~string | Account |
| `loyaltyProgramId` | ~string | LoyaltyProgram |
| `categoryId` | ~string |  |
| `rewardPercentage` | ~decimal |  |

### LoyaltyProgramMovement

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `accountId` | ~string | Account |
| `userIdCreatedBy` | ~string | User |
| `clientId` | ~string | Client |
| `previousQuantity` | ~decimal |  |
| `currentQuantity` | ~decimal |  |
| `origin` | ~string |  |
| `orderId` | ~string | Order |
| `adjustmentReason` | — |  |


## Compras y gastos

### Purchase

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `purchaseNumber` | bigint |  |
| `locationId` | cuid | Location |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `madeAt` | datetime |  |
| `total` | ~decimal |  |
| `totalCurrency` | enum Currency |  |
| `status` | enum PurchaseStatus |  |
| `providerId` | cuid? | Provider |
| `deletedAt` | datetime? |  |
| `notes` | string? |  |
| `folio` | string? |  |
| `requestId` | string |  |

### PurchaseDebt

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `dueDate` | ~datetime |  |
| `purchaseId` | cuid | Purchase |
| `originalDebt` | ~decimal |  |
| `currentDebt` | decimal |  |
| `currency` | enum Currency |  |

### PurchasePayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | ~string | Account |
| `purchaseId` | cuid | Purchase |
| `madeAt` | datetime |  |
| `total` | decimal |  |
| `totalCurrency` | enum Currency |  |
| `cashMovementId` | cuid? | CashMovement |
| `userIdCreatedBy` | cuid | User |
| `method` | enum PaymentMethod |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### PurchaseItemProductBatchQuantity

| columna | tipo | relación |
|---|---|---|
| `code` | string |  |
| `expiresAt` | datetime |  |
| `fabricatedAt` | datetime? |  |
| `stockQuantity` | ~decimal |  |
| `purchaseItemId` | ~string | PurchaseItem |
| `productBatchId` | cuid | ProductBatch |

### PurchaseItem

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `purchaseId` | ~string | Purchase |
| `productId` | ~string | Product |
| `quantity` | decimal |  |
| `quantityUnit` | ~enum MEASURE_UNIT |  |
| `sellUnitFactor` | decimal |  |
| `netUnitCost` | decimal |  |
| `costCurrency` | enum Currency |  |
| `unitDiscountPercentage` | decimal |  |
| `totalCurrency` | enum Currency |  |

### Expense

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `concept` | ~string? |  |
| `expenseNumber` | ~bigint |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `madeAt` | datetime |  |
| `total` | ~decimal |  |
| `totalCurrency` | enum Currency |  |
| `locationId` | cuid | Location |
| `providerId` | cuid? | Provider |
| `deletedAt` | datetime? |  |
| `notes` | string? |  |
| `folio` | string? |  |

### ExpensePayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | ~string | Account |
| `expenseId` | ~string | Expense |
| `userIdCreatedBy` | cuid | User |
| `madeAt` | datetime |  |
| `total` | ~decimal |  |
| `totalCurrency` | enum Currency |  |
| `cashMovementId` | ~string? | CashMovement |
| `method` | enum PaymentMethod |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### ExpenseDebt

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `dueDate` | ~datetime |  |
| `currentDebt` | ~decimal |  |
| `originalDebt` | ~decimal |  |
| `currency` | ~string |  |
| `expenseId` | — | Expense |

### Provider

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |
| `userIdCreatedBy` | cuid | User |
| `name` | string |  |
| `contactName` | string? |  |
| `contactPhone` | — |  |
| `contactEmail` | — |  |

### OutlayInvoiceFile

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `fileId` | — | File |
| `fileType` | — |  |
| `metadata` | — |  |
| `purchaseId` | — | Purchase |
| `expenseId` | — | Expense |


## Caja

### Cashier

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `accountId` | cuid | Account |
| `name` | string |  |
| `isDefault` | ~boolean |  |
| `locationId` | ~string? | Location |
| `orderSeriesId` | ~string? | OrderSeries |

### CashierAudit

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `accountId` | ~string | Account |
| `userIdCreatedBy` | ~string | User |
| `cashIn` | decimal |  |
| `cashInCurrency` | enum Currency |  |
| `cashOut` | decimal |  |
| `cashOutCurrency` | enum Currency |  |
| `comments` | string? |  |
| `status` | ~enum PurchaseStatus |  |
| `periodStart` | ~datetime |  |
| `periodEnd` | ~datetime |  |
| `cashierId` | cuid | Cashier |

### CashierAuditItem

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `cashierAuditId` | ~string | CashierAudit |
| `method` | enum PaymentMethod |  |
| `totalExpected` | ~decimal |  |
| `totalExpectedCurrency` | ~enum Currency |  |
| `totalAudited` | decimal |  |
| `totalAuditedCurrency` | enum Currency |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### CashMovement

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `deletedAt` | — |  |
| `accountId` | ~string | Account |
| `userId` | ~string | User |
| `details` | ~string? |  |
| `amount` | ~decimal |  |
| `currency` | ~string |  |
| `cashierId` | ~string | Cashier |
| `type` | ~enum CashMovementType |  |


## Facturación (fuera de alcance por ahora)

### FiscalProfile

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `fiscalName` | ~string |  |
| `addressId` | ~string | Address |
| `issuingAddressId` | — | Address |
| `fiscalRegimeId` | ~string | FiscalRegime |
| `fiscalCode` | ~string |  |

### SelfInvoiceProfile

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `fiscalProfileId` | ~string? | FiscalProfile |
| `fiscalUseCaseId` | — | FiscalUseCase |

### FiscalRegime

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `country` | ~enum Country? |  |
| `code` | ~string |  |

### FiscalUseCase

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `country` | ~enum Country? |  |
| `code` | ~string |  |

### Invoice

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `fiscalUseCaseId` | — | FiscalUseCase |
| `clientId` | — | Client |
| `facturapiInvoiceId` | — | Invoice |
| `facturapiInvoice` | — |  |
| `isTest` | — |  |
| `origin` | — |  |
| `status` | — |  |
| `invoicedAt` | — |  |
| `oldOrderRefundId` | — | OrderRefund |
| `invoicingSettingsId` | — | InvoicingSettings |

### InvoiceTypeToSeries

| columna | tipo | relación |
|---|---|---|
| `invoicingSettingsId` | — | InvoicingSettings |
| `type` | — |  |
| `series` | — |  |

### PulposSubscriptionInvoice

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `accountId` | cuid | Account |
| `chargebeeInvoiceId` | — | Invoice |
| `facturapiInvoiceId` | — | Invoice |
| `facturapiInvoice` | — |  |

### GlobalInvoice

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `invoiceId` | — | Invoice |
| `total` | — |  |
| `totalCurrency` | — |  |
| `periodStart` | datetime |  |
| `periodEnd` | datetime |  |
| `grouping` | enum SettingGlobalInvoiceGrouping |  |
| `year` | number |  |
| `month` | number |  |
| `monthPeriod` | number |  |
| `locationId` | cuid | Location |


## Canales: catálogo, WhatsApp, IA, servicios digitales

### StoreAgentKnowledgeFile

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `fileId` | — | File |
| `fileType` | — |  |
| `storeAgentFAQId` | — | StoreAgentFAQ |

### Catalog

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deactivatedAt` | — |  |
| `subdomain` | ~string |  |
| `accountId` | cuid | Account |

### CatalogConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `catalogId` | ~string | Catalog |
| `name` | ~string |  |
| `phoneNumber` | ~string |  |
| `facebook` | — |  |
| `instagram` | — |  |
| `customerSupportWhatsApp` | — |  |
| `emailContact` | — |  |
| `configProductsWithoutStock` | ~enum CatalogConfigProductsWithoutStock |  |
| `configAcquisitionLimit` | ~enum CatalogConfigAcquisitionLimit |  |
| `configCategories` | ~enum CatalogConfigCategories |  |
| `locationOfOriginId` | ~string |  |
| `sharedInInstagram` | ~boolean |  |
| `sharedInWhatsApp` | ~boolean |  |
| `uiVariant` | ~enum CatalogUIVariant |  |
| `areClientCatalogsEnabled` | ~boolean |  |
| `isVolumePricingEnabled` | ~boolean |  |

### LocationStockVisibilityToCatalog

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `catalogConfigurationId` | ~string | CatalogConfiguration |
| `locationId` | ~string? | Location |

### CatalogOrderShippingConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `shippingMethods` | enum OrderShippingMethod |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `pickUpAddressId` | — | Address |
| `pickUpInstructions` | string |  |
| `deliveryInstructions` | string |  |
| `deliveryDefaultPrice` | decimal |  |
| `agreedAfterPurchaseInstructions` | string |  |
| `catalogConfigurationId` | ~string | CatalogConfiguration |

### CatalogOrderPaymentConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `wayOfPayments` | enum OrderWayOfPayment |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `bankTransferInstructions` | string |  |
| `agreedAfterPurchaseInstructions` | string |  |
| `creditInstructions` | string |  |
| `collectOnDeliveryInstructions` | string |  |
| `catalogConfigurationId` | ~string | CatalogConfiguration |

### MercadoPagoCredentials

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `accessToken` | — |  |
| `refreshToken` | — |  |
| `expiresAt` | — |  |
| `mercadoPagoUserId` | — | User |
| `mercadoPagoPublicKey` | — |  |

### CatalogHomePagePersonalization

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `catalogId` | ~string | Catalog |
| `isActive` | boolean |  |
| `heroPhotoId` | — |  |
| `showHeroPhoto` | boolean |  |
| `title` | string? |  |
| `mainButtonText` | string? |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |

### CatalogPhoto

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `imageId` | ~string? | Image |
| `accountId` | cuid | Account |
| `catalogId` | ~string | Catalog |
| `type` | ~string |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### CatalogBanner

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `imageId` | ~string? | Image |
| `accountId` | cuid | Account |
| `catalogId` | ~string | Catalog |
| `type` | ~string |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### CatalogVariantConfig

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `path` | ~string |  |
| `hidden` | ~boolean |  |
| `accountId` | cuid | Account |
| `customPriceTypeId` | ~string? | CustomPriceType |

### StoreAgentConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `disabledAt` | — |  |
| `accountId` | ~string | Account |
| `testMessagesSentCount` | ~number |  |
| `supportCallOfferedCount` | ~number |  |
| `agentName` | — |  |
| `agentDescription` | — |  |
| `disclosesAiIdentity` | ~boolean |  |
| `responseLength` | ~enum StoreAgentResponseLength |  |
| `useEmojisInResponses` | ~boolean |  |
| `defaultAccessCustomPriceTypeId` | ~string | CustomPriceType |
| `outOfStockPolicy` | ~enum StoreAgentOutOfStockPolicy |  |

### StoreAgentAccessToLocation

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `agentId` | — |  |
| `locationId` | ~string? | Location |

### StoreAgentFAQ

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `storeAgentConfigurationId` | — | StoreAgentConfiguration |
| `userIdCreatedBy` | ~string | User |
| `category` | ~json? |  |
| `title` | — |  |
| `description` | ~string? |  |

### StoreAgentDelegationPolicy

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `storeAgentConfigurationId` | — | StoreAgentConfiguration |
| `userIdCreatedBy` | ~string | User |
| `title` | — |  |
| `description` | ~string? |  |
| `deactivatedAt` | — |  |

### AiConversation

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `userId` | ~string? | User |
| `context` | — |  |
| `messages` | — |  |

### AssistantConversation

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `userId` | — | User |
| `threadId` | — |  |
| `reviewStatus` | — |  |
| `hubspotThreadId` | — |  |
| `handoffStartedAt` | — |  |
| `handoffEndedAt` | — |  |
| `hubspotAgentId` | — |  |
| `hubspotAgentName` | — |  |
| `csatIssueSolved` | — |  |
| `csatSupportRating` | — |  |

### AssistantMessage

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `accountId` | — | Account |
| `conversationId` | — |  |
| `role` | — |  |
| `content` | — |  |
| `senderName` | — |  |
| `hubspotMessageId` | — |  |
| `context` | — |  |
| `replyExtras` | — |  |

### AssistantMessageAttachment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `messageId` | — |  |
| `fileId` | — | File |
| `kind` | — |  |
| `hubspotFileId` | — | File |
| `durationInSeconds` | — |  |

### GestoPagosCredentials

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `businessId` | — |  |
| `businessName` | — |  |
| `isInvoicingEnabled` | — |  |
| `deviceCode` | — |  |
| `password` | — |  |
| `accessToken` | — |  |
| `lastTokenRefreshedAt` | — |  |
| `secretKey` | — |  |
| `iv` | — |  |
| `referenceNumber` | — |  |
| `clabeBankReference` | — |  |

### ExternalDigitalServiceConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `accountId` | ~string | Account |
| `hasMadeFirstBalanceDeposit` | ~boolean |  |
| `gestoPagosCredentialsId` | — | GestoPagosCredentials |
| `commissionCurrency` | ~enum Currency |  |
| `rechargesCommission` | ~decimal |  |
| `servicePaymentsCommission` | ~decimal |  |
| `giftCardsCommission` | ~decimal |  |
| `isEnabled` | ~boolean |  |

### ExternalDigitalServicePaymentNotification

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `madeAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `amount` | number |  |
| `currency` | enum Currency |  |
| `previousBalance` | — |  |
| `bankAccountId` | string | Account |
| `transferMedium` | string |  |
| `transferReference` | string |  |

### ExternalDigitalService

| columna | tipo | relación |
|---|---|---|
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `id` | — |  |
| `externalProductId` | — | Product |
| `externalServiceId` | — |  |
| `productName` | — |  |
| `serviceName` | — |  |
| `price` | — |  |
| `instructions` | — |  |
| `type` | — |  |
| `referenceType` | — |  |
| `referenceLabel` | — |  |
| `referenceHelp` | — |  |
| `servicePaymentCategory` | — |  |
| `allowsPartialPayments` | — |  |
| `allowsBalanceCheck` | — |  |
| `allowsExpiredPayments` | — |  |

### OrderDigitalServiceItem

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `externalDigitalServiceId` | — | ExternalDigitalService |
| `productName` | — |  |
| `serviceName` | — |  |
| `extraCharge` | — |  |
| `type` | — |  |
| `accountId` | — | Account |
| `reference` | — |  |
| `instructions` | — |  |
| `authorizationNumber` | — |  |
| `giftCardCode` | — |  |
| `gestopagosTransactionId` | — |  |
| `gestopagosTransactionUpc` | — |  |

### GestoPagosRequestLog

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `url` | — |  |
| `requestBody` | — |  |
| `requestParams` | — |  |
| `responseBody` | — |  |
| `status` | — |  |
| `method` | — |  |
| `errorMessage` | — |  |

### WhatsAppBusinessCredentials

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `whatsAppBusinessId` | — |  |
| `whatsAppBusinessPhoneNumberId` | — |  |
| `displayPhoneNumber` | ~string |  |
| `accessToken` | — |  |
| `displayName` | ~string |  |

### PlatformConversation

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `deletedAt` | — |  |
| `accountId` | ~string | Account |
| `clientId` | — | Client |
| `displayPhoneNumber` | ~string |  |
| `displayName` | ~string |  |
| `lastMessageAt` | ~datetime |  |
| `lastInboundMessageAt` | ~datetime |  |
| `isAssignedToAI` | ~boolean |  |
| `markedUnreadAt` | — |  |
| `isTest` | ~boolean |  |
| `source` | ~enum PlatformSource |  |
| `externalUserId` | ~string | User |

### PlatformMessage

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `direction` | ~enum PlatformMessageDirection |  |
| `messageType` | ~enum PlatformMessageType |  |
| `status` | ~enum PlatformMessageStatus |  |
| `text` | ~string |  |
| `humanDelegationSummary` | — |  |
| `reasoning` | — |  |
| `origin` | ~string |  |
| `platformTimestamp` | ~datetime |  |
| `externalMessageId` | ~string |  |
| `conversationId` | ~string |  |
| `createdById` | — |  |
| `imageId` | — | Image |
| `audioId` | — |  |
| `accountId` | ~string | Account |
| `fileId` | — | File |
| `metadata` | — |  |

### PlatformAudio

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `externalAudioId` | — |  |
| `mimeType` | — |  |
| `sha256` | — |  |
| `voice` | — |  |
| `transcription` | — |  |
| `durationInSeconds` | — |  |
| `fileId` | — | File |

### BillableAgentConversation

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `conversationId` | ~string |  |
| `accountId` | cuid | Account |
| `openingMessageId` | — |  |
| `isFree` | — |  |
| `chargebeeUsageId` | — |  |


## Conciliación bancaria

### Reconciliation

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | ~datetime? |  |
| `year` | — |  |
| `month` | — |  |
| `accountId` | cuid | Account |
| `reconciliationSourceId` | — | ReconciliationSource |

### ReconciliationMovement

| columna | tipo | relación |
|---|---|---|
| `id` | ~string |  |
| `createdAt` | ~datetime |  |
| `updatedAt` | ~datetime |  |
| `madeAt` | ~datetime |  |
| `accountId` | ~string | Account |
| `amount` | — |  |
| `description` | — |  |
| `type` | ~string |  |
| `status` | ~string |  |
| `reconciliationId` | — | Reconciliation |
| `comment` | — |  |

### ReconciliationMovementToPulposTransaction

| columna | tipo | relación |
|---|---|---|
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `reconciliationMovementId` | — | ReconciliationMovement |
| `transactionEntity` | — |  |
| `transactionId` | — |  |

### ReconciliationSource

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `name` | string |  |
| `type` | string |  |
| `accountId` | cuid | Account |
| `deletedAt` | datetime? |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### PaymentMethodReconciliationSource

| columna | tipo | relación |
|---|---|---|
| `paymentMethod` | — |  |
| `accountId` | cuid | Account |
| `reconciliationSourceId` | — | ReconciliationSource |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |


## Enums

- **AccountAffiliationStatus**: `PENDING`, `ACCEPTED`
- **AccountAffiliationType**: `RESELLER`, `REFERRAL`
- **AccountType**: `BUSINESS`, `RESELLER`
- **AffiliationPaymentOrigin**: `SUBSCRIPTION`, `BRANCH`, `INVOICE`
- **AffiliationPaymentStatus**: `PENDING`, `PAID`, `IN_REVIEW`, `REJECTED`
- **AffiliationPaymentStatusReason**: `SUBSCRIPTION_CANCELLED`, `UNUSUAL_ACTIVITY`, `MISSING_BANK_ACCOUNT_DETAILS`, `WRONG_BANK_ACCOUNT_DETAILS`, `CUSTOMER_UNPAID_INVOICES`, `OTHER`
- **AssistantAttachmentKind**: `IMAGE`, `AUDIO`, `VIDEO`, `DOCUMENT`
- **AssistantIssueSolved**: `YES`, `NO`
- **AssistantMessageRole**: `USER`, `ASSISTANT`, `SUPPORT_TEAM`
- **AssistantReviewStatus**: `OK`, `NOT_OK`
- **AssistantSupportRating**: `VERY_DISSATISFIED`, `DISSATISFIED`, `NEUTRAL`, `SATISFIED`, `VERY_SATISFIED`
- **AuthProvider**: `PASSWORD`, `GOOGLE`
- **AvgMonthlyBilling**: `NO_INCOME`, `LOWER_THAN_FIVE_THOUSAND`, `BETWEEN_FIVE_AND_TEN_THOUSAND`, `BETWEEN_TEN_AND_FIFTY_THOUSAND`, `MORE_THAN_FIFTY_THOUSAND`, `OPTION_1`, `OPTION_2`, `OPTION_3`, `OPTION_4`
- **BusinessType**: `GROCERIES`, `PHARMACY`, `HARDWARE`, `AUTO_PARTS`, `CLOTHING`, `ITEMS`, `BOOKS`, `FURNITURE`, `COFFEE`, `RESTAURANT`, `OTHER`, `PETS`, `HEALTH`, `JEWELRY`, `WHOLESALE`, `AUTO_REPAIR`, `ELECTRONICS`, `OPTICS`, `BAKERY`, `GREENGROCER`, `BUTCHERS`, `STATIONERY`, `BEAUTY`, `SERVICES`, `CLEANING`, `PRINTING`
- **CartDiscountType**: `PERCENTAGE`, `FIXED`
- **CashMovementType**: `EXPENSE_PAYMENT`, `MANUAL_MOVEMENT`, `PURCHASE_PAYMENT`
- **CashierAuditStatus**: `DRAFT`, `COMPLETED`
- **CatalogBannerType**: `PROMOTIONAL`
- **CatalogConfigAcquisitionLimit**: `LIMIT_TO_STOCK`, `UNLIMITED`
- **CatalogConfigCategories**: `SHOW`, `HIDE`
- **CatalogConfigProductsWithoutStock**: `SHOW`, `HIDE`
- **CatalogPhotoType**: `HERO`
- **CatalogUIVariant**: `RETAIL`, `WHOLESALE`
- **ChargebeeSubscriptionStatus**: `FUTURE`, `IN_TRIAL`, `ACTIVE`, `NON_RENEWING`, `PAUSED`, `CANCELLED`, `TRANSFERRED`
- **ClientType**: `GENERAL_PUBLIC`, `ACCOUNT_CLIENT`
- **CostType**: `NET`, `GROSS`
- **Country**: `MX`
- **Currency**: `MXN`
- **EmailType**: `CASHIER_AUDIT`, `DAILY_SUMMARY`, `CATALOG_ORDER`, `SELF_INVOICE`, `SUBSCRIPTION_INVOICE`
- **ExternalDigitalServiceCategoryType**: `MOBILE_POSTPAID`, `HOME`, `GOVERNMENT_AND_TAXES`, `FINANCIAL_SERVICES`, `CATALOG_PURCHASES`, `PREPAID_SERVICES`, `WATER_PAYMENT`, `ENTERTAINMENT`, `PUBLIC_TRANSPORT`, `OTHER`
- **ExternalDigitalServiceReferenceType**: `PHONE_NUMBER`, `BARCODE`, `CUSTOM`
- **ExternalDigitalServiceType**: `SERVICE_PAYMENT`, `RECHARGE`, `GIFT_CARD`, `BALANCE_CHECK`
- **FileAccess**: `PUBLIC`, `PRIVATE`
- **FileStatus**: `UPLOADED`, `CONNECTED`
- **ImageStatus**: `UPLOADED`, `CONNECTED`
- **ImageType**: `PRODUCT_PHOTO`, `LOGO`, `TICKET_LOGO`, `PRODUCT_CATEGORY_PHOTO`, `CATALOG_PHOTO`, `CATALOG_BANNER`, `CLIENT_PAYMENT_RECEIPT`, `WHATSAPP_MESSAGE`
- **InvoiceOrigin**: `POS`, `CLIENTS_PORTAL`
- **InvoiceStatus**: `VALID`, `VALID_CANCEL_PENDING`, `VALID_CANCEL_REJECTED`, `CANCELLED`
- **InvoiceType**: `INCOME`, `PAYMENT`, `CREDIT_NOTE`
- **ItemDiscountType**: `PERCENTAGE`, `FIXED`
- **LocationType**: `WAREHOUSE`, `BRANCH`
- **LogoType**: `ACCOUNT`, `TICKET`
- **LoyaltyProgramMovementOrigin**: `ORDER_EARN`, `ORDER_SPEND`, `ORDER_PAYMENT_EARN`, `ORDER_PAYMENT_DELETE_REVERT`, `ORDER_DELETE_EARN_REVERT`, `ORDER_REFUND_EARN_REVERT`, `ORDER_DELETE_SPEND_REVERT`, `ORDER_REFUND_SPEND_REVERT`, `ORDER_ASSIGN_CLIENT`, `ORDER_REMOVE_CLIENT`, `ADJUSTMENT`
- **ManufacturingOrderEventType**: `CREATED`, `STARTED`, `FINISHED`, `CANCELLED`, `COMMENT`, `USE_MATERIAL_STOCK`, `RETURN_MATERIAL_STOCK`
- **ManufacturingOrderStatus**: `CREATED`, `STARTED`, `FINISHED`, `CANCELLED`
- **MinProfitMarginPolicy**: `WARN`, `BLOCK`
- **MultiTargetPromotionType**: `TWO_FOR_ONE`, `THREE_FOR_TWO`, `SECOND_FIFTY_PERCENT`, `THIRD_FIFTY_PERCENT`, `CUSTOM`, `ADVANCED`
- **OnlinePaymentStatus**: `PENDING`, `COMPLETED`, `FAILED`
- **OrderItemPriceType**: `DEFAULT`, `PERSONALIZED`
- **OrderOrigin**: `POS`, `POS_SAVE_AS_ORDER`, `ONLINE_CATALOG`, `DIRECT_INVOICE`
- **OrderPaymentNotificationStatus**: `PENDING`, `ACCEPTED`, `REJECTED`
- **OrderPaymentStatus**: `COMPLETED`, `PENDING`, `CANCELLED`, `REFUNDED`
- **OrderRefundReason**: `CHANGE_OF_MIND`, `EXPIRED_PRODUCT`, `DAMAGED_GOODS`, `WRONG_PRODUCT`, `WRONG_VARIANT`, `OTHER`
- **OrderShippingMethod**: `TO_AGREE_AFTER_PURCHASE`, `PICKUP`, `DELIVERY`
- **OrderShippingStatus**: `PENDING`, `COMPLETED`, `CANCELLED`, `RETURNED`
- **OrderWayOfPayment**: `TO_AGREE_AFTER_PURCHASE`, `MERCADOPAGO`, `BANK_TRANSFER`, `CREDIT`, `COLLECT_ON_DELIVERY`
- **OutlayInvoiceFileType**: `PDF`, `XML`
- **PaymentMethod**: `CASH`, `CARD`, `TRANSFER`, `CHECK`, `CREDIT`, `DEBIT_CARD`, `PAYMENT_INTERMEDIARY`, `ELECTRONIC_WALLET`, `ELECTRONIC_MONEY`, `SERVICE_CARD`, `FOOD_VOUCHER`
- **PlatformMessageDirection**: `INBOUND`, `OUTBOUND`
- **PlatformMessageSender**: `HUMAN`, `SELLER_AGENT`
- **PlatformMessageStatus**: `PENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`
- **PlatformMessageType**: `TEXT`, `AUDIO`, `IMAGE`, `BUTTON`, `DOCUMENT`, `VIDEO`, `STICKER`, `OTHER`
- **PlatformSource**: `WHATSAPP`
- **PrintingMode**: `SYSTEM_PRINTING`, `ZADIG_PRINTING`
- **ProductType**: `PRODUCT`, `COMBO`, `SERVICE`
- **PromotionAmountType**: `FIXED`, `PERCENTAGE`
- **PromotionApplicationType**: `MANUAL`, `AUTOMATIC`
- **PromotionClientRestriction**: `NO_RESTRICTION`, `REGISTERED_CLIENTS`, `CLIENTS_LIST`
- **PromotionType**: `CART_TOTAL`, `SINGLE_TARGET`, `MULTI_TARGET`, `MULTI_TARGET_ADVANCED`
- **PulposAppCommunicationType**: `ALERT`, `ERROR`, `SUCCESS`, `INFO`, `NEWS`, `RELEASE`
- **PulposAppSuggestionSource**: `AI_ASSISTANT`, `AI_SELLER`, `HEADER`, `NATIVE`
- **PurchaseStatus**: `DRAFT`, `COMPLETED`
- **QuotationItemPriceType**: `DEFAULT`, `PERSONALIZED`
- **QuotationStatus**: `CREATED`, `SOLD`
- **ReconciliationMovementStatus**: `PENDING`, `DONE`
- **ReconciliationMovementType**: `INCOME`, `SPEND`
- **ReconciliationPulposTransactionEntity**: `ORDER`, `ORDER_PAYMENT`, `ORDER_UNIFIED_PAYMENT`, `ORDER_REFUND_PAYMENT`, `PURCHASE`, `PURCHASE_PAYMENT`, `EXPENSE`, `EXPENSE_PAYMENT`
- **ReconciliationSourceType**: `BANK`, `DIGITAL_BANK`, `CREDIT_CARD`
- **Role**: `ADMIN`, `USER`, `SUPERADMIN`
- **SelfInvoicePolicy**: `NO_SELF_INVOICE`, `UNTIL_END_OF_MONTH`, `CUSTOM_PERIOD`
- **SettingBatchStrategy**: `MANUAL`, `AUTOMATIC`
- **SettingGlobalInvoiceGrouping**: `BY_MONTH`, `BY_WEEK`, `BY_DAY`
- **StockAdjustmentEventType**: `CREATED_AS_DRAFT`, `CREATED_AS_COMPLETED`, `UPDATED_WHILE_DRAFT`, `COMPLETED`, `COMMENT`
- **StockAdjustmentStatus**: `DRAFT`, `COMPLETED`
- **StockAdjustmentType**: `ENTRY`, `EXIT`, `COUNT`
- **StockMovementAdjustmentReason**: `CORRECTION`, `RECOUNT`, `EXPIRATION`, `THEFT_OR_LOSS`, `DETERIORATION`, `GIFT`, `MASSIVE_EDITION`, `PLAN_LIMITATION`
- **StockMovementDiscriminator**: `BASIC`, `BATCH`, `VARIANT`
- **StockMovementOrigin**: `PRODUCT_CREATE`, `ORDER_CREATE`, `ORDER_DELETE`, `ORDER_RETURN`, `PURCHASE_CREATE`, `PURCHASE_DELETE`, `TRANSFER_SEND`, `TRANSFER_RECEIVE`, `LOCATION_DELETE`, `ADJUSTMENT`, `ADJUSTMENT_CHANGE_STOCK_TRACKING`, `MANUFACTURING_MATERIAL_USE`, `MANUFACTURING_MATERIAL_RETURN`, `MANUFACTURING_PRODUCTION`, `TRANSFER_DELETE`, `STOCK_ADJUSTMENT`, `STOCK_ADJUSTMENT_DELETE`
- **StoreAgentFAQCategory**: `SHIPPING_METHODS`, `OPENING_HOURS`, `RETURN_POLICY`, `ABOUT`, `CUSTOM`
- **StoreAgentKnowledgeFileType**: `PDF`, `CSV`, `XLSX`
- **StoreAgentOutOfStockPolicy**: `NOTIFY`, `IGNORE_PRODUCTS`
- **StoreAgentResponseLength**: `SHORT`, `MEDIUM`, `LONG`
- **TaxType**: `VAT`, `IEPS`, `ISR`
- **TransferEventType**: `CREATED`, `SENT`, `RECEIVED`, `UPDATED_WHILE_DRAFT`, `COMMENT`
- **TransferStatus**: `DRAFT`, `SENT`, `RECEIVED`
- **TypeOfSale**: `RETAIL`, `WHOLESALE`