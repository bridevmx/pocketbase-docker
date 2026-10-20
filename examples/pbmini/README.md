# pbmini — PocketBase como servidor full‑stack (al estilo PHP)

Un archivo = una página. Datos, lógica y HTML viven en el mismo proceso de PocketBase, **sin otro servidor, sin build y sin
reinventar el login/API** (eso ya lo hace PocketBase). pbmini solo añade el enrutado, las plantillas y los controles de
seguridad que PocketBase no trae. Rutas, query, body, filtros y caché están *denegados por defecto*: ver [SECURITY.md](SECURITY.md).

## Arranque rápido
```bash
cp -r examples/pbmini mi-sitio && cd mi-sitio
pocketbase superuser upsert tu@correo.com 'una-clave-larga'
pocketbase serve --hooksDir=./pb_hooks --publicDir=./pb_public --migrationsDir=./pb_migrations --indexFallback=false
# http://127.0.0.1:8090  ·  admin: http://127.0.0.1:8090/_/  (crea entradas en la colección `posts`)
```
Edita `pb_hooks/pages/**` y PocketBase se recarga solo (Linux/macOS). Con Docker: `docker-compose.yml` de esta carpeta.

## Estructura (el archivo ES la ruta; todo parámetro es una carpeta)
```
pb_hooks/
  pages/
    _layout.html              layout de todo el sitio ({{block "body" .}}); en una subcarpeta lo reemplaza o lo extiende (ver Layouts anidados)
    _error.html               página de error (el más cercano manda)
    _schemas/paging.js        esquemas reutilizables (query: "paging")
    _partials/nav.html        parciales ({{define "nav"}}…{{end}}) disponibles en todas las páginas (≈ include de PHP)
    index.js + index.html     →  GET /                      (raíz; es la única que usa /{$})
    about.html                →  GET /about                 (solo .html = página estática pública)
    healthz.js                →  GET /healthz               (solo .js = ENDPOINT: el objeto devuelto sale como JSON)
    blog/index.js|html        →  GET /blog                  (index = la ruta de su carpeta, sin barra final)
    blog/[slug]/index.js|html →  GET /blog/{slug}           (la carpeta [slug] ES el parámetro; nunca un archivo [slug].js)
    users/[id]/update.js      →  POST /users/{id}/update    (un método por función: get/post/put/patch/delete)
    users/[id]/posts/[postId]/index.js → /users/{id}/posts/{postId}
    files/[...path]/index.js  →  GET /files/a/b/c           (comodín final: carpeta [...x] con solo index.*)
pb_public/                    CSS/JS/imágenes estáticos (el CSP es estricto: nada de <style>/<script> inline)
pb_migrations/                colecciones como código
pb_hooks/i18n/ · mails/ · cron/ · pbmini.config.js   traducciones, correos, tareas y módulos opcionales (todo opcional)
pb_hooks/types/pbmini.d.ts   tipos para el editor
```
No hay `routes.js` global: **cada ruta, página o endpoint, es un archivo junto a las demás** (equivalente a `+page`/`+server` de SvelteKit).
Un `.js` con `.html` renderiza la página; un `.js` sin `.html` es un endpoint (objeto → JSON, o `ctx.json/ctx.text/ctx.redirect`).
Los archivos que empiezan con `_` o `.` nunca son rutas. Un nombre inválido, un `[param].js` plano, un archivo que no sea `.js`/`.html`
o un `body` declarado sin método que lo use **abortan el arranque** (no se ignoran).

## Una página
```js
// pages/blog/[slug]/index.js
module.exports = {
  auth: "public",                                   // OBLIGATORIO: "public" | "user" | "superuser"
  params: { slug: "slug" },                         // tipos: id slug uuid int bool string{max} enum RegExp
  query:  { page: { type: "int", min: 1, max: 100, default: 1 } },   // lo no declarado => 400
  queries: {                                        // consultas PREPARADAS: el filtro es una constante
    bySlug: { collection: "posts", filter: "slug = {:s} && published = true", rule: "view", sort: ["-created"] },
  },
  get(ctx) {
    const post = ctx.findOne("bySlug", { s: ctx.params.slug });   // aplica viewRule; nunca devuelve campos hidden
    if (!post) return ctx.notFound();
    return { post };                                // el objeto devuelto se renderiza con [slug].html dentro del layout
  },
};
```
```html
<!-- pages/blog/[slug]/index.html -->
{{define "title"}}{{.post.title}}{{end}}
{{define "body"}}<h1>{{.post.title}}</h1><p>{{.post.body}}</p>{{end}}
```
En la plantilla tienes `.Query` (query validada), `.Params` (params), `.User` (usuario autenticado por `Authorization`) y tus datos. El HTML se
**escapa automáticamente**; `raw`, `js` y `html` están prohibidos por el lint. Un HTML sin `{{define}}` se inserta como cuerpo del layout
(el `{{block "body" .}}` del layout debe estar vacío); con `{{define}}` puedes redefinir `title`, `body`, etc.

## API de `ctx`
| | |
|---|---|
| `ctx.params`, `ctx.query`, `ctx.body` | params de ruta, query y body **ya validados** (objetos sin prototipo) |
| `ctx.find(q, params, {sort,page,limit,where})`, `ctx.findOne(q, params)` | ejecutan una consulta declarada en `queries` (reglas de colección aplicadas) |
| `ctx.paginate(q, params, {where})` | paginación estándar con la opción `paginate` → `{items, page, perPage, hasMore}` |
| `ctx.create(m, datos)`, `ctx.update(m, id, datos)`, `ctx.delete(m, id)`, `ctx.tx(fn)` | escrituras declaradas en `mutations` (reglas de colección aplicadas) y transacciones |
| `ctx.json(o,code)`, `ctx.text(s,code)`, `ctx.redirect("/ruta",code)`, `ctx.notFound()`, `ctx.forbidden()` | respuestas (redirect solo a rutas relativas) |
| `ctx.view(nombre, datos)` | plantilla de `pb_hooks/views/` |
| `ctx.file(dirRelativo, ruta)` | sirve un archivo sin symlinks, dotfiles ni traversal |
| `ctx.user` | registro autenticado (`null` en rutas con `cache`) |
| `ctx.locale`, `ctx.t(clave, vars)` | idioma elegido y texto traducido (si existe `pb_hooks/i18n/`) |
| `ctx.mail(plantilla, {to, data})` | correo con plantilla (`pb_hooks/mails/`) |
| `ctx.can(permiso)`, `ctx.hasRole(rol)`, `ctx.membership()` | módulo opcional `access` |
| `ctx.logout()`, `ctx.logoutEverywhere()`, `ctx.sessions()`, `ctx.revokeSession(id)` | cerrar sesión (siempre) y sesiones revocables (módulo opcional `sessions`) |

Opciones de ruta: `auth`, `access`, `params`, `query`, `body` (POST/PUT/PATCH/DELETE), `queries`, `paginate`, `mutations`, `cache: {maxAge, server, tags}`,
`bodyLimit`, `unknownQuery: "ignore"`. Cualquier opción desconocida (un typo) **aborta el arranque**.

### Esquemas reutilizables
`params`, `query` y `body` aceptan el **nombre** de un archivo de `pages/_schemas/<nombre>.js` (`module.exports = { page: {type:"int", min:1, max:100, default:1} }`):
`query: "paging"`, `body: "post"`. Un nombre inexistente, un archivo que no exporta un objeto o un campo inválido abortan el arranque. `pbmini:new schema <nombre>` crea uno.

### Paginación y filtros declarados
```js
paginate: { perPage: 20, maxPerPage: 50, sort: ["-created", "title"] },   // añade query page / perPage / sort (enum) al contrato de la ruta
queries: { list: { collection: "posts", filter: "published = true", sort: ["-created", "title"], maxLimit: 100,
                   filters: { slug: "slug = {:v}", author: "author = {:v}" } } },   // fragmentos CONSTANTES con un único {:v}
get: (ctx) => ctx.json(ctx.paginate("list", {}, { where: { slug: ctx.query.slug } })),   // solo valores: se enlazan, nunca se concatenan
```
`ctx.paginate` devuelve `hasMore` calculado **solo con lo que el usuario puede ver**; no hay `total` a propósito (contarlo ignoraría las reglas de colección y
revelaría cuántos registros ocultos existen). Mantén el `filter` base igual a la `listRule` para que las páginas no queden cortas.

### Escrituras declaradas y transacciones
```js
mutations: { add: { collection: "todos", op: "create", fields: ["title", "done", "owner"] },     // lista blanca de campos (obligatoria)
             setDone: { collection: "todos", op: "update", fields: ["done"] }, rm: { collection: "todos", op: "delete" } },
post: (ctx) => ctx.json(ctx.tx((t) => { const a = t.create("add", { title: "a", done: false, owner: ctx.user.id }); t.update("setDone", a.id, { done: true }); return a; })),
```
Se aplican las reglas `createRule/updateRule/deleteRule` de la colección (la de creación con el registro guardado dentro de una transacción, como la API nativa; `update`/`delete`
contra el registro **existente**, antes de modificar nada). Solo colecciones `base` (las cuentas se gestionan con la API nativa), nunca desde un GET, nunca
campos `id/password/email/…`. `ctx.tx` revierte todo si algo falla (excepción o regla que niega); dentro solo existen `find/findOne/create/update/delete`.

### Caché de servidor con etiquetas
`cache: { maxAge: 60, server: true, tags: ["posts"] }`: al crear/actualizar/borrar un registro de `posts` (por **cualquier** vía, la API nativa incluida) se purgan esas entradas.
Una etiqueta de colección inexistente (typo) hace que la ruta **no se cachee** en el servidor (falla hacia «sin caché»). La caché del navegador (`max-age`) no se puede invalidar.

### Layouts anidados y páginas de error
- `_layout.html` en una subcarpeta **reemplaza** al anterior (clásico) o lo **extiende** si define el slot del padre: slots por profundidad `body` → `inner` → `inner2`…
  (`{{define "body"}}…{{block "inner" .}}{{end}}…{{end}}` en el hijo). Máx. 4 niveles; los datos de la página llegan a todos los niveles; las páginas con `{{define}}` pueden redefinir bloques (`title`…).
  Un HTML sin `{{define}}` rellena el slot del layout más profundo.
- `_error.html` (el más cercano manda) se usa para 400/404/414/422/500 de rutas con `.html` cuando el cliente acepta `text/html`; recibe solo `{{.Status}}` y `{{.Reason}}`
  (nunca datos de la petición ni el texto del error). El 404 de una URL inexistente usa el de la raíz. Los endpoints responden siempre JSON. Los 401/403 de `auth` los genera PocketBase.

### Internacionalización
`pb_hooks/i18n/es.json`, `en.json`… (claves planas, textos con `{variables}`; mismas claves y variables en todos los idiomas o el arranque aborta).
`ctx.t("clave", {name})`, `{{.T.clave}}` y `{{.Locale}}` en plantillas. El idioma sale **solo** de `Accept-Language` (validado y comparado con los archivos existentes); el predeterminado es
`PBMINI_DEFAULT_LOCALE` o el primero alfabético. En rutas con caché el idioma forma parte de la clave y se envía `Vary: Accept-Language`.

### Tareas programadas
`pb_hooks/cron/<id>.js` → `module.exports = { schedule: "*/5 * * * *", run(app) { … } }` (5 campos numéricos validados o `@hourly`…). Se registran como `pbmini_<id>`;
se ven y se lanzan en el panel (Ajustes → Crons) o con `POST /api/crons/pbmini_<id>`. `run` recibe `app` (no uses `$app` en el archivo: el lint lo marca).

### Correo con plantillas
`pb_hooks/mails/<nombre>.html` (cuerpo, autoescapado) + `<nombre>.subject.txt` (asunto de una línea con `{variables}`); `ctx.mail("nombre", { to, data })`.
Un solo destinatario con validación estricta, remitente siempre el de Ajustes → Correo, nunca desde un GET, y límites por destinatario/hora y globales (`mail` en `pbmini.config.js`).

### Módulos opcionales (apagados por defecto): `pb_hooks/pbmini.config.js`
Sin el archivo nada cambia. Plantilla comentada: `pbmini.config.example.js`; `./pocketbase pbmini:new config` la copia como `pbmini.config.js` (nunca sobrescribe uno existente). Los cambios requieren reiniciar (en Linux/macOS PocketBase recarga solo al editar `pb_hooks`). Claves desconocidas o inválidas abortan el arranque.
- **`access`** — roles y membresías. Solo **lee** campos que ya existen en tu colección de usuarios (no crea tablas).
  `mode: "role"` (básico: nombre del campo + lista de roles) o `mode: "membership"` (roles, permisos por rol, permisos extra por usuario, planes con jerarquía `free < pro < team`,
  vencimiento con días de gracia y estado suspendido). Rutas: `access: { role: "editor" }`, `{ permission: "posts.write" }`, `{ plan: "pro" }`, `{ any: [...] }`, `{ all: [...] }` (solo con `auth: "user"`).
  Fail-closed: campo ausente, valor desconocido o fecha inválida = sin permiso / plan base; un plan de pago sin fecha vigente cuenta como vencido (402 `membership_expired`).
  Protege **solo rutas de pbmini**: espeja las condiciones en las reglas de la colección (`@request.auth.plan = "pro"`) para la API nativa.
  **Cuenta bloqueada** (`statusField`): no obtiene token por ningún método ni al refrescar (403) y, al bloquearla, sus sesiones se vetan (con `sessions`: fuera de pbmini **y** de `/api/*`).
  **Reglas para la API nativa:** `./pocketbase pbmini:access rules` imprime las reglas de PocketBase equivalentes a tu configuración y a cada ruta con `access` (con la hora delante de cada línea: es el formato de `console.log`).
  Las formas están medidas contra PocketBase: un select múltiple se compara con `~ '"editor"'` (`?=` no funciona sobre `@request.auth`), el texto con `:lower` y listas «a,b» sin espacios, y la gracia de vencimiento solo puede ser de 1 día.
  El laboratorio comprueba que ninguna regla generada es **más permisiva** que `access`. Los nombres de roles y permisos se comparan sin distinguir mayúsculas.
- **`sessions`** — sesiones revocables con **veto global**. Al iniciar sesión (contraseña, OTP, OAuth2…) y al refrescar, el token de PocketBase se sustituye por otro idéntico (mismos claims y caducidad,
  firmado con la misma clave) que lleva un `sid`; PocketBase y su API nativa lo aceptan. Revocar = vetar un `sid`: un middleware global (también `/api/*`) responde 401 a ese token, a sus refrescos y al refresh
  (la lista vive en memoria, sin consultas por petición, y se guarda en `pbmini_sessions` —solo superusuario— para recargarla al reiniciar). Cada token propio se valida al emitirlo con `findAuthRecordByToken`;
  si PocketBase lo rechazara se entrega el estándar y se avisa en el log (el login nunca se rompe). Se guarda el `sid`, nunca el token. `ctx.sessions()`, `ctx.revokeSession(id)`, `ctx.logout()`.
  Funciona en proyectos existentes; `legacy: "allow"` respeta los tokens emitidos antes de activarlo (sin `sid`: solo `logoutEverywhere()` los mata) y `"deny"` los rechaza.
  **Realtime (SSE):** PocketBase autentica la conexión una sola vez, al suscribirse, y no la vuelve a mirar (medido: una sesión revocada seguía recibiendo eventos). Con `realtime: true` (por defecto) cada suscripción
  se etiqueta con su `sid`/caducidad y se corta al revocar la sesión, cerrar todo, bloquear o borrar al usuario o cambiar su contraseña/correo (cambio de `tokenKey`); además cada mensaje saliente se comprueba contra los vetos y la caducidad del token.
  Límites: el veto vive en un solo proceso; **apagar el módulo deja de aplicar los vetos** (los tokens revocados no vencidos vuelven a valer; usa `logoutEverywhere()` antes si necesitas cerrarlo todo);
  la firma propia usa `tokenKey + authToken.secret` (comportamiento observado de PocketBase, no documentado).
- **`telegram`** — alertas en tiempo real **sin Firebase ni SMTP**: avisos a usuarios, a grupos y a operadores; botones con acciones seguras; login por Mini App. Todo pasa por la Bot API oficial.
  Secretos solo en variables de entorno (ver `.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (≥32 caracteres), `TELEGRAM_WEBHOOK_URL` (base HTTPS pública), `TELEGRAM_OPERATOR_CHATS`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_MINIAPP_URL`.
  Faltar o venir mal formadas aborta el arranque; el token se redacta de cualquier error y nunca se guarda en la base.
  - **Vincular:** `ctx.telegramLink()` devuelve `https://t.me/<bot>?start=<token>` (un solo uso, caduca en `linkTtl`, se guarda solo su hash). Al abrirlo el bot recibe `/start <token>` por el webhook y guarda el `chat_id`. `/stop` desvincula; `/status` informa.
  - **Enviar:** `ctx.telegram("me" | idUsuario, { title?, text, buttons?, silent?, protect?, key? })`. El texto se escapa siempre (no hay HTML del usuario), no se permite desde GET ni en rutas públicas y el destino sale del registro vinculado.
    Todo envío pasa por la cola `pbmini_tg_outbox`: `key` lo hace idempotente, 429 respeta `retry_after`, 5xx/red se reintentan con espera creciente, un 403 (bot bloqueado) marca el vínculo y deja de intentar, y el contenido se borra al enviar.
  - **Grupos y operadores:** `telegram.groups: { staff: { field: "roles", values: ["admin"] } }` + `ctx.telegramGroup("staff", msg)` encola un mensaje por vinculado activo con ese valor (no a cuentas bloqueadas); el cron (`pbmini_telegram_outbox`, cada minuto) lo reparte a ≤25 mensajes/s (Telegram admite ≈30/s).
    `ctx.telegramAlert(msg)` y `telegramAlert` desde cron/hooks (`require(...).alert($app, msg)`) llegan a `TELEGRAM_OPERATOR_CHATS`.
  - **Botones:** `buttons: [[{ text, action: "aprobar", args }, { text, url: "https://..." }, { text, webApp: true }]]`. Una `action` solo puede ser un archivo de `pb_hooks/telegram/actions/<nombre>.js` (`./pocketbase pbmini:new tgaction aprobar`);
    cada pulsación lleva un nonce de un solo uso (solo su hash en la base), ligado al destinatario y con caducidad (`actionTtl`): solo el dueño puede usarlo y una vez.
  - **Mini App:** `POST /_telegram/login {initData}` valida la firma de Telegram (HMAC-SHA256 con el token del bot, `auth_date` ≤ `maxAge`, un solo uso por defecto, 20 intentos/min por IP) y devuelve el token de la cuenta vinculada (con `sessions` activo, con `sid` y revocable). `autoprovision: true` crea la cuenta si no existe.
  - Webhook: `POST /_telegram/webhook` exige el `secret_token` (comparación en tiempo constante), descarta `update_id` repetidos y solo atiende chats privados. `./pocketbase pbmini:telegram status` muestra el estado sin secretos.
  Límites: nonces, `update_id` y contadores viven en un solo proceso; el contenido de los mensajes lo ve Telegram (no hay cifrado extremo a extremo con bots); la API nativa de PocketBase no queda cubierta; no se usa la firma Ed25519 de terceros.
- **`clip`** — **pagos con links de pago de Clip** (tarjeta de crédito/débito; la tarjeta nunca pasa por tu servidor). Basado en el plugin probado `clip-payment-links` y endurecido con el estándar de `PLUGINS.md`.
  Variables (ver `.env.example`; solo en el entorno): `CLIP_API_TOKEN` (**`Basic <base64 de API_KEY:CLAVE_SECRETA>`** tal cual: Clip tiene un generador, PocketBase no trae base64), `CLIP_WEBHOOK_TOKEN` (≥32; va en la URL del webhook y por eso queda en los logs de PocketBase), `CLIP_PUBLIC_URL` o `clip.publicUrl` (https, fija: nunca se deriva de la cabecera Host), `CLIP_WEBHOOK_TOKEN_PREV` (rotación).
  El servidor debe estar en **México o EE. UU.** (si no, Clip responde 403) y alcanzable por HTTPS para el webhook (en local: `cloudflared tunnel --config <archivo vacío> --url http://127.0.0.1:PUERTO`; un `~/.cloudflared/config.yml` con `ingress` anula `--url`).
  - **Cobrar:** en una ruta con `auth: "user"` y método no GET: `ctx.clip.createPayment({ amount: 12345 /* CENTAVOS calculados en el SERVIDOR */, description, subject: { kind: "order", id }, urls: { success: "/pedido/abc", error: "/pedido/abc?pago=error", default: "/" }, idemKey })` → `{ id, reference, url, status }`; rediriges al comprador a `url`. Las `urls` son rutas relativas (nunca un destino libre); `idemKey` devuelve siempre el mismo pago.
  - **Confirmar:** el webhook de Clip (`POST /_clip/webhook?token=…`) trae solo `{ id, origin, event_type }` y **no tiene firma**: es un aviso, nunca una prueba. El único camino a `paid` es `verify`: se pregunta a Clip (`GET /v2/checkout/{id}`) y solo se confirma si coinciden **referencia firmada (HMAC con `CLIP_API_TOKEN`), monto en centavos, moneda MXN y `receipt_no` único**. Si Clip dice «completado» pero algo no cuadra el pago pasa a **`review`** (nunca `failed`: el cliente sí pagó), no se cierra ni se repite la alarma y se avisa a los operadores por `notify`. El regreso del comprador solo dispara la misma verificación: `ctx.clip.verify(id)` / `get(id)` / `list({ subjectKind, subjectId })` (solo el dueño o un superusuario; un pago ajeno es un 404).
  - **Reaccionar:** es una colección normal (`pbmini_clip_payments`): `onRecordAfterUpdateSuccess((e) => { if (e.record.getString("status") === "paid" && !e.record.getString("activated_at")) … }, "pbmini_clip_payments")`. La entrega debe ser **idempotente** (llave = id del pago); `claimActivation($app, id)` (como máximo una vez) o `markActivated` al terminar (al menos una vez). Un pago que quedó `failed`/`expired` y luego se completa en Clip se registra como `paid` tardío: tu hook decide (p. ej. reembolsar).
  - **Respaldo:** tarea `pbmini_clip_reconcile` (cada 2 min por defecto) recupera los avisos perdidos, cierra los `created` colgados y vence los muy viejos; reentrante. **Reconcilia antes** de cancelar pedidos vencidos propios: `require(`${__hooks}/lib/clip.js`).reconcile($app)`.
  - **Reembolso total** (solo superusuario; nunca desde GET): `ctx.clip.refund(id)` o `pbmini:clip refund <id> confirm`: pide primero el reembolso a Clip (`POST /refunds` con `reference.type = "receipt"`, medido con dinero real) y solo si lo aprueba pasa a `refunded`; no se reembolsa dos veces. Dentro de las primeras 24 h Clip lo trata como **cancelación** (conserva recibo y transacción). Un reembolso hecho en el panel se registra con `pbmini:clip refunded <id> confirm`. Después de reembolsar, el `GET` del checkout sigue diciendo `CHECKOUT_COMPLETED`: pbmini nunca reconsulta un pago `paid`.
  - **Datos:** nunca guarda datos de tarjeta; `description` y `subject` los controlas tú (sin datos personales). Al borrar un usuario sus pagos se anonimizan (se conservan los campos contables). Retención por fecha de cierre (`retention`); los `paid`/`refunded` solo se purgan si `paidDays > 0`. Con `readRules: true` el dueño lee sus pagos por la API nativa y por realtime (campos internos ocultos).
  - **CLI:** `./pocketbase pbmini:clip status | show <id|ref> | reconcile | purge [dry] | check [pesos] [wait] | review <id> paid|failed [recibo] confirm | refund <id> confirm | refunded <id> confirm` (las operaciones que mueven dinero o datos exigen `confirm`; `check` crea un link real de prueba y muestra 5 comprobaciones).
  Límites: un solo proceso (contadores en memoria); Clip ve monto, descripción y referencia; sin MSI/efectivo/reembolsos parciales (la documentación de Clip los contradice); el vencimiento por ventana (`windowHours`) no se puede probar en el laboratorio (`created` no es editable).
- Siempre disponibles (sin módulo): `ctx.logout()` (expira la cookie `pb_auth`) y `ctx.logoutEverywhere()` (cambia la `tokenKey` del usuario, invalida todos sus tokens), solo por POST y con CSRF.

### Lo que NO añadimos (ya lo hace PocketBase)
Verificación de correo, restablecer contraseña, cambio de correo, OTP/MFA y OAuth2 son endpoints y opciones nativas de la colección (`request-password-reset`, `auth-with-otp`, MFA, …):
configúralos en el panel y llámalos con el SDK/formularios. Reimplementarlos duplicaría superficie de ataque (enumeración de usuarios, límites).

### Generador y tipos
```
./pocketbase pbmini:new page blog/[slug]               # crea pages/blog/[slug]/index.js + index.html (auth: "user" por defecto)
./pocketbase pbmini:new endpoint users/[id]/update post
./pocketbase pbmini:new schema paging
./pocketbase pbmini:new config                          # crea pb_hooks/pbmini.config.js desde pbmini.config.example.js (todo apagado; no sobrescribe)
./pocketbase pbmini:routes                              # tabla de rutas en JSON (la usa el fuzzer guiado del laboratorio)
```
Nunca sobrescribe, no sale de `pages/` y aplica las mismas reglas de nombres que el cargador. `types/pbmini.d.ts` + `jsconfig.json` dan autocompletado y `checkJs`
(`/** @type {import("../types/pbmini").Route} */`); una prueba de deriva del laboratorio falla si el código y los tipos se separan.

## Reglas de oro
1. En `pages/` **solo** la API `c`. `$app`, `$os`, `$http`, `e.*`, `require` los bloquea `security/lint.sh` (CI).
2. Nunca construyas filtros con texto del usuario: declara la consulta y pasa parámetros.
3. Login, registro, escritura y límite de peticiones los hace PocketBase (SDK/API/ajustes). Mira la tabla de abajo antes de añadir nada.
4. Prueba: `examples/pbmini/security/run-mini.sh /ruta/a/pocketbase` (suite bash) y `python examples/pbmini/lab/lab.py` (laboratorio en vivo, ~1000 pruebas con objetivo y meta).

## Qué hace PocketBase y qué añade pbmini (no reinventamos la rueda)
| Tema | Lo hace PocketBase (nativo) | pbmini |
|---|---|---|
| Login, registro, OAuth, OTP | API/SDK (`authWithPassword`…) | **nada** |
| Sesión | token JWT sin estado; cambiar la contraseña lo revoca | lee la cookie `pb_auth` del SDK y **PocketBase valida el token** (`findAuthRecordByToken`); `record` de la cookie se ignora |
| Escrituras (crear/editar/borrar) | API REST + `createRule`/`updateRule` + validación de campos | `mutations` declaradas con lista blanca de campos: aplican **las mismas reglas**; el SDK/API siguen valiendo |
| Reglas de acceso | `listRule`/`viewRule`… en la API REST | en consultas del servidor aplica **la misma regla** con `canAccessRecord` (patrón de la doc) |
| Límite de peticiones | limitador nativo (Settings > Rate limiting); **sí aplica a rutas de hooks** (verificado) | **nada**; la migración `1700000100_rate_limits.js` lo activa; avisa al arrancar si está apagado |
| Auth por ruta | `$apis.requireAuth()`/`requireSuperuserAuth()`, `bodyLimit` | los usa como middleware; obliga a declarar `auth` |
| Plantillas | `$template` (autoescape) | páginas por archivos, layout y parciales encima de `$template` |
| Filtros/orden seguros | la API REST bloquea `@collection`, campos ocultos… | `$app.*` en hooks **no** tiene esas protecciones: por eso las consultas son constantes + parámetros |
| Cache-Control, CSP, parser de query estricto, archivos sin symlinks | no existe (verificado) | sí |

## Sesión desde el navegador (cookie del SDK)
```js
// En tu JS de pb_public/ (lo carga el layout con <script src="/auth.js"> por el CSP)
await pb.collection("users").authWithPassword(email, pass);
document.cookie = pb.authStore.exportToCookie({ httpOnly: false, sameSite: "Strict", secure: true });   // cookie `pb_auth`
```
Las páginas con `auth: "user"` y `ctx.user` ya funcionan por cookie. Con cookie, los métodos que cambian estado (POST/PUT/PATCH/DELETE) solo
se aceptan si `Sec-Fetch-Site` es `same-origin|none` **y** `Origin` (o `Referer`) coincide con el `Host` (anti‑CSRF; tras un proxy reenvía el `Host` original). Un `Content-Type: application/json` o `X-Requested-With` basta cuando el navegador no envía ninguna de esas cabeceras. Cualquier ruta con un segmento que empiece por `.` (p. ej. `/.env`) responde 404, incluso en `pb_public`. La API nativa `/api/*` **no** lee la cookie.
Una cookie escrita desde JS no puede ser `HttpOnly` (igual que `localStorage`): el CSP estricto es la mitigación (recomendada por la doc del SDK).

## Límites actuales
- HTML enriquecido guardado en la base se muestra escapado (seguro). Para mostrarlo hace falta un sanitizador decidido a propósito (o usar texto/markdown).
- Los hooks de PocketBase (`pb_hooks`) tienen acceso total al sistema: revisa dependencias y monta la carpeta en solo lectura.

## Directorio público (`pb_public`)
PocketBase sirve `pb_public` tal cual. pbmini añade un guardia global y una auditoría al arrancar:
- **Guardia** (cada petición): 404 a dotfiles y directorios ocultos (salvo `/.well-known/`), respaldos/claves/BD/logs/configuración (`.bak .sql .pem .key .log .db .ini .conf .env`, `~`, `id_rsa`, `Dockerfile`, `package.json`...),
  nombres cortos 8.3 (`ENV~1`), dispositivos de Windows (`CON`, `NUL`...), caracteres `: * ? " < > |`, `%` y `\`, y nombres con Unicode «de compatibilidad» (NFKC), bidi o invisibles. También aplica a `ctx.file`.
- **Auditoría de arranque**: `PBMINI_PUBLIC_AUDIT=strict` (por defecto) **aborta** si hay symlinks, archivos especiales (FIFO), ocultos o sensibles; `warn` solo avisa y bloquea en ejecución; `off` la desactiva.
  El directorio sale de `--publicDir`, de `PBMINI_PUBLIC_DIR` o de `../pb_public`. Los comandos de la CLI de PocketBase (`superuser upsert`, `migrate`) también la ejecutan.
- Despliegue: monta `pb_public` y `pb_hooks` de solo lectura; el guardia no puede ver un symlink creado después del arranque.
