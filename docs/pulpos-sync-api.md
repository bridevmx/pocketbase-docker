# Sincronización para el POS sin conexión

El POS trabaja contra un caché local (IndexedDB) y una cola de ventas, como Pulpos. El servidor ofrece lo necesario para mantener ambos; la lógica del cliente (service worker, cola, reintentos) vive en la app.

## Bajada: caché local por cambios
| Ruta | Qué devuelve |
|---|---|
| `GET /api/tpv/sync/config` | Todo lo pequeño y completo para operar: licencia, usuario y permisos, negocio, ajustes (`pos_settings`), sucursales y cajas **permitidas**, series, vendedores, listas de precios, impuestos, unidades, métodos de pago habilitados/personalizados, programa de lealtad. Llamarla al iniciar sesión y al volver la conexión. |
| `GET /api/tpv/sync/{entidad}?cursor=&limit=` | Registros cambiados desde el cursor (orden `updated,id`). `limit` ≤ 500 (200 por defecto). |

Entidades: `products` · `product_categories` · `product_brands` · `clients` · `promotions` · `product_stocks` · `batches` · `batch_stocks`. Otra entidad → 404 `unknown_entity`; sin permiso → 403.

Respuesta: `{ items, cursor, has_more, server_time }`. Se repite la llamada con el `cursor` devuelto hasta que `has_more` sea `false`; ese último cursor se guarda para la próxima sincronización (cursor vacío = descarga completa). Sin cambios: `items = []` y el mismo cursor.

- **Borrados lógicos** llegan como registros con `deleted_at` ≠ vacío: el cliente los elimina de su caché. Las entidades sin borrado (existencias) no desaparecen.
- **El producto viaja completo**: `prices` (todas las listas permitidas, con escalones `min_quantity`), `combo_items`, `photos` (URLs) y `cost` (solo con `product.read_cost`). Cambiar o borrar un precio, un combo o un costo mueve el `updated` del producto, así que un solo cursor basta.
- `promotions` trae `targets`, `days` y `clients`, para calcular promociones sin conexión con las mismas reglas del servidor (el servidor las vuelve a calcular al recibir la venta; ver `dry_run`).
- `product_stocks`/`batch_stocks` solo de las sucursales del usuario (el admin, todas): sirven para mostrar existencia aproximada.
- Permisos: `clients` y `product_stocks` piden `order.create` (o `client.read`/`product.read`).

## Subida: ventas hechas sin conexión
`POST /api/tpv/sync/orders` con `{ orders: [ <cuerpo de POST /api/tpv/orders>, … ] }` (máx. 50). Cada venta lleva su `request_id` (UUID generado al venderla) y su `made_at`.

- Se procesan **en orden de `made_at`** y por separado: una venta con error no tumba el lote.
- Resultado por venta: `{ request_id, status: "ok" | "duplicate" | "error", order?, code?, message?, http_status?, retry? }`.
  - `duplicate`: ya existía (reintento idempotente); se puede quitar de la cola.
  - `error` con `retry: true` (licencia en solo lectura, 5xx, 503): se reintenta más tarde. `retry: false` (producto borrado, permiso, fecha inválida…): no se arregla reenviando, hay que mostrarla al usuario.
- Diferencias con la ruta normal, porque la venta **ya ocurrió**: se acepta aunque deje el inventario en negativo (los demás controles siguen: precios, límites de crédito, margen, permisos) y `made_at` puede tener hasta **30 días** (la ruta normal: 7). Las ventas quedan con `is_offline = true`.
- El precio lo recalcula el servidor con el catálogo actual (igual que en línea); si cambió desde que se vendió, el total puede diferir del que vio el cajero: compara `payments` con el total antes de reenviar o procesa `payment_mismatch` como error permanente.

## Qué falta del lado cliente
Cola persistente con reintento y backoff, detección de conexión, descarga inicial y por intervalos (Pulpos usa un caché de 24 h), y resolver conflictos de precio. Fuera de esta API.
