# pbmini Security Lab (pruebas en tiempo real)

Levanta PocketBase 0.40.5 (binario oficial verificado con SHA-256) + pbmini en un sandbox aislado (`.run/`, solo 127.0.0.1)
y lanza un catálogo de ataques. **Cada prueba declara un OBJETIVO** (qué intenta romper) **y una META** (resultado seguro esperado);
el panel muestra en vivo si la meta se cumple. Un detector global busca secretos canario en *todas* las respuestas.

```bash
python examples/pbmini/lab/lab.py              # panel http://127.0.0.1:8099 + ejecución automática
python examples/pbmini/lab/lab.py --headless   # consola, exit 1 si alguna meta falla (útil en CI)
python examples/pbmini/lab/lab.py --pb RUTA    # usar tu propio binario
python examples/pbmini/lab/lab.py --headless --only S   # solo la fase de ataques
```
Solo biblioteca estándar de Python 3.8+. Categorías: A archivos/rutas · B query · C body · D filtros/ACL · E caché · H páginas · J sesión/JWT/CSRF ·
S1–S16 ataques contra el framework (`attacks.py`: métodos, auth, CSRF, cuerpos, rutas, redirects, XSS/SSTI, inyección, Unicode, reconocimiento, archivos, Host/CORS, protocolo crudo, DoS, concurrencia, fuzzing) · D1–D6 pruebas profundas de dotfiles/sensibles, CSRF, JSON y Unicode (`attacks_deep.py`) · P auditoría de `pb_public` al arrancar · K carpetas por parámetro y endpoints · N API nativa de PocketBase · R límite de peticiones · F fail-closed al arrancar (archivos inseguros en `pages/`) · L lint.
El sandbox arranca con `--indexFallback=false` (URL inexistente = 404 real).

## Qué NO demuestra
"100 % seguro" no es demostrable: el laboratorio prueba que las metas del catálogo se cumplen, no que no existan otras clases de fallo.
Sin cubrir: subida de archivos, SSE/WebSocket, SSRF (`$http`), Unicode/homógrafos, request smuggling y TLS (dependen del proxy), timing,
y dependencias de terceros en `pb_hooks`. En Windows se omiten 2 casos de symlink si no hay privilegio para crearlos.

## Windows y Linux
Todo corre igual en ambos. Lo que depende del SO (symlinks, FIFO, nombres con `\`/`%`/saltos de línea, `/proc`) sale como **OMITIDO** (no como aprobado) cuando el SO no permite crear el archivo.
En Windows puedes ejecutarlo en Linux con WSL: `wsl -d Ubuntu -- python3 examples/pbmini/lab/lab.py --headless`. Estado omitido = gris en el panel.

## Ronda 9 (funcionalidades nuevas)
Secciones nuevas (prefijo `V` en los ids; `--only VN,VG,...`): **N** esquemas reutilizables · **G** paginación y filtros · **T** escrituras y transacciones · **K** caché con etiquetas ·
**L** layouts anidados · **E** páginas de error · **I** i18n · **A** acceso (incluye modo `role` en un servidor adicional) · **C** cron · **M** correo (servidor SMTP de captura local) ·
**S** sesiones (incluye la migración `legacy` en un servidor adicional) · **X** generador `pbmini:new` · **D** deriva de tipos (+ `tsc` si hay Node y red) · **F** fuzzer guiado por definiciones (`attacks_guided.py`).
Los casos de arranque inválido (fail-closed) de estas funciones viven en `attacks_v2.bad_pages()`.

## Ronda 10 (Telegram)
Sección **Y** (`attacks_tg.py`, ids `VY…`, `--only VY`): servidor con `telegram` activo contra un **Telegram falso** (`FakeTelegram`: registra llamadas y falla a demanda con 429/403/500/400). Cubre vinculación, webhook, envío, idempotencia, límites,
fallos y reintentos, grupos y ritmo, operadores, botones, login por Mini App (con initData firmado en Python), CLI, retención y arranque inválido. `real.py` (pruebas reales con `.env`): `serve`, `check [--send]` y `selftest` contra la API real de Telegram.

## Ronda 11 (Clip)
Sección **P** (`attacks_clip.py`, ids `VP…`, `--only VP`): módulo `clip` contra un **Clip falso** (`fake_clip.py`: valida el cuerpo oficial, imita estados, recibos, anomalías, fallos y reembolsos con la forma real medida). `unit_clip.js` prueba el núcleo puro con Node (`node unit_clip.js ../pb_hooks`).
Pruebas reales con dinero ($1) y cloudflared: `clip_refund.py` (reembolso; **lo ejecuta una persona**, simulacro sin `--confirm`) y la sonda descrita en SECURITY.md. Cloudflare bloquea el User-Agent por defecto de Python: el script usa uno propio.
