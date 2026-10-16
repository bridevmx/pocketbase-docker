# pbmini Security Lab (pruebas en tiempo real)

Levanta PocketBase 0.40.5 (binario oficial verificado con SHA-256) + pbmini en un sandbox aislado (`.run/`, solo 127.0.0.1)
y lanza un catálogo de ataques. **Cada prueba declara un OBJETIVO** (qué intenta romper) **y una META** (resultado seguro esperado);
el panel muestra en vivo si la meta se cumple. Un detector global busca secretos canario en *todas* las respuestas.

```bash
python examples/pbmini/lab/lab.py              # panel http://127.0.0.1:8099 + ejecución automática
python examples/pbmini/lab/lab.py --headless   # consola, exit 1 si alguna meta falla (útil en CI)
python examples/pbmini/lab/lab.py --pb RUTA    # usar tu propio binario
```
Solo biblioteca estándar de Python 3.8+. Categorías: A archivos/rutas · B query · C body · D filtros/ACL · E caché · H páginas · J sesión/JWT/CSRF ·
K carpetas por parámetro y endpoints · N API nativa de PocketBase · R límite de peticiones · F fail-closed al arrancar (archivos inseguros en `pages/`) · L lint.
El sandbox arranca con `--indexFallback=false` (URL inexistente = 404 real).

## Qué NO demuestra
"100 % seguro" no es demostrable: el laboratorio prueba que las metas del catálogo se cumplen, no que no existan otras clases de fallo.
Sin cubrir: subida de archivos, SSE/WebSocket, SSRF (`$http`), Unicode/homógrafos, request smuggling y TLS (dependen del proxy), timing,
y dependencias de terceros en `pb_hooks`. En Windows se omiten 2 casos de symlink si no hay privilegio para crearlos.
