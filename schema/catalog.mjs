import { col, text, num, bool, date, sel, file, rel, rels, photos, uniq, index } from './lib.mjs';
import { PRODUCT_TYPE, COST_TYPE } from './enums.mjs';

const READ_PRODUCTS = ['product.read', 'order.create', 'quotation.create'];

export default [
  col('product_categories', {
    kind: 'master', soft: true,
    perms: { read: 'any', create: ['product_category.admin'], edit: ['product_category.admin'], delete: ['product_category.admin'] },
    fields: [text('name', { required: true, max: 120 }), photos('photo', 1)],
    idx: [index(['account', 'name'])],
  }),

  col('product_brands', {
    kind: 'master', soft: true,
    perms: { read: 'any', create: ['product_category.admin'], edit: ['product_category.admin'], delete: ['product_category.admin'] },
    fields: [text('name', { required: true, max: 120 })],
  }),

  // Producto y "perfil" de Pulpos fusionados en una sola colección.
  // Variantes: el padre (is_variant_group=true) agrupa hijos (parent) que tienen su propio sku, precio y stock.
  col('products', {
    kind: 'master', soft: true,
    perms: { read: READ_PRODUCTS, create: ['product.create'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      text('name', { required: true, max: 200 }),
      text('slug', { max: 220 }),
      text('description', { max: 2000 }),
      text('barcode', { max: 80 }),
      text('sku', { max: 80 }),
      sel('type', PRODUCT_TYPE, { required: true }),
      rel('sell_unit', 'measure_units', { required: true }),
      rel('category', 'product_categories'),
      rel('brand', 'product_brands'),
      rel('parent', 'products'),
      bool('is_variant_group'),
      bool('is_stockable'),
      bool('is_sellable'),
      bool('is_manufactured'),
      bool('batches_enabled'),
      bool('display_in_catalog'),
      date('hidden_at'),
      photos('photos', 5),
      rels('taxes', 'taxes'),
      rel('created_by', 'users'),
    ],
    idx: [
      uniq(['account', 'sku'], 'sku != "" AND deleted_at = ""'),
      uniq(['account', 'barcode'], 'barcode != "" AND deleted_at = ""'),
      index(['account', 'category']),
      index(['parent']),
    ],
  }),

  // El costo vive aparte para poder protegerlo con product.read_cost / product.edit_cost
  // (PocketBase no tiene permisos por campo).
  col('product_costs', {
    kind: 'master',
    perms: { read: ['product.read_cost'], create: ['product.create', 'product.edit_cost'], edit: ['product.edit_cost'], delete: ['product.edit'] },
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      num('cost', { min: 0 }),
      sel('cost_type', COST_TYPE, { required: true }),
    ],
    idx: [uniq(['product'])],
  }),

  col('product_prices', {
    kind: 'master',
    perms: { read: READ_PRODUCTS, create: ['product.create', 'product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      rel('price_list', 'price_lists', { required: true }),
      num('min_quantity', { min: 0 }),     // breakpoint de precio por volumen
      num('price', { min: 0 }),
    ],
    idx: [uniq(['product', 'price_list', 'min_quantity'])],
  }),

  // Variantes normalizadas: opción ("Talla") → valores ("CH","M") → valor asignado a cada variante
  col('variant_options', {
    kind: 'master',
    perms: { read: READ_PRODUCTS, create: ['product.create', 'product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      text('name', { required: true, max: 80 }),
      num('position', { min: 0, onlyInt: true }),
    ],
    idx: [uniq(['product', 'name'])],
  }),
  col('variant_option_values', {
    kind: 'master',
    perms: { read: READ_PRODUCTS, create: ['product.create', 'product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('option', 'variant_options', { required: true, cascade: true }),
      text('value', { required: true, max: 80 }),
      num('position', { min: 0, onlyInt: true }),
    ],
    idx: [uniq(['option', 'value'])],
  }),
  col('product_variant_values', {
    kind: 'master',
    perms: { read: READ_PRODUCTS, create: ['product.create', 'product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      rel('option_value', 'variant_option_values', { required: true, cascade: true }),
    ],
    idx: [uniq(['product', 'option_value'])],
  }),

  // Kits
  col('combo_items', {
    kind: 'master',
    perms: { read: READ_PRODUCTS, create: ['product.create', 'product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('combo', 'products', { required: true, cascade: true }),
      rel('item', 'products', { required: true }),
      num('quantity', { min: 0 }),
    ],
    idx: [uniq(['combo', 'item'])],
  }),

  // Receta de fabricación (equivale a ManufacturingBlueprintItem)
  col('recipe_items', {
    kind: 'master',
    perms: { read: ['product.read', 'manufacturing_order.read'], create: ['product.create', 'product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      rel('material', 'products', { required: true }),
      num('quantity', { min: 0 }),
      rel('unit', 'measure_units'),
    ],
    idx: [uniq(['product', 'material'])],
  }),

  // Ubicación física en un almacén
  col('product_storage', {
    kind: 'master',
    perms: { read: ['product.read'], create: ['product.edit'], edit: ['product.edit'], delete: ['product.edit'] },
    fields: [
      rel('product', 'products', { required: true, cascade: true }),
      rel('location', 'locations', { required: true }),
      text('placement', { max: 120 }),
    ],
    idx: [uniq(['product', 'location'])],
  }),
];
