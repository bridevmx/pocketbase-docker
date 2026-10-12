# Tienda en línea (rutas públicas, sin sesión)

Cada instancia es un negocio: el subdominio (`<negocio>.tpv.ejemplo.com`) ya apunta a su instancia, así que no hay que resolver el negocio. La tienda se configura desde el POS con las colecciones normales: `catalogs` (una fila), `catalog_payment_ways`, `catalog_shipping_methods`, `catalog_stock_locations`, `catalog_banners`, y en `price_lists` el `catalog_path`/`catalog_hidden` (variantes, como `/mayoreo`). Un producto sale en la tienda si `is_sellable`, `display_in_catalog`, no está oculto/borrado, no es grupo de variantes y tiene precio.

Cabeceras opcionales: `x-catalog-variant-slug` (`public` o el `catalog_path` de una lista no oculta) y `x-catalog-client-code` (folio corto del cliente; requiere `client_catalogs_enabled`; usa su lista de precios).

| Ruta | Qué devuelve |
|---|---|
| `GET /api/shop/config` | nombre, contacto, redes, formas de pago e instrucciones, métodos de envío y precio, dirección de recolección, portada, banners, variantes visibles. Mercado Pago solo aparece si hay credenciales. |
| `GET /api/shop/categories` | categorías con productos visibles (vacío si `categories = hide`) |
| `GET /api/shop/products?q&category&sort&direction&limit&offset` | `sort`: `sold_count` (default), `name`, `price`, `newest`; `limit` ≤ 100. Cada producto: precio, `price_breakpoints` (si `volume_pricing_enabled`), `available` (`null` = sin límite), `in_stock`, fotos (`/api/files/...`). |
| `GET /api/shop/products/{id}` | detalle (descripción, marca) |
| `POST /api/shop/cart/validate` `{items:[{product, quantity}]}` | precio por escalón, total, existencia y `has_enough_stock` por línea, `valid` |
| `POST /api/shop/orders` | crea el pedido (abajo) |
| `GET /api/shop/orders/{friendly_id}` | seguimiento por folio corto de 7 caracteres |

## Crear pedido
`{ request_id, client:{name, phone, email?}, items:[{product, quantity}], shipping_method, way_of_payment, delivery_address?, notes? }`

- **El servidor decide todo**: precio (lista de la variante/cliente, escalón por cantidad), impuestos y costo como *snapshot*, envío (`delivery_default_price` si es a domicilio), folio de la serie por defecto. Lo que el cliente mande de precios o totales se ignora.
- `origin = online_catalog`, pago y entrega `pending`, sin usuario creador, en la sucursal `location_of_origin`.
- **Cliente**: con `x-catalog-client-code` es ese cliente; si no, se busca por teléfono (últimos 10 dígitos) y se reutiliza, o se crea un `account_client` con `+52…`.
- **Existencias**: no se descuentan; quedan *comprometidas* (`available = existencia − pedidos pendientes`, sumando las sucursales de `catalog_stock_locations`). Con `acquisition_limit = limit_to_stock`, pedir de más → 409 `items_exceed_stock`. Los combos se limitan por sus componentes.
- `request_id` hace idempotente el envío. Entrega a domicilio exige calle, CP y ciudad.
- El negocio lo cobra y entrega con las rutas de ventas (`/api/tpv/orders/{id}/payments`, `…/deliver`): al entregar baja el inventario real.
- Licencia: suspendida → 503 `store_unavailable`; en solo lectura la tienda se ve, pero los pedidos dan 402. Tienda desactivada (`deactivated_at`) → 404.
- Límite de peticiones: `POST /api/shop/orders` 30 por hora por IP (en `1760000002_pulpos_settings.js`; configura *trusted proxy* detrás de Caddy).

## Pago con tarjeta (Clip)
`way_of_payment: "clip"` (Checkout Redireccionado de Clip, plugin `pb_hooks/clip-payment-links/`). Solo se ofrece en `/config` si la instancia tiene `CLIP_API_TOKEN` (o `CLIP_API_KEY`+`CLIP_API_SECRET`), `PAYMENT_LINKS_WEBHOOK_TOKEN` (16+ caracteres) y `PAYMENT_LINKS_PUBLIC_URL` (URL pública de la instancia, que Clip debe poder ver). El servidor de la instancia debe estar en México o EE. UU.

- `POST /api/shop/orders` devuelve además `payment_url` (llevar al comprador ahí). Si Clip falla, el pedido se crea igual con `payment_error` (`clip_unavailable`, `clip_not_configured`).
- `POST /api/shop/orders/{friendly_id}/pay` → `{ payment_url, payment_qr_url }`: link vigente o uno nuevo (si venció o falló).
- `GET /api/shop/orders/{friendly_id}` incluye `payment_url` mientras el pago siga pendiente.
- **El pago se confirma solo contra la API de Clip** (el webhook y el retorno del comprador son una señal, no una prueba): link `COMPLETED` con nuestra referencia firmada, monto y moneda. Entonces se crea un `order_payments` (`card`), el pedido pasa a `payment_status = completed` y se suma la lealtad. Un cron revisa pendientes cada 5 min y otro cancela pedidos de Clip sin pago a las 73 h.
- Mínimo **$1.00** (`clip_min_amount`); solo tarjeta de crédito/débito (el efectivo diferido dejaría existencias comprometidas). Sin reembolsos por API de Clip (se hacen en su panel).
- Pruebas: `node test/smoke-clip.mjs` (Clip falso, sin dinero) y `node test/clip-real.mjs` (cobra $1.00 real con cloudflared; ver `test/.env.example`).

## Errores (clave en `data`)
`store_not_found`, `store_unavailable`, `cart_empty`, `cart_too_large` (50), `invalid_cart_item`, `product_unavailable`, `no_price`, `items_exceed_stock`, `payment_way_unavailable`, `clip_min_amount`, `shipping_method_unavailable`, `invalid_client`, `invalid_phone`, `invalid_email`, `address_required`, `request_id_required`.

## Supuestos míos / pendiente
- Una variante sin precio propio para un producto cae a la lista pública (igual que el POS).
- `mercadopago` solo se acepta si existen credenciales, pero **no hay** `getPaymentUrl`; el pago en línea es con Clip (arriba).
- Sin `world.getStates` ni subida de banners/fotos por rutas propias (se administran como archivos de PocketBase).
- Los folios cortos de pedido sirven de "clave" del seguimiento; no se devuelven datos personales del cliente.
