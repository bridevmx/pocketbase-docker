# Análisis de seguridad del router de PocketBase (pb_hooks)

Probado con PocketBase **0.40.5** (última disponible al 2026-10-16) en un entorno aislado.
Reproducible: `examples/pbmini/security/run.sh /ruta/a/pocketbase`.
Avisos oficiales publicados (GHSA-84vh-m24q-wjjx panic en goroutines, GHSA-pq7p-mc74-g65w y GHSA-m93w-4fxv-r35v
vinculación OAuth2): ninguno es de routing/archivos; los de 2026 están corregidos en 0.37.4 y 0.39.7 (< 0.40.5).

## Fortalezas (verificado)
| Control | Resultado |
|---|---|
| Traversal en `publicDir` y `$apis.static` (`../`, `%2e%2e`, `%2f`, `\`, `%00`, doble codificación) | Bloqueado (usa `fs.DirFS`/`ValidPath`); `../` limpio => 307 |
| Salida de `pb_hooks/` y `pb_data/` por HTTP | No expuestos (solo `publicDir`) |
| `{$}`/prefijo + `requireAuth` en `/area/` | Protege todos los subpaths, incluso con `//`, `./`, `%2e%2e` |
| `$template` | Autoescape contextual (`<script>` -> `&lt;script&gt;`) |
| Errores `throw new Error(...)` | Enmascarados al cliente (no filtran "db password…") |
| Límite de body | 413 por defecto; `$apis.bodyLimit(n)` por ruta |
| Aislamiento de handlers | Variables externas no visibles (`typeof SECRET === "undefined"`) |
| API del sistema (`/api/collections`, `/api/settings`, `/api/logs`) | 401 sin superuser |
| Cabeceras | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` |

## Debilidades y trampas (verificado)
1. **Parámetros llegan decodificados**: `/bad/read/..%2foutside%2fsecret.txt` leyó un archivo fuera del directorio
   cuando el handler concatena `pathValue()` a una ruta (`$os.readFile`). También `{p...}` con `%2e%2e/`. **Nunca concatenar.**
2. **Symlinks y dotfiles se sirven** desde `publicDir`/`$apis.static`/`e.fileFS(dirFS)`:
   `pb_public/link.txt -> /fuera/secreto` y `pb_public/.env` fueron legibles. `DirFS` no impide seguir symlinks.
3. **`/` y `/prefijo/` son comodines**: `app.get("/")` capturó todo el sitio. Usar `/{$}` para exacto.
4. **Olvido de middleware = ruta abierta**: `/admin/open` sin `requireSuperuserAuth()` respondió 200. No hay auth por defecto en rutas custom.
5. **Cobertura de auth por patrón exacto**: `/admin/users/` (barra final) no coincide con `/admin/users` y cae al fallback estático
   (sin fuga, pero sorprende). Rutas son sensibles a mayúsculas (`/ADMIN/` no coincide).
6. **Open redirect**: `e.redirect(302, query.to)` aceptó `https://evil` y `//evil`.
7. **XSS**: `{{.v|raw}}` y concatenar HTML en `e.html()` no escapan.
8. **CORS `*` por defecto** (incluye rutas custom, preflight 204): no usar cookies/credenciales ambientales en rutas custom sin reconfigurar.
9. **Sin rate limit por defecto** (120/120 respondieron 200); sin CSP, HSTS ni Referrer-Policy.
10. **Fallback SPA**: cualquier GET sin ruta devuelve `index.html` con 200 (rutas inexistentes no dan 404, ensucia scanners/SEO).
11. **Los hooks son código con acceso total** (`$os.exec`, `$os.readFile`, `$app`): un `require()` de terceros o un hook comprometido = RCE. `pb_hooks` debe ser de solo lectura en producción.
12. Un `panic` fuera de request puede tumbar el proceso (GHSA-84vh…, corregido). Mantener versión actualizada.

## Reglas obligatorias para el microframework (guardrails)
- **Deny by default**: rutas custom requieren declarar `auth: "public" | "user" | "superuser"` explícito; sin declarar => error al registrar.
- **Params tipados y validados** antes del handler (`{id:[a-z0-9]{15}}`, `{slug:slug}`); rechazar `..`, `/`, `\`, NUL, `%`.
- **Prohibir rutas de archivo desde input**: ofrecer solo `c.file(basename-validado)` con `path.Clean` + comprobación de prefijo + `Lstat` que rechace symlinks y dotfiles.
- **Escape por defecto** en `c.html`; `raw` solo mediante `c.unsafeHtml()` explícito.
- **Redirects** solo a rutas relativas que empiecen con un `/` único (rechazar `//` y esquemas).
- **Cabeceras de seguridad** (CSP, Referrer-Policy, HSTS tras proxy) y CORS restrictivo por ruta, vía middleware global.
- **404 real** (JSON/HTML) en lugar del fallback a `index.html`, salvo SPA declarada.
- **Rate limit** (config nativa de PocketBase) y `bodyLimit` bajo por defecto en rutas custom.
- **Despliegue**: `pb_public` sin symlinks ni dotfiles (comprobar en CI), `pb_hooks` read-only, `ENCRYPTION` activado, contenedor sin privilegios.
- **Pruebas**: `security/run.sh` debe pasar en CI para cada versión de PocketBase.

## Estado de implementación en `pbmini` (verificado con `security/run-mini.sh`, 44 chequeos)
| Control | Implementación |
|---|---|
| Deny by default | `auth: "public"\|"user"\|"superuser"` obligatorio; si falta, el registro aborta |
| Registro fail-closed | Se valida todo antes del primer `routerAdd`; si algo falla, `$os.exit(1)` (`PBMINI_ON_ERROR=warn` para dev). **PocketBase por sí solo sigue vivo tras un error de hook** |
| Params validados | Todo parámetro rechaza `/ \ % NUL ..` y dotfiles en comodines; tipos `id`, `slug`, `int`, `uuid` o RegExp; inválido => 404 |
| Archivos | `c.file(dir, rel)`: sin symlinks, dotfiles, directorios ni traversal (`readDir` + tipo estricto) |
| XSS | HTML solo por `c.view` (autoescape); `c.unsafeHtml` explícito; `c.esc` |
| Redirects | `c.redirect` solo `"/ruta"` (rechaza `//`, `/\`, esquemas, control) |
| Cabeceras | CSP, Referrer-Policy, nosniff, X-Frame-Options, Permissions-Policy, CORP en rutas custom |
| Errores | Excepciones => 500 genérico; detalle solo en logs |
| Abuso | `bodyLimit` 1 MiB por defecto (configurable); rate limit 120/min/IP/ruta (aprox., en `$app.store()`; usa `rateLimit:false` o ajusta) |
| Rutas reservadas | `/api/` y `/_/` requieren `allowSystemPrefix`; `/` y `prefijo/` requieren `prefix:true` |

### Límites conocidos (no resueltos por pbmini)
- CORS `*` global de PocketBase y el fallback `index.html` de `publicDir` (usar `--indexFallback=false` si no es una SPA).
- `publicDir`/`$apis.static` nativos siguen sirviendo symlinks y dotfiles: en `pb_public` usa `c.file` o audita con CI.
- El rate limit no es atómico ni persistente; para producción usa también el limitador nativo de PocketBase o el proxy.
- El código de `pb_hooks` tiene acceso total al sistema: revisar dependencias, montar de solo lectura.
