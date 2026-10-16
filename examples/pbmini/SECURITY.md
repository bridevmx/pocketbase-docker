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

---
# Ronda 2: query strings, base de datos y caché (medido en 0.40.5)

## Query string: comportamiento real de PocketBase/Go
| Entrada | Resultado medido | Riesgo |
|---|---|---|
| `a=1&a=2` | `query().get`/`requestInfo()` => `"1"`, `query()` entero => `["1","2"]` | HPP: distintas APIs ven valores distintos |
| `a=1;b=2`, `a=%zz`, `a=%E0%A4%A` | Go **descarta el par en silencio** (no hay error) | Diferencial con proxies/WAF que sí separan por `;` |
| `a=%00x` | pasa con NUL | Truncado en capas C / logs |
| `__proto__=x`, `__proto__[polluted]=y` | llegan como claves; `o[k]=v` en bucle cambia el **prototipo** del objeto | Prototype pollution al fusionar objetos |
| 5000 parámetros, 200 KB de query | 200 OK (límite real: 1 MB => 431) | DoS/CPU, claves de caché ilimitadas |

**Control**: pbmini no usa `url.query()`; parsea `rawQuery` con un parser estricto y esquema por ruta
(`query:{page:{type:"int",min:1,max:100,default:1}}`): máx. 2048 B / 32 pares, rechaza `;`, escapes inválidos,
control/NUL, duplicados (salvo `multi`), claves no declaradas (salvo `unknownQuery:"ignore"`), segmentos vacíos y nombres
reservados (`__proto__`, `constructor`...). El resultado es un objeto **sin prototipo** con solo claves declaradas y tipadas.
El body (`body:{...}`) usa el mismo validador y rechaza campos no declarados (mass assignment), anidados y `__proto__`.

## Base de datos: filtros y reglas (el hallazgo más grave de esta ronda)
Probado con `$app.findRecordsByFilter` (lo que hace cualquier hook):
- **Concatenar input en el filtro es inyectable**: `title = 'x' || published = false || title='y'` devolvió el borrador privado **y su campo `secret`**.
- **Oráculo ciego entre colecciones**: `' || @collection._superusers.email ~ 'su' || title='` cambió el número de resultados (3 vs 0) => se puede deducir contenido de `_superusers` letra a letra.
- **`sort` también filtra**: `sort=-title,secret` ordenó por un campo `hidden` y `sort=@collection.users.email` fue aceptado (oráculo de orden).
- **`$app.*` ignora las reglas de colección** (`listRule`/`viewRule`): devolvió registros no publicados que la API oficial oculta.
- Con parámetros enlazados (`{:t}`) la misma carga útil devolvió 0 resultados. Los campos `hidden` no se serializan al devolver el record entero, pero `record.get("secret")` sí los lee.

**Control**: *consultas preparadas*. Un filtro nunca se construye en runtime; se declara como constante en la ruta y solo se pasan parámetros:
```js
app.get("/posts", { auth:"public",
  queries: { byTitle: { collection:"posts", filter:"title = {:t}", sort:["title","-title"] } },
  query:   { title:{type:"string",max:100}, sort:{enum:["title","-title"],default:"title"} } },
  (c) => c.json(c.find("byTitle", { t: c.q.title }, { sort: c.q.sort })));
```
`c.find` valida parámetros y paginación, restringe `sort` a la lista declarada y a campos **no hidden**, aplica `listRule`/`viewRule`
con `canAccessRecord` por registro (regla `null` => solo superuser) y exporta con `publicExport()` (sin hidden ni email oculto).
Colecciones `_sistema` vetadas. `security/lint.sh` prohíbe `$app/$os/$http/e.*` en el código de rutas.

## Caché: lo que hace PocketBase y lo que añade pbmini
- PocketBase **no emite `Cache-Control` en ninguna respuesta** (ni en autenticadas); solo `Vary: Origin`. Todo `GET` sin ruta devuelve 200 + `Last-Modified`
  (fallback `index.html`), cacheable heurísticamente por CDNs: una entrada por cada URL inventada.
- `Host` se refleja tal cual; `X-Forwarded-*`/`X-Real-IP` se **ignoran** para `realIP()` por defecto (el rate limit no se evade con XFF).
- `Range` y `If-Modified-Since` funcionan en archivos (206/304).

**Controles de pbmini**
1. `Cache-Control: no-store` por defecto en todo; solo `200` anónimo de rutas con `cache:{maxAge}` relaja a `public, max-age=N`.
2. `cache` solo en `GET`, `auth:"public"`, sin `prefix`, `maxAge` 1..86400 (registro falla si no).
3. **Con `Authorization` o `Cookie` la respuesta es siempre `no-store` y no se sirve ni guarda en caché compartida**; las rutas cacheables ven `c.auth = null` y las reglas se evalúan como anónimo (no se puede personalizar una respuesta cacheada).
4. Errores, redirects y 4xx/5xx: siempre `no-store`.
5. `ETag` (SHA-256) + `If-None-Match` => 304 en rutas cacheables.
6. Caché de servidor opt-in (`cache:{server:true}`): la clave son **solo valores validados y declarados** (nunca URL cruda, `Host` ni cabeceras; el orden y la codificación de la query se normalizan);
   requiere parámetros/query acotados (int, bool, enum, id, slug, string<=32); se almacena como string JSON en `$app.store()` (los objetos JS no cruzan runtimes del pool);
   tope `PBMINI_STORE_MAX` (def. 20000): si está lleno se purga lo expirado y **no se desaloja** ni se inserta (una inundación no expulsa entradas legítimas).

## Cobertura de pruebas
`security/run-mini.sh` => 207 chequeos: archivos/rutas/XSS/redirect/límites 42, query 50, body 19, DB/ACL 32, caché 36, registro 26, lint 2.
Se verificó por **mutación** (desactivar reglas de colección, protección de credenciales en caché y rechazo de duplicados) que las pruebas fallan (12 FAIL).

## Límites y riesgos residuales (no resueltos / no probados)
- **Filtrado post-consulta por regla**: `c.find` aplica `listRule` tras `findRecordsByFilter`; una página puede devolver menos de `limit` filas (no filtra por conteo). Reglas muy costosas => N consultas por página (máx. 100).
- **Rate limit** aproximado y por proceso; con varias réplicas se multiplica. `e.realIP()` solo es fiable si configuras los *trusted proxy headers* de PocketBase tras tu proxy.
- **CSRF**: PocketBase autentica con cabecera `Authorization` (no cookie); si añades sesiones por cookie necesitas tokens CSRF y `SameSite`.
- **Sin cubrir**: subida de archivos, SSE/WebSocket, `$http` (SSRF), normalización Unicode (NFC/homógrafos), HTTP request smuggling (depende del proxy), TLS/HSTS (termina en el proxy), y fugas por tiempo (timing).
- Un hook que llame `$app`/`$os` directamente salta todos estos controles: el lint de CI es obligatorio.

---
# Ronda 3: páginas por archivos (modelo "PHP")

Principio: PocketBase ya trae login, usuarios y API; pbmini no los reimplementa. Añade el enrutado por archivos y las plantillas,
heredando **todos** los controles anteriores (auth explícita, query/body estrictos, consultas preparadas con reglas, caché `no-store` por defecto).

| Riesgo específico de las páginas | Control | Prueba |
|---|---|---|
| Un archivo olvidado se convierte en ruta (`.bak`, `.swp`, `_secret.js`) | `_*`/`.*` nunca son rutas; extensión distinta de `.js`/`.html` **aborta el arranque**; `pages/` no se sirve por HTTP | `/_secret`, `/.hidden`, `/pb_hooks/pages/_secret.js` sin fuga; `.js.bak`, `.txt` rechazados |
| Nombre de archivo que genera un patrón peligroso | Segmentos solo `[a-z0-9_.-]` o `[param]`; sin `..`; `[...x]` solo como archivo final | `Bad Name.js`, `[...a]/b.js` rechazados |
| Enlaces simbólicos dentro de `pages/` | Rechazados al cargar (tipo de archivo ≠ regular) | symlink `.html` rechazado |
| Typos de opciones (`rateLimt`, `auht`) que desactivan un control en silencio | Claves desconocidas en la página o en la ruta **abortan el arranque** | `rateLimt`, `auht`, `cahce` |
| XSS desde datos de la base | `html/template` autoescapa; `raw`/`js`/`html` prohibidos por `lint.sh` (cubre `pages/` y `views/`) | post con `<script>` renderiza `&lt;script&gt;` |
| Parámetros comodín (`[...path]`) | Cada segmento validado: sin `..`, `\`, NUL, `%`, ni segmentos ocultos | `/docs/.env`, `..%2f`, `%2e%2e`, `.git/config` => 404 |
| Conflictos de patrones (`[a]` vs `[b]`) | PocketBase aborta el proceso al arrancar (verificado); rutas duplicadas las detecta pbmini | `[a]`/`[b]` => el proceso termina |
| Borradores/no publicados en una página | `findOne` usa `viewRule` + filtro con parámetros enlazados | `/blog/private-draft` => 404 sin fuga |

Hallazgos técnicos de esta ronda
- Go **no permite redefinir un `{{block}}` con contenido por defecto en la misma cadena** de plantilla (`multiple definition of template "title"`): un layout con bloques y una página con `{{define}}` deben cargarse como archivos separados (`$template.loadFiles`). pbmini lo resuelve; un HTML plano sin `{{define}}` se inserta como `body` (el bloque `body` del layout debe estar vacío).
- `$template.loadFS` usa *glob*: nombres como `[slug].html` no se pueden pasar sin escapar; por eso se usa `loadFiles`.
- El CSP por defecto (`default-src 'self'`) bloquea `<style>`/`<script>` inline: los estilos y scripts van en `pb_public/`. Es deliberado.
- HTML enriquecido guardado en la base (campo `editor`) se muestra **escapado**: seguro por defecto; mostrarlo exige un sanitizador explícito (no incluido a propósito: un sanitizador casero es un riesgo de mXSS).
- Con `--indexFallback=false` las URLs inexistentes devuelven 404 real (verificado) en vez de `index.html` con 200.
- `docker-compose.yml` de ejemplo: **no probado** (en este entorno hay cliente Docker pero no daemon); solo validado con `docker compose config`.
