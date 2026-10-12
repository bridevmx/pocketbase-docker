# Schema de PocketBase (generado)

Generado por `tools/build-schema.mjs` desde `schema/*.mjs`. **94 colecciones**, sin campos `json`.

Tipos: `text` `number` `bool` `date` `select(...)` `file` `rel→colección` (`[]` = relación múltiple). `deleted_at` = borrado lógico.

## `business`

*reglas propias*

| campo | tipo |
|---|---|
| `name` * | text |
| `business_type` | select(groceries\|pharmacy\|hardware\|auto_parts\|clothing\|items\|books\|furniture\|coffee\|restaurant\|other\|pets\|health\|jewelry\|wholesale\|auto_repair\|electronics\|optics\|bakery) |
| `type_of_sale` | select(retail\|wholesale) |
| `currency` * | select(mxn) |
| `phone` | text |
| `email` | email |
| `utc_offset_minutes` | number |
| `logo` | file |
| `owner` | rel→users |

## `license`

*reglas propias*

| campo | tipo |
|---|---|
| `plan_code` | text |
| `plan_name` | text |
| `status` * | select(trial\|active\|past_due\|suspended\|cancelled) |
| `trial_ends_at` | date |
| `paid_until` | date |
| `max_users` | number |
| `max_branches` | number |
| `max_warehouses` | number |

## `license_features`

*reglas propias*

| campo | tipo |
|---|---|
| `feature` * | select(manufacturing\|bank_reconciliations\|whatsapp_sales_channel\|catalog_plus\|white_label\|extra_branch\|extra_user\|ai_seller) |

Únicos: (feature)

## `users` (extiende la colección auth `users`)

*reglas propias*

| campo | tipo |
|---|---|
| `surname` | text |
| `phone` | text |
| `role` * | select(admin\|user) |
| `is_owner` | bool |
| `deleted_at` | date |
| `default_price_list` | rel→price_lists |
| `locations` | rel→locations [] |
| `cashiers` | rel→cashiers [] |
| `price_lists` | rel→price_lists [] |
| `permissions` | rel→permissions [] |

## `permissions`

*catálogo global (solo lectura)*

| campo | tipo |
|---|---|
| `key` * | text |
| `subject` * | text |
| `action` * | text |
| `requires` | rel→permissions [] |

Únicos: (key)

## `measure_units`

*catálogo global (solo lectura)*

| campo | tipo |
|---|---|
| `key` * | text |
| `name_singular` * | text |
| `name_plural` * | text |
| `abbreviation` | text |

Únicos: (key)

## `taxes`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `type` * | select(vat\|ieps\|isr) |
| `name` | text |
| `percentage` | number |
| `is_exempt` | bool |
| `is_withheld` | bool |

## `addresses`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `street` | text |
| `ext_number` | text |
| `int_number` | text |
| `postal_code` | text |
| `neighborhood` | text |
| `district` | text |
| `city` | text |
| `state_code` | text |
| `country` | text |

## `locations`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `name` * | text |
| `type` * | select(branch\|warehouse) |
| `is_default` | bool |
| `phone` | text |
| `email` | email |
| `address` | rel→addresses |
| `default_price_list` | rel→price_lists |
| `deleted_at` | date |

## `price_lists`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `name` * | text |
| `is_default` | bool |
| `catalog_path` | text |
| `catalog_hidden` | bool |
| `deleted_at` | date |

Únicos: (catalog_path) donde catalog_path != "" AND deleted_at = ""

## `order_series`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `name` * | text |
| `location` | rel→locations |
| `next_number` | number |
| `is_default` | bool |
| `deleted_at` | date |

## `cashiers`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `name` * | text |
| `location` * | rel→locations |
| `order_series` | rel→order_series |
| `is_default` | bool |
| `deleted_at` | date |

## `sellers`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `user` | rel→users |
| `name` * | text |
| `surname` | text |
| `deleted_at` | date |

## `pos_settings`

*reglas propias*

| campo | tipo |
|---|---|
| `allow_personalized_prices` | bool |
| `white_label_branding` | bool |
| `default_client_debt_limit` | number |
| `show_portal_url_on_tickets` | bool |
| `show_portal_url_on_pdfs` | bool |
| `batch_strategy` * | select(manual\|automatic) |
| `allow_selling_out_of_stock` | bool |
| `notify_insufficient_stock_for_sale` | bool |
| `restrict_selling_to_clients_with_overdue_debt` | bool |
| `min_profit_margin_enabled` | bool |
| `min_profit_margin` | number |
| `min_profit_margin_policy` | select(warn\|block) |
| `allow_negative_stock_movements` | bool |
| `notify_negative_stock_movements` | bool |
| `quotation_breakdown_taxes` | bool |
| `quotation_notify_insufficient_stock` | bool |
| `quotation_fixed_note` | text |
| `quotation_default_validity_days` | number |
| `manufacturing_default_location` | rel→locations |
| `manufacturing_allow_materials_out_of_stock` | bool |
| `ticket_printing_mode` | select(system_printing\|zadig_printing) |
| `ticket_header` | text |
| `ticket_footer` | text |
| `ticket_print_on_sale` | bool |
| `ticket_print_on_counter_order` | bool |
| `ticket_print_duplicate` | bool |
| `ticket_logo` | file |

## `enabled_units`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `unit` * | rel→measure_units |

Únicos: (unit)

## `enabled_payment_methods`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `enabled` | bool |

Únicos: (method)

## `custom_payment_methods`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `name` * | text |
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `allows_income` | bool |
| `allows_spend` | bool |
| `hidden` | bool |
| `deleted_at` | date |

## `counters`

*solo servidor*

| campo | tipo |
|---|---|
| `key` * | text |
| `value` | number |

Únicos: (key)

## `product_categories`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `name` * | text |
| `photo` | file |
| `deleted_at` | date |

## `product_brands`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `name` * | text |
| `deleted_at` | date |

## `products`

*datos maestros (permiso fino)* · lectura: `product.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `name` * | text |
| `slug` | text |
| `description` | text |
| `barcode` | text |
| `sku` | text |
| `type` * | select(product\|combo\|service) |
| `sell_unit` * | rel→measure_units |
| `category` | rel→product_categories |
| `brand` | rel→product_brands |
| `parent` | rel→products |
| `is_variant_group` | bool |
| `is_stockable` | bool |
| `is_sellable` | bool |
| `is_manufactured` | bool |
| `batches_enabled` | bool |
| `display_in_catalog` | bool |
| `hidden_at` | date |
| `photos` | file |
| `taxes` | rel→taxes [] |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, sku) donde sku != "" AND deleted_at = ""; (account, barcode) donde barcode != "" AND deleted_at = ""

## `product_costs`

*datos maestros (permiso fino)* · lectura: `product.read_cost`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `cost` | number |
| `cost_type` * | select(net\|gross) |

Únicos: (product)

## `product_prices`

*datos maestros (permiso fino)* · lectura: `product.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `price_list` * | rel→price_lists |
| `min_quantity` | number |
| `price` | number |

Únicos: (product, price_list, min_quantity)

## `variant_options`

*datos maestros (permiso fino)* · lectura: `product.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `name` * | text |
| `position` | number |

Únicos: (product, name)

## `variant_option_values`

*datos maestros (permiso fino)* · lectura: `product.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `option` * | rel→variant_options |
| `value` * | text |
| `position` | number |

Únicos: (option, value)

## `product_variant_values`

*datos maestros (permiso fino)* · lectura: `product.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `option_value` * | rel→variant_option_values |

Únicos: (product, option_value)

## `combo_items`

*datos maestros (permiso fino)* · lectura: `product.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `combo` * | rel→products |
| `item` * | rel→products |
| `quantity` | number |

Únicos: (combo, item)

## `recipe_items`

*datos maestros (permiso fino)* · lectura: `product.read`, `manufacturing_order.read`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `material` * | rel→products |
| `quantity` | number |
| `unit` | rel→measure_units |

Únicos: (product, material)

## `product_storage`

*datos maestros (permiso fino)* · lectura: `product.read`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `location` * | rel→locations |
| `placement` | text |

Únicos: (product, location)

## `product_stocks`

*documento/libro (solo servidor escribe)* · lectura: `product.read`, `order.create`, `quotation.create`, `stock_adjustment.read`, `transfer.read`, `manufacturing_order.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `location` * | rel→locations |
| `quantity` | number |
| `min_quantity` | number |

Únicos: (product, location)

## `batches`

*documento/libro (solo servidor escribe)* · lectura: `product.read`, `order.create`, `quotation.create`, `stock_adjustment.read`, `transfer.read`, `manufacturing_order.read`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `code` * | text |
| `expires_at` | date |
| `fabricated_at` | date |
| `deleted_at` | date |

Únicos: (product, code) donde deleted_at = ""

## `batch_stocks`

*documento/libro (solo servidor escribe)* · lectura: `product.read`, `order.create`, `quotation.create`, `stock_adjustment.read`, `transfer.read`, `manufacturing_order.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `batch` * | rel→batches |
| `location` * | rel→locations |
| `quantity` | number |
| `min_quantity` | number |

Únicos: (batch, location)

## `stock_movements`

*documento/libro (solo servidor escribe)* · lectura: `product.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `product` * | rel→products |
| `batch` | rel→batches |
| `location` * | rel→locations |
| `previous_quantity` | number |
| `current_quantity` | number |
| `origin` * | select(product_create\|order_create\|order_delete\|order_return\|purchase_create\|purchase_delete\|transfer_send\|transfer_receive\|transfer_delete\|location_delete\|adjustment\|stock_adjustment\|stock_adjustment_delete\|manufacturing_material_use\|manufacturing_material_return\|manufacturing_production\|change_stock_tracking) |
| `adjustment_reason` | select(correction\|recount\|expiration\|theft_or_loss\|deterioration\|gift\|massive_edition\|plan_limitation) |
| `order` | rel→orders |
| `purchase` | rel→purchases |
| `transfer` | rel→transfers |
| `stock_adjustment` | rel→stock_adjustments |
| `manufacturing_order` | rel→manufacturing_orders |
| `created_by` | rel→users |

## `transfers`

*documento/libro (solo servidor escribe)* · lectura: `transfer.read` · acotado a sucursales por `origin, destination`

| campo | tipo |
|---|---|
| `number` | number |
| `origin` * | rel→locations |
| `destination` * | rel→locations |
| `status` * | select(draft\|sent\|received) |
| `notes` | text |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, number)

## `transfer_items`

*documento/libro (solo servidor escribe)* · lectura: `transfer.read` · acotado a sucursales por `transfer.origin, transfer.destination`

| campo | tipo |
|---|---|
| `transfer` * | rel→transfers |
| `product` * | rel→products |
| `quantity_sent` | number |
| `quantity_received` | number |
| `unit` | rel→measure_units |

## `transfer_item_batches`

*documento/libro (solo servidor escribe)* · lectura: `transfer.read` · acotado a sucursales por `transfer_item.transfer.origin, transfer_item.transfer.destination`

| campo | tipo |
|---|---|
| `transfer_item` * | rel→transfer_items |
| `batch` * | rel→batches |
| `quantity_sent` | number |
| `quantity_received` | number |

## `transfer_events`

*documento/libro (solo servidor escribe)* · lectura: `transfer.read` · acotado a sucursales por `transfer.origin, transfer.destination`

| campo | tipo |
|---|---|
| `transfer` * | rel→transfers |
| `type` * | select(created\|sent\|received\|updated_while_draft\|comment) |
| `content` | text |
| `user` | rel→users |

## `stock_adjustments`

*documento/libro (solo servidor escribe)* · lectura: `stock_adjustment.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `number` | number |
| `location` * | rel→locations |
| `type` * | select(entry\|exit\|count) |
| `status` * | select(draft\|completed) |
| `reason` | select(correction\|recount\|expiration\|theft_or_loss\|deterioration\|gift\|massive_edition\|plan_limitation) |
| `notes` | text |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, number)

## `stock_adjustment_items`

*documento/libro (solo servidor escribe)* · lectura: `stock_adjustment.read` · acotado a sucursales por `stock_adjustment.location`

| campo | tipo |
|---|---|
| `stock_adjustment` * | rel→stock_adjustments |
| `product` * | rel→products |
| `unit` | rel→measure_units |
| `previous_quantity` | number |
| `input_quantity` | number |
| `unit_cost` | number |
| `unit_price` | number |

## `stock_adjustment_item_batches`

*documento/libro (solo servidor escribe)* · lectura: `stock_adjustment.read` · acotado a sucursales por `item.stock_adjustment.location`

| campo | tipo |
|---|---|
| `item` * | rel→stock_adjustment_items |
| `batch` | rel→batches |
| `code` | text |
| `expires_at` | date |
| `fabricated_at` | date |
| `input_quantity` | number |

## `stock_adjustment_events`

*documento/libro (solo servidor escribe)* · lectura: `stock_adjustment.read` · acotado a sucursales por `stock_adjustment.location`

| campo | tipo |
|---|---|
| `stock_adjustment` * | rel→stock_adjustments |
| `type` * | select(created_as_draft\|created_as_completed\|updated_while_draft\|completed\|comment) |
| `content` | text |
| `user` | rel→users |

## `manufacturing_orders`

*documento/libro (solo servidor escribe)* · lectura: `manufacturing_order.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `number` | number |
| `product` * | rel→products |
| `location` * | rel→locations |
| `status` * | select(created\|started\|finished\|cancelled) |
| `initial_quantity` | number |
| `manufactured_quantity` | number |
| `started_at` | date |
| `finished_at` | date |
| `notes` | text |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, number)

## `manufacturing_order_materials`

*documento/libro (solo servidor escribe)* · lectura: `manufacturing_order.read` · acotado a sucursales por `manufacturing_order.location`

| campo | tipo |
|---|---|
| `manufacturing_order` * | rel→manufacturing_orders |
| `material` * | rel→products |
| `quantity` | number |
| `unit` | rel→measure_units |

## `manufacturing_order_events`

*documento/libro (solo servidor escribe)* · lectura: `manufacturing_order.read` · acotado a sucursales por `manufacturing_order.location`

| campo | tipo |
|---|---|
| `manufacturing_order` * | rel→manufacturing_orders |
| `type` * | select(created\|started\|finished\|cancelled\|comment\|use_material_stock\|return_material_stock) |
| `content` | text |
| `user` | rel→users |

## `clients`

*datos maestros (permiso fino)* · lectura: `client.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `friendly_id` | text |
| `type` * | select(general_public\|account_client) |
| `name` * | text |
| `surname` | text |
| `phone` | text |
| `email` | text |
| `address` | rel→addresses |
| `comments` | text |
| `default_price_list` | rel→price_lists |
| `loyalty_points` | number |
| `uses_default_debt_limit` | bool |
| `debt_limit` | number |
| `last_debt_reminder_at` | date |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, friendly_id) donde friendly_id != ""

## `orders`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `order_number` | number |
| `friendly_id` | text |
| `series` | rel→order_series |
| `location` * | rel→locations |
| `client` * | rel→clients |
| `seller` | rel→sellers |
| `price_list` | rel→price_lists |
| `quotation` | rel→quotations |
| `origin` * | select(pos\|pos_save_as_order\|online_catalog\|direct_invoice) |
| `payment_status` * | select(completed\|pending\|cancelled\|refunded) |
| `shipping_status` * | select(pending\|completed\|cancelled\|returned) |
| `way_of_payment` | select(to_agree_after_purchase\|mercadopago\|clip\|bank_transfer\|credit\|collect_on_delivery) |
| `shipping_method` | select(to_agree_after_purchase\|pickup\|delivery) |
| `subtotal` | number |
| `discounts` | number |
| `original_total` | number |
| `total` | number |
| `with_taxes` | bool |
| `delivery_cost` | number |
| `loyalty_reward_percentage` | number |
| `notes` | text |
| `made_at` * | date |
| `request_id` * | text |
| `is_offline` | bool |
| `delivery_address` | rel→addresses |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, request_id); (account, series, order_number); (account, friendly_id) donde friendly_id != ""

## `order_items`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order.location`

| campo | tipo |
|---|---|
| `order` * | rel→orders |
| `product` | rel→products |
| `name` * | text |
| `type` * | select(product\|combo\|service) |
| `quantity` | number |
| `unit` | rel→measure_units |
| `unit_price` | number |
| `total` | number |
| `price_type` | select(default\|personalized) |
| `price_breakpoint` | number |
| `price_list` | rel→price_lists |
| `combo_parent` | rel→order_items |
| `discount` | rel→order_item_discounts |

## `order_item_costs`

*documento/libro (solo servidor escribe)* · lectura: `product.read_cost` · acotado a sucursales por `order_item.order.location`

| campo | tipo |
|---|---|
| `order_item` * | rel→order_items |
| `unit_cost` | number |
| `total_cost` | number |

Únicos: (order_item)

## `order_item_taxes`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order_item.order.location`

| campo | tipo |
|---|---|
| `order_item` * | rel→order_items |
| `tax` * | rel→taxes |
| `type` * | select(vat\|ieps\|isr) |
| `percentage` | number |
| `is_withheld` | bool |
| `amount` | number |

## `order_item_discounts`

*documento/libro (solo servidor escribe)* · lectura: `order.read`

| campo | tipo |
|---|---|
| `type` * | select(percentage\|fixed) |
| `value` | number |
| `title` | text |
| `promotion` | rel→promotions |

## `order_item_batches`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order_item.order.location`

| campo | tipo |
|---|---|
| `order_item` * | rel→order_items |
| `batch` * | rel→batches |
| `quantity` | number |

## `order_cart_discounts`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order.location`

| campo | tipo |
|---|---|
| `order` * | rel→orders |
| `type` * | select(percentage\|fixed) |
| `amount` | number |
| `title` | text |
| `promotion` | rel→promotions |
| `loyalty_points_used` | number |

## `unified_debt_payments`

*documento/libro (solo servidor escribe)* · lectura: `order.read`

| campo | tipo |
|---|---|
| `client` | rel→clients |
| `created_by` | rel→users |
| `deleted_at` | date |

## `order_payments`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order.location`

| campo | tipo |
|---|---|
| `order` * | rel→orders |
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `custom_payment_method` | rel→custom_payment_methods |
| `total` | number |
| `change` | number |
| `cashier` | rel→cashiers |
| `made_at` * | date |
| `loyalty_points_reward` | number |
| `settles_payment` | rel→order_payments |
| `unified_debt_payment` | rel→unified_debt_payments |
| `created_by` | rel→users |
| `deleted_at` | date |

## `order_debts`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order.location`

| campo | tipo |
|---|---|
| `order` * | rel→orders |
| `original_debt` | number |
| `current_debt` | number |
| `due_date` | date |
| `credit_payment` | rel→order_payments |

Únicos: (order)

## `order_refunds`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order.location`

| campo | tipo |
|---|---|
| `order` * | rel→orders |
| `reason` * | select(change_of_mind\|expired_product\|damaged_goods\|wrong_product\|wrong_variant\|other) |
| `total_refunded` | number |
| `subtotal_refunded` | number |
| `cancelled_debt` | number |
| `created_by` | rel→users |

## `order_refund_items`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `refund.order.location`

| campo | tipo |
|---|---|
| `refund` * | rel→order_refunds |
| `order_item` * | rel→order_items |
| `quantity_refunded` | number |

## `order_refund_item_batches`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `refund_item.refund.order.location`

| campo | tipo |
|---|---|
| `refund_item` * | rel→order_refund_items |
| `batch` * | rel→batches |
| `quantity` | number |

## `order_refund_payments`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `refund.order.location`

| campo | tipo |
|---|---|
| `refund` * | rel→order_refunds |
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `custom_payment_method` | rel→custom_payment_methods |
| `total_refunded` | number |
| `cashier` | rel→cashiers |

## `order_events`

*documento/libro (solo servidor escribe)* · lectura: `order.read` · acotado a sucursales por `order.location`

| campo | tipo |
|---|---|
| `order` * | rel→orders |
| `type` * | select(product_delivery\|products_committed\|online_payment\|cancel\|refund_items\|refund_items_returned_items\|refund_payment\|refund_cancelled_debt\|comment) |
| `user` | rel→users |
| `location` | rel→locations |
| `content` | text |

## `quotations`

*documento/libro (solo servidor escribe)* · lectura: `quotation.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `number` | number |
| `friendly_id` | text |
| `status` * | select(created\|sold) |
| `client` | rel→clients |
| `seller` | rel→sellers |
| `price_list` | rel→price_lists |
| `location` | rel→locations |
| `valid_from` | date |
| `expires_at` | date |
| `client_note` | text |
| `notes` | text |
| `subtotal` | number |
| `with_taxes` | bool |
| `delivery_address` | rel→addresses |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, number); (account, friendly_id) donde friendly_id != ""

## `quotation_items`

*documento/libro (solo servidor escribe)* · lectura: `quotation.read` · acotado a sucursales por `quotation.location`

| campo | tipo |
|---|---|
| `quotation` * | rel→quotations |
| `product` | rel→products |
| `is_manual` | bool |
| `name` * | text |
| `manual_cost` | number |
| `type` * | select(product\|combo\|service) |
| `quantity` | number |
| `unit` | rel→measure_units |
| `sell_price` | number |
| `total` | number |
| `price_type` | select(default\|personalized) |
| `price_breakpoint` | number |
| `price_list` | rel→price_lists |
| `combo_parent` | rel→quotation_items |
| `discount` | rel→quotation_item_discounts |

## `quotation_item_taxes`

*documento/libro (solo servidor escribe)* · lectura: `quotation.read` · acotado a sucursales por `quotation_item.quotation.location`

| campo | tipo |
|---|---|
| `quotation_item` * | rel→quotation_items |
| `tax` * | rel→taxes |
| `percentage` | number |
| `amount` | number |

## `quotation_item_discounts`

*documento/libro (solo servidor escribe)* · lectura: `quotation.read`

| campo | tipo |
|---|---|
| `type` * | select(percentage\|fixed) |
| `value` | number |
| `title` | text |
| `promotion` | rel→promotions |

## `quotation_cart_discounts`

*documento/libro (solo servidor escribe)* · lectura: `quotation.read` · acotado a sucursales por `quotation.location`

| campo | tipo |
|---|---|
| `quotation` * | rel→quotations |
| `type` * | select(percentage\|fixed) |
| `amount` | number |
| `title` | text |
| `promotion` | rel→promotions |

## `quotation_events`

*documento/libro (solo servidor escribe)* · lectura: `quotation.read` · acotado a sucursales por `quotation.location`

| campo | tipo |
|---|---|
| `quotation` * | rel→quotations |
| `type` * | select(created\|updated\|sold\|comment) |
| `content` | text |
| `user` | rel→users |

## `promotions`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `name` * | text |
| `type` * | select(cart_total\|single_target\|multi_target\|multi_target_advanced) |
| `application` * | select(manual\|automatic) |
| `valid_from` | date |
| `valid_until` | date |
| `ended_at` | date |
| `restrict_to_clients` * | select(no_restriction\|registered_clients\|clients_list) |
| `amount` | number |
| `amount_type` | select(percentage\|fixed) |
| `min_cart_subtotal` | number |
| `multi_target_type` | select(two_for_one\|three_for_two\|second_fifty_percent\|third_fifty_percent\|custom\|advanced) |
| `trigger_quantity` | number |
| `discounted_quantity` | number |
| `discounted_percentage` | number |
| `price_lists` | rel→price_lists [] |
| `locations` | rel→locations [] |
| `created_by` | rel→users |
| `last_updated_by` | rel→users |
| `deleted_at` | date |

## `promotion_targets`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `promotion` * | rel→promotions |
| `role` * | select(single\|trigger\|discounted) |
| `product` | rel→products |
| `category` | rel→product_categories |

## `promotion_clients`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `promotion` * | rel→promotions |
| `client` * | rel→clients |

Únicos: (promotion, client)

## `promotion_days`

*datos maestros (permiso fino)*

| campo | tipo |
|---|---|
| `promotion` * | rel→promotions |
| `weekday` * | select(mon\|tue\|wed\|thu\|fri\|sat\|sun) |

Únicos: (promotion, weekday)

## `loyalty_programs`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `reward_percentage` | number |
| `min_cart_total` | number |
| `deactivated_at` | date |
| `price_lists` | rel→price_lists [] |
| `locations` | rel→locations [] |

Únicos: (account)

## `loyalty_product_rewards`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `program` * | rel→loyalty_programs |
| `product` * | rel→products |
| `reward_percentage` | number |

Únicos: (program, product)

## `loyalty_category_rewards`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `program` * | rel→loyalty_programs |
| `category` * | rel→product_categories |
| `reward_percentage` | number |

Únicos: (program, category)

## `loyalty_movements`

*documento/libro (solo servidor escribe)* · lectura: `client.read`, `order.create`, `quotation.create`

| campo | tipo |
|---|---|
| `client` * | rel→clients |
| `previous_quantity` | number |
| `current_quantity` | number |
| `origin` * | select(order_earn\|order_spend\|order_payment_earn\|order_payment_delete_revert\|order_delete_earn_revert\|order_refund_earn_revert\|order_delete_spend_revert\|order_refund_spend_revert\|order_assign_client\|order_remove_client\|adjustment) |
| `order` | rel→orders |
| `adjustment_reason` | text |
| `created_by` | rel→users |

## `providers`

*datos maestros (permiso fino)* · lectura: `outlay.read`, `provider.admin`

| campo | tipo |
|---|---|
| `name` * | text |
| `contact_name` | text |
| `contact_phone` | text |
| `contact_email` | text |
| `deleted_at` | date |

## `purchases`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `number` | number |
| `status` * | select(draft\|completed) |
| `provider` | rel→providers |
| `location` * | rel→locations |
| `made_at` * | date |
| `total` | number |
| `folio` | text |
| `notes` | text |
| `request_id` * | text |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, number); (account, request_id)

## `purchase_items`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `purchase.location`

| campo | tipo |
|---|---|
| `purchase` * | rel→purchases |
| `product` * | rel→products |
| `quantity` | number |
| `unit` | rel→measure_units |
| `sell_unit_factor` | number |
| `net_unit_cost` | number |
| `unit_discount_percentage` | number |
| `total` | number |

## `purchase_item_taxes`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `purchase_item.purchase.location`

| campo | tipo |
|---|---|
| `purchase_item` * | rel→purchase_items |
| `tax` * | rel→taxes |
| `percentage` | number |

## `purchase_item_batches`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `purchase_item.purchase.location`

| campo | tipo |
|---|---|
| `purchase_item` * | rel→purchase_items |
| `batch` * | rel→batches |
| `quantity` | number |

## `purchase_debts`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `purchase.location`

| campo | tipo |
|---|---|
| `purchase` * | rel→purchases |
| `original_debt` | number |
| `current_debt` | number |
| `due_date` | date |

Únicos: (purchase)

## `purchase_payments`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `purchase.location`

| campo | tipo |
|---|---|
| `purchase` * | rel→purchases |
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `custom_payment_method` | rel→custom_payment_methods |
| `total` | number |
| `made_at` * | date |
| `cash_movement` | rel→cash_movements |
| `created_by` | rel→users |

## `expenses`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `location`

| campo | tipo |
|---|---|
| `number` | number |
| `concept` * | text |
| `made_at` * | date |
| `total` | number |
| `location` * | rel→locations |
| `provider` | rel→providers |
| `folio` | text |
| `notes` | text |
| `created_by` | rel→users |
| `deleted_at` | date |

Únicos: (account, number)

## `expense_taxes`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `expense.location`

| campo | tipo |
|---|---|
| `expense` * | rel→expenses |
| `tax` * | rel→taxes |
| `percentage` | number |

## `expense_debts`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `expense.location`

| campo | tipo |
|---|---|
| `expense` * | rel→expenses |
| `original_debt` | number |
| `current_debt` | number |
| `due_date` | date |

Únicos: (expense)

## `expense_payments`

*documento/libro (solo servidor escribe)* · lectura: `outlay.read` · acotado a sucursales por `expense.location`

| campo | tipo |
|---|---|
| `expense` * | rel→expenses |
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `custom_payment_method` | rel→custom_payment_methods |
| `total` | number |
| `made_at` * | date |
| `cash_movement` | rel→cash_movements |
| `created_by` | rel→users |

## `cash_movements`

*documento/libro (solo servidor escribe)* · lectura: `cashier_audit.read_current`, `cashier_audit.read`

| campo | tipo |
|---|---|
| `cashier` * | rel→cashiers |
| `user` | rel→users |
| `type` * | select(manual_movement\|purchase_payment\|expense_payment) |
| `amount` | number |
| `details` | text |
| `deleted_at` | date |

## `cashier_audits`

*documento/libro (solo servidor escribe)* · lectura: `cashier_audit.read`, `cashier_audit.read_current`

| campo | tipo |
|---|---|
| `cashier` * | rel→cashiers |
| `status` * | select(draft\|completed) |
| `period_start` | date |
| `period_end` | date |
| `cash_in` | number |
| `cash_out` | number |
| `comments` | text |
| `created_by` | rel→users |
| `deleted_at` | date |

## `cashier_audit_items`

*documento/libro (solo servidor escribe)* · lectura: `cashier_audit.read`, `cashier_audit.read_current`

| campo | tipo |
|---|---|
| `audit` * | rel→cashier_audits |
| `method` * | select(cash\|card\|transfer\|check\|credit\|debit_card\|payment_intermediary\|electronic_wallet\|electronic_money\|service_card\|food_voucher) |
| `custom_payment_method` | rel→custom_payment_methods |
| `total_expected` | number |
| `total_audited` | number |
| `order_payment` | number |
| `debt_payment` | number |
| `refund` | number |
| `outlay_payment` | number |
| `movements_in_total` | number |
| `cash_withdrawal` | number |
| `cash_in` | number |

## `catalogs`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `subdomain` * | text |
| `deactivated_at` | date |
| `name` * | text |
| `phone` | text |
| `facebook` | text |
| `instagram` | text |
| `support_whatsapp` | text |
| `email_contact` | text |
| `products_without_stock` | select(show\|hide) |
| `acquisition_limit` | select(limit_to_stock\|unlimited) |
| `categories` | select(show\|hide) |
| `location_of_origin` | rel→locations |
| `shared_in_instagram` | bool |
| `shared_in_whatsapp` | bool |
| `ui_variant` | select(retail\|wholesale) |
| `client_catalogs_enabled` | bool |
| `volume_pricing_enabled` | bool |
| `pickup_address` | rel→addresses |
| `pickup_instructions` | text |
| `delivery_instructions` | text |
| `delivery_default_price` | number |
| `agreed_shipping_instructions` | text |
| `bank_transfer_instructions` | text |
| `agreed_payment_instructions` | text |
| `credit_instructions` | text |
| `collect_on_delivery_instructions` | text |
| `home_active` | bool |
| `home_show_hero` | bool |
| `home_title` | text |
| `home_main_button_text` | text |
| `home_hero_photo` | file |

Únicos: (account); (subdomain)

## `catalog_payment_ways`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `catalog` * | rel→catalogs |
| `way` * | select(to_agree_after_purchase\|mercadopago\|clip\|bank_transfer\|credit\|collect_on_delivery) |

Únicos: (catalog, way)

## `catalog_shipping_methods`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `catalog` * | rel→catalogs |
| `method` * | select(to_agree_after_purchase\|pickup\|delivery) |

Únicos: (catalog, method)

## `catalog_banners`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `catalog` * | rel→catalogs |
| `image` | file |
| `type` | select(promotional) |

## `catalog_stock_locations`

*configuración (admin escribe)*

| campo | tipo |
|---|---|
| `catalog` * | rel→catalogs |
| `location` * | rel→locations |

Únicos: (catalog, location)

## `mercadopago_credentials`

*solo servidor*

| campo | tipo |
|---|---|
| `access_token` | text |
| `refresh_token` | text |
| `expires_at` | date |
| `mercadopago_user_id` | text |
| `public_key` | text |

Únicos: (account)
