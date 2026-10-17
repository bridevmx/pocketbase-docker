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
- **Prohibir rutas de archivo desde input**: ofrecer solo `ctx.file(basename-validado)` con `path.Clean` + comprobación de prefijo + `Lstat` que rechace symlinks y dotfiles.
- **Escape por defecto** en `ctx.html`; `raw` solo mediante `ctx.unsafeHtml()` explícito.
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
| Archivos | `ctx.file(dir, rel)`: sin symlinks, dotfiles, directorios ni traversal (`readDir` + tipo estricto) |
| XSS | HTML solo por `ctx.view` (autoescape); `ctx.unsafeHtml` explícito; `ctx.escape` |
| Redirects | `ctx.redirect` solo `"/ruta"` (rechaza `//`, `/\`, esquemas, control) |
| Cabeceras | CSP, Referrer-Policy, nosniff, X-Frame-Options, Permissions-Policy, CORP en rutas custom |
| Errores | Excepciones => 500 genérico; detalle solo en logs |
| Abuso | `bodyLimit` 1 MiB por defecto (configurable); ~~rate limit propio~~ (reemplazado en la Ronda 4 por el limitador **nativo** de PocketBase) |
| Rutas reservadas | `/api/` y `/_/` requieren `allowSystemPrefix`; `/` y `prefijo/` requieren `prefix:true` |

### Límites conocidos (no resueltos por pbmini)
- CORS `*` global de PocketBase y el fallback `index.html` de `publicDir` (usar `--indexFallback=false` si no es una SPA).
- `publicDir`/`$apis.static` nativos siguen sirviendo symlinks y dotfiles: en `pb_public` usa `ctx.file` o audita con CI.
- El código de `pb_hooks` tiene acceso total al sistema: revisar dependencias, montar de solo lectura.

---
# Ronda 2: query strings, base de datos y caché (medido en 0.40.5)
> Nota: los ejemplos de esta ronda usan la API histórica `app.get(...)` y `c`. Hoy cada ruta es un archivo en `pages/` y el contexto se llama `ctx` (Ronda 5/6); los controles descritos no cambiaron.

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
  (ctx) => ctx.json(ctx.find("byTitle", { t: ctx.query.title }, { sort: ctx.query.sort })));
```
`ctx.find` valida parámetros y paginación, restringe `sort` a la lista declarada y a campos **no hidden**, aplica `listRule`/`viewRule`
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
3. **Con `Authorization` o `Cookie` la respuesta es siempre `no-store` y no se sirve ni guarda en caché compartida**; las rutas cacheables ven `ctx.user = null` y las reglas se evalúan como anónimo (no se puede personalizar una respuesta cacheada).
4. Errores, redirects y 4xx/5xx: siempre `no-store`.
5. `ETag` (SHA-256) + `If-None-Match` => 304 en rutas cacheables.
6. Caché de servidor opt-in (`cache:{server:true}`): la clave son **solo valores validados y declarados** (nunca URL cruda, `Host` ni cabeceras; el orden y la codificación de la query se normalizan);
   requiere parámetros/query acotados (int, bool, enum, id, slug, string<=32); se almacena como string JSON en `$app.store()` (los objetos JS no cruzan runtimes del pool);
   tope `PBMINI_STORE_MAX` (def. 20000): si está lleno se purga lo expirado y **no se desaloja** ni se inserta (una inundación no expulsa entradas legítimas).

## Cobertura de pruebas
`security/run-mini.sh` => 207 chequeos: archivos/rutas/XSS/redirect/límites 42, query 50, body 19, DB/ACL 32, caché 36, registro 26, lint 2.
Se verificó por **mutación** (desactivar reglas de colección, protección de credenciales en caché y rechazo de duplicados) que las pruebas fallan (12 FAIL).

## Límites y riesgos residuales (no resueltos / no probados)
- **Filtrado post-consulta por regla**: `ctx.find` aplica `listRule` tras `findRecordsByFilter`; una página puede devolver menos de `limit` filas (no filtra por conteo). Reglas muy costosas => N consultas por página (máx. 100).
- **Rate limit**: ahora es el nativo de PocketBase (Ronda 4). `realIP` solo es fiable tras un proxy si configuras los *trusted proxy headers* de PocketBase.
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

---
# Ronda 4: auditoría "no reinventar la rueda" (doc oficial + pruebas)

Se leyó la documentación de PocketBase (hooks de records, reglas, autenticación, producción, SDK/SSR, ajustes) y se midió lo que la doc no aclara.
Consecuencias en el código (todas verificadas con `run-mini.sh`, 313 comprobaciones):

| Lo que hacía pbmini | Veredicto | Cambio |
|---|---|---|
| Limitador de peticiones propio | **Reinventado**: el limitador nativo SÍ aplica a rutas de hooks (exactas, prefijo `/…/` y `GET /ruta`) y no se evade con `X-Forwarded-For` | Eliminado (`rateLimit` ya no existe y es error al registrar). Migración de ejemplo + aviso al arrancar (`onServe`) si está desactivado |
| Comprobaciones de auth inline (401/403) | **Reinventado**: existen middlewares nativos | Se usan `$apis.requireAuth()` / `requireSuperuserAuth()` (un usuario normal en ruta superuser recibe 403 nativo) |
| `canAccessRecord` + `publicExport` en `ctx.find` | **Nativo y documentado** (ejemplo oficial de `routerAdd` + `canAccessRecord`) | Se mantiene; solo añade filtros constantes y `sort` limitado |
| Restricciones de filtro/orden | La API REST ya bloquea hidden/`@collection`/`@request` (400/403); los hooks (`$app.*`) no | Se mantiene, pero solo porque los hooks no las tienen (documentado) |
| Escrituras | PocketBase ya las valida con sus reglas | **No se implementan**; se descartó la "escritura declarativa" |
| Login/sesiones | Token JWT sin estado, revocación por cambio de contraseña (verificado) | **No se implementan**. Solo se lee la cookie `pb_auth` del SDK |

## Sesión por cookie: lo medido
Validar con `$app.findAuthRecordByToken(token, "auth")` es suficiente (lo hace PocketBase): firma alterada, payload alterado con firma original,
`alg=none`, token de archivo, JSON roto, token no-string, cookie de 9 KB → todos anónimos (401); `record` falso dentro de la cookie se ignora;
`Authorization` tiene prioridad sobre la cookie; cambiar la contraseña invalida el token (cookie y cabecera) y no afecta a otros usuarios.
Con cookie hay riesgo CSRF (credencial ambiental): los métodos que cambian estado exigen `Sec-Fetch-Site` same-origin/none (cross-site/same-site → anónimo).
La API nativa no lee la cookie, así que no se amplía su superficie.

Riesgos residuales: la cookie escrita por JS no puede ser `HttpOnly` (mismo riesgo que `localStorage`; mitiga el CSP); "cookie tossing" desde un subdominio solo puede degradar a anónimo
(la primera `pb_auth` manda), nunca suplantar a otro usuario; un cliente sin `Sec-Fetch-Site` (no navegador) no es vector CSRF; tokens robados siguen siendo válidos hasta expirar o cambiar la contraseña (no hay logout en servidor, igual que en PocketBase).

---
# Ronda 5: rutas por carpetas y endpoints por archivo

Medido en 0.40.5 (el enrutador nativo es el de Go 1.22; la doc de PocketBase no muestra comodines en medio de la ruta, pero funcionan):
`/n/{slug}/comments/{id}` y `/n/{slug}/edit` conviven; `/k/{a}/x` y `/k/{b}/y` no entran en conflicto; solo dos patrones que se solapan en la misma posición abortan el arranque.
`%2f` dentro de un parámetro llega **decodificado** (`a/b`), por eso los tipos estrictos son obligatorios; en rutas con auth, la autenticación se evalúa antes que la validación del parámetro (401, no 404).

| Cambio | Motivo | Prueba |
|---|---|---|
| Todo parámetro es carpeta (`[id]/index.js`); `[x].js` plano aborta | Una sola forma de declarar rutas; sin choques `[a]` vs `[b]` entre archivos y carpetas | lab F: `[slug].js`, `[...path].js` |
| `index` = ruta exacta de su carpeta (sin barra final); la raíz sigue siendo `/{$}` | Sin redirección 307 ni doble URL (`/blog/abc` y `/blog/abc/`); la forma con barra es 404 | lab K: `/users/<id>/` → 404 |
| `[...x]` es carpeta y solo admite `index.*` | Go solo admite el comodín al final | lab F: comodín con otro archivo/subcarpeta |
| Sin `routes.js`: cada ruta es un archivo; `.js` sin `.html` = endpoint JSON | Un único registro de rutas, el mismo control de auth/query/body para páginas y endpoints | lab K, `pages/healthz.js` |
| `body` sin ningún método que lo use aborta el arranque | Antes se ignoraba en silencio (hallazgo del laboratorio) | lab F: "body en GET" |
| Laboratorio con `--indexFallback=false` | URL inexistente = 404 real (no 200 con `index.html`) | lab K: `/nada/x/y` → 404 |

Hallazgo corregido de paso: la prueba de "firma JWT alterada" cambiaba el último carácter de la firma, que solo aporta bits de relleno de base64url
y a veces la deja intacta (falso fallo intermitente). Ahora se altera el primer carácter.

---
# Ronda 6: nombres declarativos del contexto
`c` → **`ctx`**, y sus campos sin abreviar: `ctx.q` → `ctx.query`, `ctx.b` → `ctx.body`, `ctx.auth` → `ctx.user`, `ctx.esc` → `ctx.escape`.
En plantillas: `.Q` → `.Query`, `.P` → `.Params` (`.User` no cambia). Se eliminó el alias `c`. No se usa `e` a propósito: es el evento crudo de PocketBase y el lint lo bloquea en `pages/`.

---
# Ronda 7: fase de ataques contra el framework (lab, categorías S1–S16)

Alcance: solo pbmini (la API nativa `/api/*` queda fuera). 184 ataques con patrones habituales de atacantes, ejecutados en vivo contra PocketBase 0.40.5
(`python examples/pbmini/lab/lab.py --only S`): tampering de métodos (10 métodos × 7 rutas protegidas), bypass de auth (cabeceras/cookies/tokens en lugar equivocado,
dobles `Authorization`/`pb_auth`), CSRF (8 variantes de cabeceras × 4 Content-Type), cuerpos y Content-Type hostiles, 128 variantes de normalización de rutas (32 × 4 rutas protegidas), 33 destinos de
open redirect, XSS/SSTI reflejado y almacenado (verificado **parseando el HTML devuelto**, no con regex), inyección (52 payloads × 10 puntos de entrada), Unicode, reconocimiento
(55 rutas clásicas), traversal y trucos de Windows en `ctx.file`, Host/proxy/CORS, 27 ataques de protocolo crudo (smuggling, TE/CL, obs-fold, HTTP/0.9, h2c), Slowloris,
carga concurrente, ReDoS, aislamiento entre usuarios con 300 peticiones intercaladas y fuzzing de 1500 peticiones (semilla fija).

Resultado inicial: 38 fallos que se redujeron a **4 hallazgos reales** (el resto eran expectativas mías demasiado estrictas o detectores torpes). Todos corregidos y verificados con el mismo ataque:

| # | Hallazgo | Impacto | Corrección |
|---|---|---|---|
| 1 | **CSRF solo con `Sec-Fetch-Site`**: un POST con cookie y `Origin: https://evil` sin esa cabecera (navegadores sin Fetch Metadata) se aceptaba | Escritura con la sesión de la víctima | `csrfOk` exige además que `Origin` (o `Referer` si falta) coincida con el `Host`; `Origin: null` se rechaza. Tras un proxy debe reenviarse el `Host` original |
| 2 | **Dotfiles servidos por el `publicDir` nativo** (`/.env`, `/.git/config` devolvían 200 con contenido) | Fuga de secretos desplegados en `pb_public` | Middleware global `pbmini_dotfiles`: 404 `no-store` a cualquier ruta con un segmento que empiece por `.` (salvo `/.well-known/`) |
| 3 | **JSON laxo**: `{"n":1}x` y dos documentos pegados se aceptaban (Go ignora lo que sigue al primer valor) | Diferencial parser/WAF (smuggling de campos) | El JSON se parsea con `JSON.parse` estricto sobre el cuerpo crudo; array/null/escalar en la raíz → 400 |
| 4 | **Comodines aceptaban UTF-8 inválido y caracteres de engaño** (`%C0%AE%C0%AE` overlong, U+FF0F `／`, bidi, ZWSP) | Evasión de filtros aguas abajo / best-fit de Windows | `SEG_BAD` rechaza U+FFFD, invisibles, bidi y barras/puntos de ancho completo |

Observaciones aceptadas (no son fallos, quedan documentadas):
- **Claves duplicadas** `{"n":1,"n":2}`: gana la última (igual que Go y `JSON.parse`); un WAF que lea la primera vería otra cosa. No se puede detectar sin parser propio.
- **`-0`** se normaliza a 0; `charset=utf-7` se ignora (el cuerpo se lee siempre como UTF-8); un adjunto multipart no declarado se descarta.
- **`501`/`505`** ante `Transfer-Encoding` desconocido o `HTTP/9.9` son el rechazo estándar de Go.
- **Rendimiento**: con 64 conexiones simultáneas la latencia sube (mediciones en Windows: ~70 req/s en serie, p95 de 4-5 s con 600 peticiones en ráfaga) pero sin errores y con recuperación inmediata. Ajusta `--hooksPool`, el limitador nativo y el proxy.
- **Symlinks** en `pb_public` siguen sin bloquearse en el servidor nativo (hace falta auditar en CI; `ctx.file` sí los rechaza).
- **No cubierto**: carreras TOCTOU de symlinks, canales de tiempo, TLS/HTTP2 (dependen del proxy), y los 26 vectores de la API nativa de `VECTORS.md` (grupo A).

---
# Ronda 8: pruebas profundas de los 4 hallazgos (lab D1–D6, P) y cobertura Windows + Linux

Investigación previa (técnicas actuales, no específicas de PocketBase) y qué se probó con cada una:

| Técnica / fuente | Qué enseña | Cómo se prueba aquí |
|---|---|---|
| *Breaking Parser Logic* (Orange Tsai, Black Hat/DEF CON 2018) y el aviso de Envoy 2026 (`/..;foo=bar/`) | La capa que decide y la que sirve interpretan distinto la ruta (`..;/`, `%2f`, `//`, `;`, `?`) | D1: 5 familias × 4 objetivos y un barrido de 10 objetivos × 5 familias (1431 rutas): codificación (%2e, %252e, overlong, %u), delimitadores (`?raw??`, `;`, `#`, `%00`, `::$DATA`), barras (`\`, `%5c`, `//`, `..;/`), Unicode y Windows |
| CVE-2025-30208 (Vite): `?raw??` esquiva `server.fs.deny` | Un sufijo de query puede desactivar la lista de denegación | D1 «delimitadores»: `.env?raw??`, `?import&raw??`, `?.css`, `?inline`... |
| *WorstFit* (DEVCORE, 2025): *best-fit* de Windows convierte U+FF0E/U+FF0F/U+FF3C... en `.` `/` `\` | Un nombre «seguro» se vuelve traversal/dotfile al convertir | D1 «unicode» y D6: 16 puntos y 12 barras parecidos, invisibles, bidi (Trojan Source), TAG, compatibilidad NFKC, NFD, UTF-8 overlong/inválido |
| CVE-2023-45283/45284 (Go): nombres reservados de Windows (`CON`, `COM1 `, `COM¹`) y `\??\` | Abrir `CON`/`NUL` bloquea o toca dispositivos | D2: 18 nombres reservados (con extensión, espacio, punto, `::$DATA`, superíndices) → 404 inmediato |
| *An Exploration of JSON Interoperability Vulnerabilities* (Bishop Fox) | Claves duplicadas, comentarios, truncado, floats/enteros, basura final, `Content-Type` ignorado | D5: 28 tipos MIME × cuerpo con basura final, 56 cuerpos hostiles y 12 formularios (comentarios, NaN, BOM, UTF-16/32, surrogates, tipos cruzados `"5"`, anidado 5000) y formularios |
| Bypass de CSRF: `Origin: null`, Referer suprimido, sufijo/userinfo/fragmento en el host, cookie tossing, `SameSite` ≠ `same-origin` | `Sec-Fetch-Site` ausente o `Origin` mal comparado | D4: 22 casos de Origin, 8 de Referer, 13 de Sec-Fetch-Site, 8 Content-Type de formulario, cabeceras contradictorias y Origin duplicado |
| Linux: symlinks, FIFO, `/proc`, nombres con `\ % \n \t` | El servidor nativo sigue symlinks y bloquea al abrir una FIFO | D3 y P (solo se pueden ejecutar en Linux/macOS) |

**Hallazgos nuevos (todos reproducidos antes de corregirlos y verificados por mutación):**

| # | Hallazgo | Corrección |
|---|---|---|
| 5 | **Symlinks en `pb_public` se servían** (Linux: `/link.txt` devolvía un archivo de fuera del directorio) y **una FIFO colgaba la petición para siempre** (DoS) | Auditoría de arranque con `$filepath.walkDir` (no sigue enlaces): `PBMINI_PUBLIC_AUDIT=strict` (por defecto) aborta; `warn` los bloquea en ejecución con una lista de denegación por runtime |
| 6 | **Respaldos y secretos no ocultos** servibles desde `pb_public` (`.bak .sql .pem .log .db .ini id_rsa Dockerfile package.json`, `~`) | Lista de denegación (solo en la ruta estática y en `ctx.file`) + la misma comprobación en la auditoría de arranque |
| 7 | **Nombres cortos 8.3 (`ENV~1`), dispositivos de Windows (`CON`, `NUL`), flujos NTFS (`:$DATA`), caracteres `: * ? " < > \|`** | Rechazados en la ruta estática y en `ctx.file` |
| 8 | **Segmentos con caracteres de compatibilidad Unicode** (NFKC distinto del original), bidi aislado (U+2066–2069), rellenos invisibles, TAG | `safeSegment` exige `s.normalize("NFKC") === s` y amplía la lista de caracteres prohibidos |
| 9 | **JSON con tipos cruzados**: `{"n":"5"}` y `{"ok":"true"}` se aceptaban como número/booleano | En JSON los tipos son estrictos; en formularios y query siguen siendo cadenas |
| 10 | **CSRF**: sin `Sec-Fetch-Site`, `Origin` ni `Referer` (navegador antiguo con Referer suprimido o `<form>` en un cliente que no los envía) la escritura con cookie se aceptaba | Ese caso ambiguo solo se acepta si la petición es «no simple» (`Content-Type: application/json` o `X-Requested-With`), algo que un `<form>` entre sitios no puede fabricar. `Sec-Fetch-Site: same-origin\|none` válido sigue bastando |

**Matriz de cobertura por sistema operativo** (ejecutado: Windows 10 nativo y Ubuntu en WSL; macOS no probado):

| Área | Windows | Linux | Nota |
|---|---|---|---|
| Dotfiles, sensibles, CSRF, JSON, Unicode, protocolo, fuzzing | ✔ ejecutado | ✔ ejecutado | Mismas pruebas, mismo resultado |
| Nombres 8.3, dispositivos, `::$DATA`, `\` | ✔ ejecutado | ✔ (404 por el guardia) | En Linux el guardia los bloquea aunque el SO no los interprete (el sitio puede desarrollarse en Windows y desplegarse en Linux) |
| Symlinks y FIFO (D3, P016–P018) | omitido (sin privilegio) | ✔ ejecutado | Mutación: sin el guardia, `/link.txt` devuelve 200 y `/pipe` se cuelga |
| Nombres con `\ % \n \t` NFD y bidi existentes en disco | omitido (inválidos en NTFS) | ✔ ejecutado | |
| `/proc/self/environ`, `/etc/passwd`, `/dev/zero` | omitido | ✔ ejecutado | |
| Sensibilidad a mayúsculas | `/PUB.TXT` sirve `pub.txt` (inofensivo) | `/PUB.TXT` → 404 | Los bloqueos usan `/i` para cubrir ambos |

Límites que siguen abiertos: carreras TOCTOU (un symlink creado *después* del arranque no está en la lista de denegación; exige permiso de escritura en `pb_public`, por eso el despliegue debe montarlo de solo lectura),
macOS (APFS normaliza nombres a NFD y es insensible a mayúsculas: sin probar), `Origin` duplicado (se evalúa solo el primero) y la heurística de `~[0-9]` (rechaza también archivos legítimos como `a~1b`).
Los comandos de la CLI de PocketBase (`superuser upsert`, `migrate`) cargan los hooks y por tanto ejecutan la auditoría: con un `pb_public` sucio abortan (usa `PBMINI_PUBLIC_AUDIT=warn` solo en desarrollo).

---
# Ronda 9: segunda tanda de funcionalidades (esquemas, datos, páginas, operación, desarrollo) con su fase de ataque

**Decisión de diseño (sección «cuentas y sesiones»).** Se comparó cada idea con lo que PocketBase ya hace (documentación oficial, revisada de nuevo):

| Idea | PocketBase nativo | Decisión |
|---|---|---|
| Roles / membresías | solo campos + reglas (`@request.auth.role = …`) | módulo **opcional** `access` (flag, 2 modos) que lee campos existentes; no crea tablas |
| Flujos de cuenta (verificar, restablecer, cambiar correo) | endpoints y plantillas nativos; el restablecimiento invalida los tokens | **no se implementa** (duplicaría superficie: enumeración, límites) |
| Sesiones múltiples | tokens sin estado: no hay lista ni revocación individual | módulo **opcional** `sessions` (apagado, compatible con proyectos existentes); `logout`/`logoutEverywhere` siempre disponibles |
| 2FA / OTP / OAuth2 | opciones de la colección (MFA con `_mfas`, OTP, OAuth2) | **no se implementa**; se documenta |

**Modelo de amenazas y defensas nuevas** (cada una con ataques y mutaciones en el laboratorio):

| Función | Amenaza | Defensa |
|---|---|---|
| Esquemas reutilizables | esquema inexistente/ambiguo se ignora y desactiva validación | nombre resuelto en arranque; cualquier anomalía aborta |
| Filtros declarados | inyección de filtro por la query | fragmentos constantes con un único `{:v}`; la petición solo aporta valores enlazados |
| Paginación | `total` revela registros ocultos; `perPage` enorme | solo `hasMore` sobre lo visible; límites validados en arranque |
| Escrituras / tx | mass assignment, robo de propiedad (`owner`), escritura por GET (CSRF), reglas de creación | lista blanca de campos; regla de update/delete contra el registro existente **antes** de modificar; GET prohibido; creación con regla evaluada en transacción |
| Caché con etiquetas | datos obsoletos tras un cambio | purga por colección desde hooks nativos; etiqueta inválida = sin caché |
| Layouts / errores | eco de datos de la petición en la página de error; XSS entre niveles | solo `Status/Reason`; un único autoescape para toda la cadena |
| i18n | envenenamiento de caché por idioma; `Accept-Language` hostil; interpolación | idioma en la clave de caché + `Vary`; cabecera acotada y validada contra archivos; sustitución literal de una pasada |
| Cron | expresiones inválidas que nunca corren; ejecución por usuarios | validación de rango en arranque; solo superusuario puede lanzarlas |
| Correo | inyección de cabeceras, correo masivo, disparo por enlace | destinatario único con regex estricta, límites por hora, nunca desde GET, remitente fijo |
| Acceso | plan vencido, valores hostiles en campos, campos ausentes | fail-closed; plan de pago sin fecha vigente = vencido; roles/permisos solo de listas declaradas |
| Sesiones | token en claro en la base, revocar sesiones ajenas, tokens huérfanos tras un refresh | solo `sha256`; propiedad comprobada; el token anterior queda ligado a la misma sesión |
| Generador | traversal, sobrescritura | mismas reglas de nombres que el cargador (`lib/names.js`); nunca sobrescribe ni sale de `pages/` |

**Hallazgos de la fase de ataque de esta ronda** (todos corregidos y cubiertos por una prueba):
1. `e.requestInfo()` falla (EOF) tras leer el cuerpo con el parser JSON estricto: las reglas de colección se evalúan ahora con un `RequestInfo` propio (auth + método + cuerpo ya validado).
2. La regla `createRule` solo se puede evaluar con el registro guardado (como hace la API nativa): se hace dentro de una transacción que se revierte si niega.
3. `cronAdd` de PocketBase acepta `61 25 * * *` (nunca se ejecutaría): validación de rangos propia.
4. Un fixture del propio laboratorio devolvía 500 con una consulta válida sin parámetro (`/posts` sin `title`): el fuzzer guiado lo detectó; corregido.
5. Dos JWT del mismo usuario emitidos en el mismo segundo son idénticos: comparten sesión (documentado, y las pruebas lo respetan).
6. Tras un `refresh`, el token anterior seguía siendo aceptado por `legacy: "allow"` aunque la sesión se revocara: ahora queda ligado a la misma sesión (`olds`).

**Fuzzer guiado por definiciones** (`lab/attacks_guided.py`): lee `pocketbase pbmini:routes` y, por cada ruta, comprueba la matriz de autenticación, ~20-40 entradas inválidas por campo
(límites, casi-patrones, tipos cruzados, duplicados, prototipos, cuerpos raros), entradas válidas generadas (nunca 5xx ni fugas) y 400 mezclas aleatorias con semilla fija.

**Límites que siguen abiertos (honestidad):** la API nativa de PocketBase no pasa por `access`/`sessions` (espeja las reglas en las colecciones); apagar `sessions` reactiva tokens revocados no vencidos;
`hasMore` puede quedar corto si el `filter` base es más amplio que la `listRule`; macOS sin probar; el laboratorio no prueba TLS/HTTP2/proxy.

**Resultados de la Ronda 9** (laboratorio completo con los módulos opcionales activados en el sandbox):
- Windows 10 nativo: **1147 pasan, 0 fallan, 7 omitidas** (symlinks/FIFO/nombres con `\`, que Windows no permite crear). Linux (Ubuntu en WSL1): **1155 pasan, 0 fallan** (+ `tsc` omitido porque el `npx` visible es el de Windows).
- Mutaciones: se rompió una defensa a la vez en 21 puntos (filtros, reglas de update/delete/creación, escritura desde GET, caché con etiquetas, páginas de error, i18n, acceso, sesiones, correo, validación de enteros, generador).
  **21 detectadas**; una (T2, la comprobación «no se escribe desde un GET» dentro de `mutate`) no la detecta ninguna prueba porque es la **tercera capa** de la misma defensa (`pages.js` elimina `mutations` de los GET y `route()` aborta si un GET las declara): es defensa en profundidad inalcanzable por HTTP a propósito.
  La mutación S3 (token anterior sin ligar a la sesión) no se detectaba al principio: se reforzó la prueba (segundo refresh con el token ya rotado) y ahora se detecta.
- `pbmini:routes` usa una carpeta de datos propia (`pb_data_cli`) porque en Linux SQLite bloquea la principal mientras el servidor está abierto.

---
# Ronda 9b: `sessions` con `sid` en el token y veto global + mejoras de `access`

Se **midió antes de diseñar** (sandbox aparte): los JWT de PocketBase no llevan `iat`/`jti` (dos logins del mismo segundo son idénticos); cambiar la contraseña o el correo invalida los tokens (`verified=false` no);
`_authOrigins` solo se guarda si el correo de alerta se envía bien (sin SMTP no sirve); `onRecordAuthRequest` permite sustituir `e.token`; PocketBase acepta un token firmado con `tokenKey + authToken.secret` y un claim propio;
un middleware global con lista negra en memoria revoca también la API nativa, y la lista sobrevive a un reinicio si se persiste.

**Cambios:** `sessions` ya no guarda el hash del token ni consulta la base por petición; cada sesión tiene un `sid` dentro del token; el veto es global (pbmini, `/api/*`, refresh); `access` bloquea el login de cuentas bloqueadas, veta sus sesiones y genera las reglas nativas equivalentes (`pbmini:access rules`).

**Hallazgos del ataque de esta ronda** (corregidos y cubiertos por prueba):
1. `@request.auth.<select> ?= "x"` **no funciona** en reglas de PocketBase (siempre falso): el generador usa `~ '"x"'`. Lo encontró la prueba de equivalencia reglas↔`access`.
2. `~` no distingue mayúsculas y `=` sí: las listas de texto se comparan con `:lower` y por token exacto; el estado bloqueado usa `:lower`; pbmini compara roles/permisos sin distinguir mayúsculas para que ambos coincidan.
3. Una regla `perms ~ "posts.write"` concedía el permiso a `posts.write2` (subcadena): sustituida por coincidencia de token exacto.
4. Con `sessions`, un usuario bloqueado ya no tiene token válido (401, no 403 `account_blocked`): la comprobación de bloqueo de `access` queda como segunda capa.

5. **Cambiar el `authRule` de una colección de autenticación invalida todos sus tokens** (medido en PocketBase 0.40.5; no está documentado). El generador lo avisa y la prueba aplica el `authRule` en una colección auxiliar, no en `users`.

**Resultados de la Ronda 9b:** Windows 10 nativo **1154 pasan, 0 fallan, 7 omitidas** (symlinks/FIFO); Linux (Ubuntu en WSL1) **1162 pasan, 0 fallan, 1 omitida** (`tsc`: el `npx` visible es el de Windows).
Mutaciones nuevas: **13 de 13 detectadas** (3 hubo que reforzar con pruebas: reuso de `sid` ajeno —protegido por dos capas, hay que romper las dos—, lista de sesiones tras `logoutEverywhere` y mayúsculas en la regla de estado).
Los números de «Resultados de la Ronda 9» más arriba son los de la tanda anterior (antes del rediseño de `sessions`).

---
# Ronda 9c: realtime (SSE) y revocación

**Medido en PocketBase 0.40.5:** la conexión SSE se autentica en el primer `POST /api/realtime` y no se vuelve a comprobar. Tras revocar la sesión (veto del `sid`), la conexión ya abierta **seguía recibiendo eventos**; un token que caduca con el SSE abierto también.
`onRealtimeSubscribeRequest` ve la cabecera `Authorization` (vía `e.requestEvent`), `onRealtimeMessageSend` puede descartar un mensaje (sin llamar a `e.next()`) y `client.discard()` retira la conexión del broker;
`record.original().tokenKey()` permite detectar un cambio de contraseña/correo sin falsos positivos en otros cambios.

**Defensa:** etiquetado de la conexión al suscribirse (sid, usuario, caducidad), corte inmediato al revocar/cerrar todo/bloquear/borrar/cambiar `tokenKey`, y comprobación por mensaje como red de seguridad.
Opción `sessions.realtime` (por defecto `true`). Pruebas: sección R del laboratorio (14 pruebas: revocar una sesión corta solo esa conexión, `logout`, `logoutEverywhere`, cambio de contraseña, usuario bloqueado/borrado,
tokens sin `sid`, tokens falsificados, corte masivo de 40 conexiones, caducidad con el SSE abierto, aislamiento de conexiones ajenas y anónimas). 7 de 7 mutaciones detectadas.

**Límites que quedan:** el SDK se reconecta tras el corte y su nuevo `POST /api/realtime` llega vetado (401); una conexión anónima no se vigila; el veto sigue viviendo en un solo proceso.

**Resultados finales de la Ronda 9c** (sessions con `sid` + realtime + `pbmini:new config`): Windows 10 nativo **1171 pasan, 0 fallan, 7 omitidas**; Linux (Ubuntu en WSL1) **1179 pasan, 0 fallan, 1 omitida** (`tsc`).
Las pruebas de concurrencia S180/S181 mostraron fallos intermitentes de **conexión** (status 0 en 1–2 de 300 peticiones, nunca contenido cruzado) en 2 de 5 corridas completas de Windows tras un reinicio del equipo; pasan siempre en aislamiento. Ahora reintentan solo los errores de conexión (nunca los de contenido).
`pbmini:new config` crea `pb_hooks/pbmini.config.js` copiando `pbmini.config.example.js` (una sola fuente de verdad), nunca sobrescribe y deja todo apagado.
