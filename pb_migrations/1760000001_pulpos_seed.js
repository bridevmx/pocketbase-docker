/// <reference path="../pb_data/types.d.ts" />
// AUTO-GENERADO por tools/build-schema.mjs a partir de schema/*.mjs — NO editar a mano.
migrate((app) => {
  const SEED = {
 "UNITS": [
  [
   "unit",
   "Unidad",
   "Unidades",
   "u"
  ],
  [
   "kit",
   "Kit",
   "Kits",
   "kit"
  ],
  [
   "box",
   "Caja",
   "Cajas",
   "caja"
  ],
  [
   "bag",
   "Bolsa",
   "Bolsas",
   "bolsa"
  ],
  [
   "meter",
   "Metro",
   "Metros",
   "m"
  ],
  [
   "centimeter",
   "Centímetro",
   "Centímetros",
   "cm"
  ],
  [
   "kilogram",
   "Kilogramo",
   "Kilogramos",
   "kg"
  ],
  [
   "gram",
   "Gramo",
   "Gramos",
   "g"
  ],
  [
   "liter",
   "Litro",
   "Litros",
   "L"
  ],
  [
   "milliliter",
   "Mililitro",
   "Mililitros",
   "mL"
  ],
  [
   "service",
   "Servicio",
   "Servicios",
   "serv."
  ],
  [
   "square_meter",
   "Metro cuadrado",
   "Metros cuadrados",
   "m²"
  ],
  [
   "piece",
   "Pieza",
   "Piezas",
   "pieza"
  ]
 ],
 "TAXES": [
  {
   "type": "isr",
   "percentage": 10,
   "is_exempt": false,
   "is_withheld": true,
   "name": "ISR 10% (retenido)"
  },
  {
   "type": "isr",
   "percentage": 1.25,
   "is_exempt": false,
   "is_withheld": true,
   "name": "ISR 1.25% (retenido)"
  },
  {
   "type": "ieps",
   "percentage": 160,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 160%"
  },
  {
   "type": "ieps",
   "percentage": 53,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 53%"
  },
  {
   "type": "ieps",
   "percentage": 50,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 50%"
  },
  {
   "type": "ieps",
   "percentage": 30.4,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 30.4%"
  },
  {
   "type": "ieps",
   "percentage": 30,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 30%"
  },
  {
   "type": "ieps",
   "percentage": 26.5,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 26.5%"
  },
  {
   "type": "ieps",
   "percentage": 25,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 25%"
  },
  {
   "type": "ieps",
   "percentage": 9,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 9%"
  },
  {
   "type": "ieps",
   "percentage": 8,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 8%"
  },
  {
   "type": "ieps",
   "percentage": 7,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 7%"
  },
  {
   "type": "ieps",
   "percentage": 6,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 6%"
  },
  {
   "type": "ieps",
   "percentage": 3,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 3%"
  },
  {
   "type": "ieps",
   "percentage": 0,
   "is_exempt": false,
   "is_withheld": false,
   "name": "IEPS 0%"
  },
  {
   "type": "vat",
   "percentage": 16,
   "is_exempt": false,
   "is_withheld": false,
   "name": "VAT 16%"
  },
  {
   "type": "vat",
   "percentage": 10.6667,
   "is_exempt": false,
   "is_withheld": true,
   "name": "VAT 10.6667% (retenido)"
  },
  {
   "type": "vat",
   "percentage": 8,
   "is_exempt": false,
   "is_withheld": false,
   "name": "VAT 8%"
  },
  {
   "type": "vat",
   "percentage": 5.3333,
   "is_exempt": false,
   "is_withheld": true,
   "name": "VAT 5.3333% (retenido)"
  },
  {
   "type": "vat",
   "percentage": 0,
   "is_exempt": false,
   "is_withheld": false,
   "name": "VAT 0%"
  },
  {
   "type": "vat",
   "percentage": 0,
   "is_exempt": true,
   "is_withheld": false,
   "name": "VAT Exento"
  }
 ],
 "PERMS": [
  {
   "key": "order.create",
   "subject": "order",
   "action": "create",
   "requires": []
  },
  {
   "key": "order.admin_promotions",
   "subject": "order",
   "action": "admin_promotions",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.admin_discount",
   "subject": "order",
   "action": "admin_discount",
   "requires": [
    "order.create",
    "order.admin_promotions"
   ]
  },
  {
   "key": "order.manage_manual_entry",
   "subject": "order",
   "action": "manage_manual_entry",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.apply_personalized_price",
   "subject": "order",
   "action": "apply_personalized_price",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.create_with_credit",
   "subject": "order",
   "action": "create_with_credit",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.sell_digital_service",
   "subject": "order",
   "action": "sell_digital_service",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.assign_salesman",
   "subject": "order",
   "action": "assign_salesman",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.remove_and_add_taxes",
   "subject": "order",
   "action": "remove_and_add_taxes",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.postpone_products_delivery",
   "subject": "order",
   "action": "postpone_products_delivery",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.save_counter_order",
   "subject": "order",
   "action": "save_counter_order",
   "requires": [
    "order.create"
   ]
  },
  {
   "key": "order.read",
   "subject": "order",
   "action": "read",
   "requires": []
  },
  {
   "key": "order.edit",
   "subject": "order",
   "action": "edit",
   "requires": [
    "order.read"
   ]
  },
  {
   "key": "order.register_payment_and_shipping",
   "subject": "order",
   "action": "register_payment_and_shipping",
   "requires": [
    "order.read"
   ]
  },
  {
   "key": "order.refund",
   "subject": "order",
   "action": "refund",
   "requires": [
    "order.read"
   ]
  },
  {
   "key": "order.cancel",
   "subject": "order",
   "action": "cancel",
   "requires": [
    "order.read"
   ]
  },
  {
   "key": "order.export",
   "subject": "order",
   "action": "export",
   "requires": [
    "order.read"
   ]
  },
  {
   "key": "quotation.read",
   "subject": "quotation",
   "action": "read",
   "requires": []
  },
  {
   "key": "quotation.create",
   "subject": "quotation",
   "action": "create",
   "requires": [
    "quotation.read"
   ]
  },
  {
   "key": "quotation.edit",
   "subject": "quotation",
   "action": "edit",
   "requires": [
    "quotation.read"
   ]
  },
  {
   "key": "quotation.admin_promotions",
   "subject": "quotation",
   "action": "admin_promotions",
   "requires": [
    "quotation.read"
   ]
  },
  {
   "key": "quotation.admin_discount",
   "subject": "quotation",
   "action": "admin_discount",
   "requires": [
    "quotation.read",
    "quotation.admin_promotions"
   ]
  },
  {
   "key": "quotation.remove_and_add_taxes",
   "subject": "quotation",
   "action": "remove_and_add_taxes",
   "requires": [
    "quotation.read"
   ]
  },
  {
   "key": "quotation.manage_manual_entry",
   "subject": "quotation",
   "action": "manage_manual_entry",
   "requires": [
    "quotation.read"
   ]
  },
  {
   "key": "quotation.apply_personalized_price",
   "subject": "quotation",
   "action": "apply_personalized_price",
   "requires": [
    "quotation.read"
   ]
  },
  {
   "key": "product.read",
   "subject": "product",
   "action": "read",
   "requires": []
  },
  {
   "key": "product.read_cost",
   "subject": "product",
   "action": "read_cost",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "product.read_all_locations_stock",
   "subject": "product",
   "action": "read_all_locations_stock",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "product.create",
   "subject": "product",
   "action": "create",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "product.edit",
   "subject": "product",
   "action": "edit",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "product.edit_cost",
   "subject": "product",
   "action": "edit_cost",
   "requires": [
    "product.read",
    "product.read_cost",
    "product.edit"
   ]
  },
  {
   "key": "product.edit_stock",
   "subject": "product",
   "action": "edit_stock",
   "requires": [
    "product.read",
    "product.edit"
   ]
  },
  {
   "key": "product.export",
   "subject": "product",
   "action": "export",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "product.import",
   "subject": "product",
   "action": "import",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "product_category.admin",
   "subject": "product_category",
   "action": "admin",
   "requires": [
    "product.read"
   ]
  },
  {
   "key": "stock_adjustment.read",
   "subject": "stock_adjustment",
   "action": "read",
   "requires": []
  },
  {
   "key": "stock_adjustment.manage_draft",
   "subject": "stock_adjustment",
   "action": "manage_draft",
   "requires": [
    "stock_adjustment.read"
   ]
  },
  {
   "key": "stock_adjustment.complete",
   "subject": "stock_adjustment",
   "action": "complete",
   "requires": [
    "stock_adjustment.read"
   ]
  },
  {
   "key": "transfer.read",
   "subject": "transfer",
   "action": "read",
   "requires": []
  },
  {
   "key": "transfer.manage_draft",
   "subject": "transfer",
   "action": "manage_draft",
   "requires": [
    "transfer.read"
   ]
  },
  {
   "key": "transfer.send",
   "subject": "transfer",
   "action": "send",
   "requires": [
    "transfer.read"
   ]
  },
  {
   "key": "transfer.receive",
   "subject": "transfer",
   "action": "receive",
   "requires": [
    "transfer.read"
   ]
  },
  {
   "key": "outlay.read",
   "subject": "outlay",
   "action": "read",
   "requires": []
  },
  {
   "key": "purchase.create",
   "subject": "purchase",
   "action": "create",
   "requires": [
    "outlay.read"
   ]
  },
  {
   "key": "expense.create",
   "subject": "expense",
   "action": "create",
   "requires": [
    "outlay.read"
   ]
  },
  {
   "key": "outlay.register_payment",
   "subject": "outlay",
   "action": "register_payment",
   "requires": [
    "outlay.read"
   ]
  },
  {
   "key": "provider.admin",
   "subject": "provider",
   "action": "admin",
   "requires": [
    "outlay.read"
   ]
  },
  {
   "key": "outlay.export",
   "subject": "outlay",
   "action": "export",
   "requires": [
    "outlay.read"
   ]
  },
  {
   "key": "cashier_audit.read_current",
   "subject": "cashier_audit",
   "action": "read_current",
   "requires": []
  },
  {
   "key": "cashier_audit.create",
   "subject": "cashier_audit",
   "action": "create",
   "requires": [
    "cashier_audit.read_current"
   ]
  },
  {
   "key": "cash_movement.create",
   "subject": "cash_movement",
   "action": "create",
   "requires": [
    "cashier_audit.read_current"
   ]
  },
  {
   "key": "cashier_audit.read",
   "subject": "cashier_audit",
   "action": "read",
   "requires": []
  },
  {
   "key": "cashier_audit.export",
   "subject": "cashier_audit",
   "action": "export",
   "requires": [
    "cashier_audit.read"
   ]
  },
  {
   "key": "client.read",
   "subject": "client",
   "action": "read",
   "requires": []
  },
  {
   "key": "client.create",
   "subject": "client",
   "action": "create",
   "requires": [
    "client.read"
   ]
  },
  {
   "key": "client.import",
   "subject": "client",
   "action": "import",
   "requires": [
    "client.create",
    "client.read"
   ]
  },
  {
   "key": "client.edit",
   "subject": "client",
   "action": "edit",
   "requires": [
    "client.read"
   ]
  },
  {
   "key": "client.edit_debt_limit",
   "subject": "client",
   "action": "edit_debt_limit",
   "requires": [
    "client.edit"
   ]
  },
  {
   "key": "client.export",
   "subject": "client",
   "action": "export",
   "requires": [
    "client.read"
   ]
  },
  {
   "key": "catalog.read",
   "subject": "catalog",
   "action": "read",
   "requires": []
  },
  {
   "key": "catalog.edit_payment_and_shipping",
   "subject": "catalog",
   "action": "edit_payment_and_shipping",
   "requires": [
    "catalog.read"
   ]
  },
  {
   "key": "catalog.customize",
   "subject": "catalog",
   "action": "customize",
   "requires": [
    "catalog.read"
   ]
  },
  {
   "key": "catalog.edit_url",
   "subject": "catalog",
   "action": "edit_url",
   "requires": [
    "catalog.read"
   ]
  },
  {
   "key": "catalog.enable",
   "subject": "catalog",
   "action": "enable",
   "requires": [
    "catalog.read"
   ]
  },
  {
   "key": "promotion.admin",
   "subject": "promotion",
   "action": "admin",
   "requires": []
  },
  {
   "key": "report.view_sales_reports",
   "subject": "report",
   "action": "view_sales_reports",
   "requires": []
  },
  {
   "key": "report.view_finance_reports",
   "subject": "report",
   "action": "view_finance_reports",
   "requires": []
  },
  {
   "key": "report.view_inventory_reports",
   "subject": "report",
   "action": "view_inventory_reports",
   "requires": []
  },
  {
   "key": "report.view_purchases_reports",
   "subject": "report",
   "action": "view_purchases_reports",
   "requires": []
  },
  {
   "key": "manufacturing_order.read",
   "subject": "manufacturing_order",
   "action": "read",
   "requires": []
  },
  {
   "key": "manufacturing_order.create",
   "subject": "manufacturing_order",
   "action": "create",
   "requires": [
    "manufacturing_order.read"
   ]
  },
  {
   "key": "manufacturing_order.start",
   "subject": "manufacturing_order",
   "action": "start",
   "requires": [
    "manufacturing_order.read"
   ]
  },
  {
   "key": "manufacturing_order.finish",
   "subject": "manufacturing_order",
   "action": "finish",
   "requires": [
    "manufacturing_order.read"
   ]
  },
  {
   "key": "manufacturing_order.cancel",
   "subject": "manufacturing_order",
   "action": "cancel",
   "requires": [
    "manufacturing_order.read"
   ]
  },
  {
   "key": "manufacturing_order.export",
   "subject": "manufacturing_order",
   "action": "export",
   "requires": [
    "manufacturing_order.read"
   ]
  }
 ]
};

  const units = app.findCollectionByNameOrId('measure_units');
  for (const [key, singular, plural, abbr] of SEED.UNITS) {
    const r = new Record(units);
    r.set('key', key); r.set('name_singular', singular); r.set('name_plural', plural); r.set('abbreviation', abbr);
    app.save(r);
  }

  const taxes = app.findCollectionByNameOrId('taxes');
  for (const t of SEED.TAXES) {
    const r = new Record(taxes);
    r.set('type', t.type); r.set('name', t.name); r.set('percentage', t.percentage);
    r.set('is_exempt', t.is_exempt); r.set('is_withheld', t.is_withheld);
    app.save(r);
  }

  const perms = app.findCollectionByNameOrId('permissions');
  const byKey = {};
  for (const p of SEED.PERMS) {
    const r = new Record(perms);
    r.set('key', p.key); r.set('subject', p.subject); r.set('action', p.action);
    app.save(r); byKey[p.key] = r.id;
  }
  for (const p of SEED.PERMS) {
    if (!p.requires.length) continue;
    const r = app.findRecordById('permissions', byKey[p.key]);
    r.set('requires', p.requires.map((k) => byKey[k]));
    app.save(r);
  }
}, (app) => {
  for (const name of ['permissions', 'taxes', 'measure_units']) {
    app.db().newQuery('DELETE FROM ' + name).execute();
  }
});
