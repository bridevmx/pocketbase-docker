// Enums compartidos (valores en minúsculas; equivalen a los enums de Pulpos en MAYÚSCULAS).
export const PAYMENT_METHOD = ['cash', 'card', 'transfer', 'check', 'credit', 'debit_card', 'payment_intermediary', 'electronic_wallet', 'electronic_money', 'service_card', 'food_voucher'];
export const BUSINESS_TYPE = ['groceries', 'pharmacy', 'hardware', 'auto_parts', 'clothing', 'items', 'books', 'furniture', 'coffee', 'restaurant', 'other', 'pets', 'health', 'jewelry', 'wholesale', 'auto_repair', 'electronics', 'optics', 'bakery'];
export const FEATURE = ['manufacturing', 'bank_reconciliations', 'whatsapp_sales_channel', 'catalog_plus', 'white_label', 'extra_branch', 'extra_user', 'ai_seller'];
export const DISCOUNT_TYPE = ['percentage', 'fixed'];
export const PRODUCT_TYPE = ['product', 'combo', 'service'];
export const COST_TYPE = ['net', 'gross'];
export const ORDER_ORIGIN = ['pos', 'pos_save_as_order', 'online_catalog', 'direct_invoice'];
export const PAYMENT_STATUS = ['completed', 'pending', 'cancelled', 'refunded'];
export const SHIPPING_STATUS = ['pending', 'completed', 'cancelled', 'returned'];
export const WAY_OF_PAYMENT = ['to_agree_after_purchase', 'mercadopago', 'clip', 'bank_transfer', 'credit', 'collect_on_delivery'];
export const SHIPPING_METHOD = ['to_agree_after_purchase', 'pickup', 'delivery'];
export const PRICE_TYPE = ['default', 'personalized'];
export const REFUND_REASON = ['change_of_mind', 'expired_product', 'damaged_goods', 'wrong_product', 'wrong_variant', 'other'];
export const STOCK_ORIGIN = ['product_create', 'order_create', 'order_delete', 'order_return', 'purchase_create', 'purchase_delete', 'transfer_send', 'transfer_receive', 'transfer_delete', 'location_delete', 'adjustment', 'stock_adjustment', 'stock_adjustment_delete', 'manufacturing_material_use', 'manufacturing_material_return', 'manufacturing_production', 'change_stock_tracking'];
export const ADJUSTMENT_REASON = ['correction', 'recount', 'expiration', 'theft_or_loss', 'deterioration', 'gift', 'massive_edition', 'plan_limitation'];
export const LOYALTY_ORIGIN = ['order_earn', 'order_spend', 'order_payment_earn', 'order_payment_delete_revert', 'order_delete_earn_revert', 'order_refund_earn_revert', 'order_delete_spend_revert', 'order_refund_spend_revert', 'order_assign_client', 'order_remove_client', 'adjustment'];
export const WEEKDAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
