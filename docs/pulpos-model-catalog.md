# Catálogo de modelos de Pulpos (156 tablas)

Derivado del cliente web: `Prisma.<Modelo>ScalarFieldEnum` (columnas exactas) + esquemas zod del bundle (tipos) + respuestas reales de la API.
Tipos con `?` = nullable. `—` = tipo no observable en el bundle (ver enums y muestras). Las relaciones son **inferidas por nombre de columna** y corregidas a mano donde se verificó con datos reales.

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
| `amplitudeId` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountType` | — |  |

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
| `id` | — |  |
| `openIdSub` | — |  |
| `accountId` | — | Account |
| `email` | — |  |
| `name` | — |  |
| `surname` | — |  |
| `phoneNumber` | — |  |
| `isAccountOwner` | — |  |
| `lastLogin` | — |  |
| `seenReleaseStartDate` | — |  |
| `updatesHubLastSeenAt` | — |  |
| `updatesHubLastDismissedAt` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `slug` | — |  |
| `role` | — |  |
| `advancedPermissions` | — |  |
| `defaultPriceTypeId` | — | CustomPriceType |
| `authProviders` | — |  |

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
| `numberOfEmployees` | — |  |
| `ticketDetailsId` | — | TicketDetails |
| `phoneNumber` | — |  |
| `email` | — |  |
| `selfInvoiceProfileId` | — | SelfInvoiceProfile |
| `accountantsEmails` | — |  |

### Location

| columna | tipo | relación |
|---|---|---|
| `name` | — |  |
| `id` | — |  |
| `phoneNumber` | — |  |
| `email` | — |  |
| `type` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `isDefault` | — |  |
| `defaultPriceTypeId` | — | CustomPriceType |
| `addressId` | — | Address |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `invoicingSettingsId` | — | InvoicingSettings |

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
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
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
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `url` | — |  |
| `filename` | — |  |
| `externalId` | — |  |
| `imageType` | — |  |
| `status` | — |  |
| `metadata` | — |  |

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
| `accountId` | — | Account |
| `allowPersonalizedPrices` | boolean |  |
| `whiteLabelBranding` | boolean |  |
| `allowedPaymentMethods` | enum PaymentMethod |  |
| `enabledUnits` | — |  |
| `defaultClientDebtLimit` | decimal? |  |
| `showClientsPortalURLOnTickets` | boolean |  |
| `showClientsPortalURLOnPDFs` | boolean |  |
| `accountFeatures` | — |  |

### ManufacturingSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
| `defaultLocationId` | — | Location |
| `allowManufacturingMaterialsOutOfStock` | — |  |

### StockSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
| `notifyMovingNegativeStock` | — |  |
| `allowMovingNegativeStock` | — |  |

### QuotationSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
| `breakdownTaxesInQuotations` | boolean |  |
| `notifyInsufficientStockForQuotation` | boolean |  |
| `quotationsFixedNote` | string? |  |
| `defaultValidity` | decimal? |  |

### OrderSettings

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
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
| `userId` | — | User |
| `content` | string |  |
| `source` | — |  |
| `metadata` | — |  |

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
| `imageId` | — | Image |
| `type` | — |  |

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
| `userId` | — | User |
| `name` | string |  |
| `surname` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |

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
| `deletedAt` | — |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `name` | string |  |
| `isDefault` | — |  |

### ProductCustomPrice

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `productId` | — | Product |
| `customPriceTypeId` | — | CustomPriceType |
| `price` | decimal |  |
| `priceCurrency` | enum Currency |  |
| `breakpoint` | decimal |  |

### Product

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `sellUnit` | — |  |
| `cost` | — |  |
| `costCurrency` | — |  |
| `costType` | — |  |
| `satCategoryCode` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `batchesEnabled` | — |  |
| `prescriptionRequired` | — |  |
| `type` | — |  |
| `profileId` | — | ProductProfile |
| `isStockable` | — |  |

### ProductProfile

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `userIdCreatedBy` | — | User |
| `name` | — |  |
| `slug` | — |  |
| `description` | — |  |
| `barcode` | — |  |
| `sku` | — |  |
| `categoryId` | — |  |
| `brandId` | — |  |
| `hiddenAt` | — |  |
| `displayInCatalog` | — |  |
| `isSellable` | — |  |
| `isTest` | — |  |
| `parentId` | — | ProductProfile |
| `variantConfig` | — |  |
| `isManufactured` | — |  |

### ProductCombination

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
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
| `type` | — |  |
| `isExempt` | boolean |  |
| `isWithheld` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### SatCategory

| columna | tipo | relación |
|---|---|---|
| `code` | — |  |
| `description` | — |  |
| `similarTerms` | — |  |
| `parentCode` | — |  |

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
| `imageId` | — | Image |
| `accountId` | cuid | Account |
| `index` | — |  |
| `productProfileId` | — | ProductProfile |

### ProductCategoryPhoto

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `categoryId` | — |  |
| `imageId` | — | Image |


## Inventario

### ProductStock

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `productId` | — | Product |
| `locationId` | — | Location |
| `stockQuantity` | — |  |
| `minStockQuantity` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### ProductStorage

| columna | tipo | relación |
|---|---|---|
| `accountId` | cuid | Account |
| `productId` | — | Product |
| `locationId` | — | Location |
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
| `stockQuantity` | — |  |
| `productBatchId` | — | ProductBatch |
| `minStockQuantity` | — |  |
| `locationId` | — | Location |

### ProductBatch

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `productId` | — | Product |
| `code` | — |  |
| `expiresAt` | — |  |
| `fabricatedAt` | — |  |
| `deletedAt` | — |  |

### StockMovement

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `userIdCreatedBy` | — | User |
| `accountId` | — | Account |
| `previousQuantity` | — |  |
| `currentQuantity` | — |  |
| `locationId` | — | Location |
| `productProfileId` | — | ProductProfile |
| `discriminator` | — |  |
| `discriminatorType` | — |  |
| `discriminatorId` | — |  |
| `adjustmentReason` | — |  |
| `origin` | — |  |
| `originId` | — |  |

### Transfer

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `transferNumber` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |
| `accountId` | cuid | Account |
| `status` | — |  |
| `originId` | — | Location |
| `destinationId` | — | Location |

### TransferItem

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `transferId` | — | Transfer |
| `productId` | — | Product |
| `quantitySent` | — |  |
| `quantityReceived` | — |  |
| `quantityUnit` | — |  |

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
| `transferId` | — | Transfer |
| `userIdCreatedBy` | — | User |
| `type` | — |  |
| `content` | string |  |

### StockAdjustment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `stockAdjustmentNumber` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | datetime? |  |
| `accountId` | cuid | Account |
| `locationId` | cuid | Location |
| `userIdCreatedBy` | cuid | User |
| `status` | enum PurchaseStatus |  |
| `type` | — |  |
| `reason` | — |  |
| `notes` | string? |  |

### StockAdjustmentItem

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `stockAdjustmentId` | — | StockAdjustment |
| `productId` | — | Product |
| `previousQuantity` | — |  |
| `inputQuantity` | — |  |
| `quantityUnit` | — |  |
| `unitCost` | — |  |
| `unitPrice` | — |  |

### StockAdjustmentItemBatchQuantity

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
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
| `stockAdjustmentId` | — | StockAdjustment |
| `userIdCreatedBy` | — | User |
| `type` | — |  |
| `content` | string |  |

### ManufacturingOrder

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `manufacturingOrderNumber` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `startedAt` | — |  |
| `finishedAt` | — |  |
| `deletedAt` | — |  |
| `notes` | — |  |
| `status` | — |  |
| `initialQuantity` | — |  |
| `manufacturedQuantity` | — |  |
| `locationId` | — | Location |
| `productProfileId` | — | ProductProfile |

### ManufacturingOrderMaterialItem

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `materialId` | — | ProductProfile |
| `manufacturingOrderId` | — | ManufacturingOrder |
| `quantity` | — |  |
| `quantityUnit` | — |  |

### ManufacturingOrderEvent

| columna | tipo | relación |
|---|---|---|
| `id` | string |  |
| `createdAt` | datetime |  |
| `manufacturingOrderId` | — | ManufacturingOrder |
| `userIdCreatedBy` | — | User |
| `type` | — |  |
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
| `allowsIncome` | — |  |
| `allowsSpend` | — |  |
| `method` | — |  |
| `reconciliationSourceId` | — | ReconciliationSource |

### OrderPayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `madeAt` | datetime |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | datetime? |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | cuid | User |
| `orderId` | cuid | Order |
| `method` | enum PaymentMethod |  |
| `total` | — |  |
| `totalCurrency` | enum Currency |  |
| `cancelsPaymentId` | — | OrderPayment (CREDIT que se liquida) |
| `invoiceId` | — | Invoice |
| `cashierId` | cuid | Cashier |
| `change` | — |  |
| `unifiedDebtPaymentId` | — | UnifiedDebtPayment |
| `orderPaymentNotificationId` | — | OrderPaymentNotification |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |
| `loyaltyPointsReward` | — |  |

### OrderPaymentNotification

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `status` | — |  |
| `clientId` | — | Client |
| `amount` | — |  |
| `amountCurrency` | — |  |
| `paymentReceiptImageId` | — | Image |

### UnifiedDebtPayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |
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
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `orderId` | — | Order |
| `accountId` | — | Account |
| `productId` | — | Product |
| `customPriceTypeId` | — | CustomPriceType |
| `quantity` | — |  |
| `quantityUnit` | — |  |
| `unitPrice` | — |  |
| `unitPriceCurrency` | — |  |
| `unitCostNet` | — |  |
| `unitCostNetCurrency` | — |  |
| `total` | — |  |
| `totalCurrency` | — |  |
| `totalCostNet` | — |  |
| `totalCostNetCurrency` | — |  |
| `priceBreakpoint` | — |  |
| `name` | — |  |
| `type` | — |  |
| `inComboId` | — | OrderItemProduct |
| `prescriptionId` | — | Prescription |
| `priceType` | — |  |
| `satCategoryCode` | — |  |
| `discountId` | — |  |
| `digitalServiceItemId` | — |  |

### OrderDeliveryCost

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `orderId` | — | Order |
| `amount` | — |  |
| `amountCurrency` | — |  |

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
| `originalTotal` | — |  |
| `total` | decimal |  |
| `totalCurrency` | enum Currency |  |
| `madeAt` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |
| `locationId` | — | Location |
| `invoiceId` | — | Invoice |
| `clientId` | cuid? | Client |
| `deliveryAddressId` | — | Address |
| `customPriceTypeId` | string | CustomPriceType |
| `orderSeriesId` | — | OrderSeries |
| `isTest` | — |  |
| `isOffline` | — |  |
| `wayOfPayment` | — |  |
| `shippingMethod` | — |  |
| `quotationId` | — | Quotation |
| `requestId` | — |  |
| `withTaxes` | — |  |
| `isSellingDigitalService` | — |  |
| `loyaltyPointsRewardPercentage` | — |  |
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
| `isDefault` | — |  |
| `deletedAt` | — |  |

### OrderRefund

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `orderId` | — | Order |
| `reason` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `totalRefunded` | — |  |
| `subtotalRefunded` | — |  |
| `cancelledDebt` | — |  |
| `totalCurrency` | — |  |
| `userIdCreatedBy` | — | User |
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
| `orderItemId` | — |  |
| `orderRefundId` | — | OrderRefund |
| `quantityRefunded` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### OrderRefundPayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | — | Account |
| `orderRefundId` | — | OrderRefund |
| `method` | enum PaymentMethod |  |
| `totalRefunded` | — |  |
| `totalCurrency` | enum Currency |  |
| `cashierId` | cuid | Cashier |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### OrderDebt

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `dueDate` | — |  |
| `accountId` | — | Account |
| `orderId` | — | Order |
| `originalDebt` | — |  |
| `currentDebt` | — |  |
| `currency` | — |  |
| `paymentIdCredit` | — | OrderPayment |

### OrderJournal

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `orderId` | — | Order |
| `events` | json |  |

### QuotationJournal

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `accountId` | cuid | Account |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `quotationId` | — | Quotation |
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
| `id` | — |  |
| `userFriendlyId` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `addressId` | — | Address |
| `name` | — |  |
| `surname` | — |  |
| `phoneNumber` | — |  |
| `email` | — |  |
| `fiscalProfileId` | — | FiscalProfile |
| `type` | — |  |
| `comments` | — |  |
| `defaultPriceTypeId` | — | CustomPriceType |
| `lastDebtReminderSentAt` | — |  |
| `loyaltyPoints` | — |  |
| `aiAgentEnabled` | — |  |

### Quotation

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `userFriendlyId` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `deletedAt` | — |  |
| `quotationNumber` | bigint |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `validFrom` | datetime? |  |
| `expiresAt` | datetime? |  |
| `subtotal` | — |  |
| `subtotalCurrency` | enum Currency |  |
| `status` | enum QuotationStatus |  |
| `clientId` | cuid? | Client |
| `clientNote` | string |  |
| `customPriceTypeId` | — | CustomPriceType |
| `locationId` | cuid? | Location |
| `withTaxes` | boolean |  |
| `notes` | — |  |
| `deliveryAddressId` | — | Address |
| `sellerId` | — | Seller |

### QuotationItem

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `quotationId` | — | Quotation |
| `productId` | — | Product |
| `quantity` | decimal |  |
| `quantityUnit` | — |  |
| `sellPrice` | decimal |  |
| `sellPriceCurrency` | enum Currency |  |
| `customPriceTypeId` | — | CustomPriceType |
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
| `quotationItemId` | — | QuotationItem |
| `name` | — |  |
| `cost` | — |  |
| `costCurrency` | — |  |

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
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `name` | — |  |
| `type` | — |  |
| `application` | — |  |
| `validFrom` | — |  |
| `validUntil` | — |  |
| `userIdCreatedBy` | — | User |
| `lastUpdatedByUserId` | — | User |
| `restrictToClients` | — |  |
| `daysOfWeekLimitation` | — |  |

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
| `id` | — |  |
| `accountId` | — | Account |
| `promotionId` | — | Promotion |
| `amount` | — |  |
| `amountType` | — |  |
| `minCartSubtotal` | — |  |

### SingleTargetPromotion

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `accountId` | — | Account |
| `promotionId` | — | Promotion |
| `amount` | — |  |
| `amountType` | — |  |
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
| `rewardPercentage` | — |  |
| `minCartTotalLimitation` | — |  |

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
| `accountId` | — | Account |
| `loyaltyProgramId` | — | LoyaltyProgram |
| `productProfileId` | — | ProductProfile |
| `rewardPercentage` | — |  |

### LoyaltyProgramCategorySpecificReward

| columna | tipo | relación |
|---|---|---|
| `accountId` | — | Account |
| `loyaltyProgramId` | — | LoyaltyProgram |
| `categoryId` | — |  |
| `rewardPercentage` | — |  |

### LoyaltyProgramMovement

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `clientId` | — | Client |
| `previousQuantity` | — |  |
| `currentQuantity` | — |  |
| `origin` | — |  |
| `orderId` | — | Order |
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
| `total` | — |  |
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
| `dueDate` | — |  |
| `purchaseId` | cuid | Purchase |
| `originalDebt` | — |  |
| `currentDebt` | decimal |  |
| `currency` | enum Currency |  |

### PurchasePayment

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | — | Account |
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
| `stockQuantity` | — |  |
| `purchaseItemId` | — | PurchaseItem |
| `productBatchId` | cuid | ProductBatch |

### PurchaseItem

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `purchaseId` | — | Purchase |
| `productId` | — | Product |
| `quantity` | decimal |  |
| `quantityUnit` | — |  |
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
| `concept` | — |  |
| `expenseNumber` | — |  |
| `accountId` | cuid | Account |
| `userIdCreatedBy` | cuid | User |
| `madeAt` | datetime |  |
| `total` | — |  |
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
| `accountId` | — | Account |
| `expenseId` | — | Expense |
| `userIdCreatedBy` | cuid | User |
| `madeAt` | datetime |  |
| `total` | — |  |
| `totalCurrency` | enum Currency |  |
| `cashMovementId` | — | CashMovement |
| `method` | enum PaymentMethod |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### ExpenseDebt

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `dueDate` | — |  |
| `currentDebt` | — |  |
| `originalDebt` | — |  |
| `currency` | — |  |
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
| `deletedAt` | — |  |
| `accountId` | cuid | Account |
| `name` | string |  |
| `isDefault` | — |  |
| `locationId` | — | Location |
| `orderSeriesId` | — | OrderSeries |

### CashierAudit

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `userIdCreatedBy` | — | User |
| `cashIn` | decimal |  |
| `cashInCurrency` | enum Currency |  |
| `cashOut` | decimal |  |
| `cashOutCurrency` | enum Currency |  |
| `comments` | string? |  |
| `status` | — |  |
| `periodStart` | — |  |
| `periodEnd` | — |  |
| `cashierId` | cuid | Cashier |

### CashierAuditItem

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `cashierAuditId` | — | CashierAudit |
| `method` | enum PaymentMethod |  |
| `totalExpected` | — |  |
| `totalExpectedCurrency` | — |  |
| `totalAudited` | decimal |  |
| `totalAuditedCurrency` | enum Currency |  |
| `customPaymentMethodId` | cuid? | CustomPaymentMethod |

### CashMovement

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `userId` | — | User |
| `details` | — |  |
| `amount` | — |  |
| `currency` | — |  |
| `cashierId` | — | Cashier |
| `type` | — |  |


## Facturación (fuera de alcance por ahora)

### FiscalProfile

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `fiscalName` | — |  |
| `addressId` | — | Address |
| `issuingAddressId` | — | Address |
| `fiscalRegimeId` | — | FiscalRegime |
| `fiscalCode` | — |  |

### SelfInvoiceProfile

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `fiscalProfileId` | — | FiscalProfile |
| `fiscalUseCaseId` | — | FiscalUseCase |

### FiscalRegime

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `country` | — |  |
| `code` | — |  |

### FiscalUseCase

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `country` | — |  |
| `code` | — |  |

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
| `subdomain` | — |  |
| `accountId` | cuid | Account |

### CatalogConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `catalogId` | — | Catalog |
| `name` | — |  |
| `phoneNumber` | — |  |
| `facebook` | — |  |
| `instagram` | — |  |
| `customerSupportWhatsApp` | — |  |
| `emailContact` | — |  |
| `configProductsWithoutStock` | — |  |
| `configAcquisitionLimit` | — |  |
| `configCategories` | — |  |
| `locationOfOriginId` | — |  |
| `sharedInInstagram` | — |  |
| `sharedInWhatsApp` | — |  |
| `uiVariant` | — |  |
| `areClientCatalogsEnabled` | — |  |
| `isVolumePricingEnabled` | — |  |

### LocationStockVisibilityToCatalog

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `catalogConfigurationId` | — | CatalogConfiguration |
| `locationId` | — | Location |

### CatalogOrderShippingConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `shippingMethods` | enum OrderShippingMethod |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `pickUpAddressId` | — | Address |
| `pickUpInstructions` | string |  |
| `deliveryInstructions` | string |  |
| `deliveryDefaultPrice` | decimal |  |
| `agreedAfterPurchaseInstructions` | string |  |
| `catalogConfigurationId` | — | CatalogConfiguration |

### CatalogOrderPaymentConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `wayOfPayments` | enum OrderWayOfPayment |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `bankTransferInstructions` | string |  |
| `agreedAfterPurchaseInstructions` | string |  |
| `creditInstructions` | string |  |
| `collectOnDeliveryInstructions` | string |  |
| `catalogConfigurationId` | — | CatalogConfiguration |

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
| `id` | — |  |
| `catalogId` | — | Catalog |
| `isActive` | boolean |  |
| `heroPhotoId` | — |  |
| `showHeroPhoto` | boolean |  |
| `title` | string? |  |
| `mainButtonText` | string? |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |

### CatalogPhoto

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `imageId` | — | Image |
| `accountId` | cuid | Account |
| `catalogId` | — | Catalog |
| `type` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### CatalogBanner

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `imageId` | — | Image |
| `accountId` | cuid | Account |
| `catalogId` | — | Catalog |
| `type` | — |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |

### CatalogVariantConfig

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `path` | — |  |
| `hidden` | — |  |
| `accountId` | cuid | Account |
| `customPriceTypeId` | — | CustomPriceType |

### StoreAgentConfiguration

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `disabledAt` | — |  |
| `accountId` | — | Account |
| `testMessagesSentCount` | — |  |
| `supportCallOfferedCount` | — |  |
| `agentName` | — |  |
| `agentDescription` | — |  |
| `disclosesAiIdentity` | — |  |
| `responseLength` | — |  |
| `useEmojisInResponses` | — |  |
| `defaultAccessCustomPriceTypeId` | — | CustomPriceType |
| `outOfStockPolicy` | — |  |

### StoreAgentAccessToLocation

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `agentId` | — |  |
| `locationId` | — | Location |

### StoreAgentFAQ

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `storeAgentConfigurationId` | — | StoreAgentConfiguration |
| `userIdCreatedBy` | — | User |
| `category` | — |  |
| `title` | — |  |
| `description` | — |  |

### StoreAgentDelegationPolicy

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `storeAgentConfigurationId` | — | StoreAgentConfiguration |
| `userIdCreatedBy` | — | User |
| `title` | — |  |
| `description` | — |  |
| `deactivatedAt` | — |  |

### AiConversation

| columna | tipo | relación |
|---|---|---|
| `id` | cuid |  |
| `createdAt` | datetime |  |
| `updatedAt` | datetime |  |
| `accountId` | cuid | Account |
| `userId` | — | User |
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
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `accountId` | — | Account |
| `hasMadeFirstBalanceDeposit` | — |  |
| `gestoPagosCredentialsId` | — | GestoPagosCredentials |
| `commissionCurrency` | — |  |
| `rechargesCommission` | — |  |
| `servicePaymentsCommission` | — |  |
| `giftCardsCommission` | — |  |
| `isEnabled` | — |  |

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
| `displayPhoneNumber` | — |  |
| `accessToken` | — |  |
| `displayName` | — |  |

### PlatformConversation

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `deletedAt` | — |  |
| `accountId` | — | Account |
| `clientId` | — | Client |
| `displayPhoneNumber` | — |  |
| `displayName` | — |  |
| `lastMessageAt` | — |  |
| `lastInboundMessageAt` | — |  |
| `isAssignedToAI` | — |  |
| `markedUnreadAt` | — |  |
| `isTest` | — |  |
| `source` | — |  |
| `externalUserId` | — | User |

### PlatformMessage

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `direction` | — |  |
| `messageType` | — |  |
| `status` | — |  |
| `text` | — |  |
| `humanDelegationSummary` | — |  |
| `reasoning` | — |  |
| `origin` | — |  |
| `platformTimestamp` | — |  |
| `externalMessageId` | — |  |
| `conversationId` | — |  |
| `createdById` | — |  |
| `imageId` | — | Image |
| `audioId` | — |  |
| `accountId` | — | Account |
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
| `conversationId` | — |  |
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
| `deletedAt` | — |  |
| `year` | — |  |
| `month` | — |  |
| `accountId` | cuid | Account |
| `reconciliationSourceId` | — | ReconciliationSource |

### ReconciliationMovement

| columna | tipo | relación |
|---|---|---|
| `id` | — |  |
| `createdAt` | — |  |
| `updatedAt` | — |  |
| `madeAt` | — |  |
| `accountId` | — | Account |
| `amount` | — |  |
| `description` | — |  |
| `type` | — |  |
| `status` | — |  |
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