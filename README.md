# Agenda de decoración (globos, piñatas y mesa de dulces)

MVP sobre **PocketBase 0.40 + PocketPages**. Esquema 100% relacional (sin campos JSON):
inventario como libro de movimientos, recetas por servicio, reservas de estructuras con
choque de horario, pagos por tipo y vistas SQL para stock, saldos, disponibilidad y lista de carga.

## Estructura
- `esquema/crear_esquema.py`: crea 11 colecciones + 4 vistas y reglas por rol (dueno / asistente).
- `app/`: `pb_hooks/` con PocketPages (calendario, evento, lista de carga) y `reglas.pb.js` (hooks).
- `pruebas/`: scripts de validación contra PocketBase y un arnés de plantillas (no es PocketPages).

## Uso
1. Arranca PocketBase y crea el esquema:
   `PB_URL=http://127.0.0.1:8090 PB_EMAIL=... PB_PASS=... python3 esquema/crear_esquema.py`
2. En `app/`: `npm install`, y corre PocketBase con `pb_hooks/` al lado de `pb_data/`.
3. Crea usuarios en `users` con `nombre` y `rol`.

Páginas: `/calendario`, `/eventos/:id`, `/carga` (tiempo real con SDK de PocketBase + nanostores por CDN;
fija las versiones del CDN en `app/pb_hooks/pages/assets/carga.js`). Zona horaria fija UTC-6 en `_private/lib.js`.

## Pendiente
Hook de cerrar evento (consumos), folio consecutivo y enlace público de cotización,
revalidar estructuras al apartar, pruebas de concurrencia.
