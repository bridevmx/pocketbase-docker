# Agenda de decoración (globos, piñatas y mesa de dulces)

MVP sobre **PocketBase 0.40 + PocketPages**. Esquema 100% relacional (sin campos JSON):
inventario como libro de movimientos, recetas por servicio, reservas de estructuras con
choque de horario, pagos por tipo y vistas SQL para stock, saldos, disponibilidad y lista de carga.

## Estructura
- `esquema/crear_esquema.py`: crea 11 colecciones + 4 vistas y reglas por rol (dueno / asistente).
- `app/`: `pb_hooks/` con PocketPages (calendario, evento, lista de carga) y `reglas.pb.js` (hooks).
- `pruebas/`: scripts de validación contra PocketBase y un arnés de plantillas (no es PocketPages).

## Docker (arranque automático)
```
docker build -t pinateria .
docker run -d -p 8090:8090 -v pb_data:/pb_data \
  -e PB_EMAIL=admin@ejemplo.com -e PB_PASS=clave-de-10-o-mas \
  -e OWNER_EMAIL=duena@ejemplo.com -e OWNER_PASSWORD=otra-clave -e OWNER_NAME=Ana \
  pinateria
```
Al iniciar: crea/actualiza el superusuario, levanta PocketBase con los hooks, crea el esquema si no existe
y el primer usuario `dueno` (si defines `OWNER_*`). Es idempotente: reiniciar no repite nada.
Variables: `PB_EMAIL` y `PB_PASS` (obligatorias, clave de 10+ caracteres); opcionales `OWNER_EMAIL`,
`OWNER_PASSWORD`, `OWNER_NAME`, `PB_ENCRYPTION_KEY` (32 caracteres), `PB_PORT`, `PB_ORIGINS`, `TZ`, y `PB_VERSION` (build arg).
Datos en el volumen `/pb_data`. App en `/`, panel admin en `/_/`.

## Uso manual
1. Arranca PocketBase y crea el esquema:
   `PB_URL=http://127.0.0.1:8090 PB_EMAIL=... PB_PASS=... python3 esquema/crear_esquema.py`
2. En `app/`: `npm install`, y corre PocketBase con `pb_hooks/` al lado de `pb_data/`.
3. Crea usuarios en `users` con `nombre` y `rol`.

Páginas: `/calendario`, `/eventos/:id`, `/carga` (tiempo real con SDK de PocketBase + nanostores por CDN;
fija las versiones del CDN en `app/pb_hooks/pages/assets/carga.js`). Zona horaria fija UTC-6 en `_private/lib.js`.

## Pendiente
Hook de cerrar evento (consumos), folio consecutivo y enlace público de cotización,
revalidar estructuras al apartar, pruebas de concurrencia.
