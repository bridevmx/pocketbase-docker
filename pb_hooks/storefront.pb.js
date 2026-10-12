/// <reference path="../pb_data/types.d.ts" />

// Tienda en línea pública (sin sesión). Cabeceras opcionales: x-catalog-variant-slug (lista de precios
// pública, p. ej. "mayoreo") y x-catalog-client-code (catálogo de un cliente). Ver docs/pulpos-storefront-api.md

routerAdd('GET', '/api/shop/config', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).config($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') })));
routerAdd('GET', '/api/shop/categories', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).categories($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') })));
routerAdd('GET', '/api/shop/products', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).search($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') }, e.requestInfo().query)));
routerAdd('GET', '/api/shop/products/{id}', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).product($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') }, e.request.pathValue('id'))));
routerAdd('POST', '/api/shop/cart/validate', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).validateCart($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') }, e.requestInfo().body || {})));
routerAdd('POST', '/api/shop/orders', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).createOrder($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') }, e.requestInfo().body || {})));
routerAdd('GET', '/api/shop/orders/{friendly_id}', (e) => e.json(200, require(`${__hooks}/lib/storefront.js`).trackOrder($app, {
  'x-catalog-variant-slug': e.request.header.get('x-catalog-variant-slug'), 'x-catalog-client-code': e.request.header.get('x-catalog-client-code') }, e.request.pathValue('friendly_id'))));
