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
    _layout.html              layout de todo el sitio ({{block "body" .}}); un _layout.html en una subcarpeta lo reemplaza ahí
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

## API de `c`
| | |
|---|---|
| `ctx.params`, `ctx.query`, `ctx.body` | params de ruta, query y body **ya validados** (objetos sin prototipo) |
| `ctx.find(q, params, {sort,page,limit})`, `ctx.findOne(q, params)` | ejecutan una consulta declarada en `queries` (reglas de colección aplicadas) |
| `ctx.json(o,code)`, `ctx.text(s,code)`, `ctx.redirect("/ruta",code)`, `ctx.notFound()`, `ctx.forbidden()` | respuestas (redirect solo a rutas relativas) |
| `ctx.view(nombre, datos)` | plantilla de `pb_hooks/views/` |
| `ctx.file(dirRelativo, ruta)` | sirve un archivo sin symlinks, dotfiles ni traversal |
| `ctx.user` | registro autenticado (`null` en rutas con `cache`) |

Opciones de ruta: `auth`, `params`, `query`, `body` (POST/PUT/PATCH/DELETE), `queries`, `cache: {maxAge, server}`,
`bodyLimit`, `unknownQuery: "ignore"`. Cualquier opción desconocida (un typo) **aborta el arranque**.

## Reglas de oro
1. En `pages/` **solo** la API `c`. `$app`, `$os`, `$http`, `e.*`, `require` los bloquea `security/lint.sh` (CI).
2. Nunca construyas filtros con texto del usuario: declara la consulta y pasa parámetros.
3. Login, registro, escritura y límite de peticiones los hace PocketBase (SDK/API/ajustes). Mira la tabla de abajo antes de añadir nada.
4. Prueba: `examples/pbmini/security/run-mini.sh /ruta/a/pocketbase` (suite bash) y `python examples/pbmini/lab/lab.py` (laboratorio en vivo, ~290 ataques con objetivo y meta).

## Qué hace PocketBase y qué añade pbmini (no reinventamos la rueda)
| Tema | Lo hace PocketBase (nativo) | pbmini |
|---|---|---|
| Login, registro, OAuth, OTP | API/SDK (`authWithPassword`…) | **nada** |
| Sesión | token JWT sin estado; cambiar la contraseña lo revoca | lee la cookie `pb_auth` del SDK y **PocketBase valida el token** (`findAuthRecordByToken`); `record` de la cookie se ignora |
| Escrituras (crear/editar/borrar) | API REST + `createRule`/`updateRule` + validación de campos | **nada**: usa el SDK desde el navegador o la API |
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
se aceptan si `Sec-Fetch-Site` es `same-origin|none` **y** `Origin` (o `Referer`) coincide con el `Host` (anti‑CSRF; tras un proxy reenvía el `Host` original). Cualquier ruta con un segmento que empiece por `.` (p. ej. `/.env`) responde 404, incluso en `pb_public`. La API nativa `/api/*` **no** lee la cookie.
Una cookie escrita desde JS no puede ser `HttpOnly` (igual que `localStorage`): el CSP estricto es la mitigación (recomendada por la doc del SDK).

## Límites actuales
- HTML enriquecido guardado en la base se muestra escapado (seguro). Para mostrarlo hace falta un sanitizador decidido a propósito (o usar texto/markdown).
- Los hooks de PocketBase (`pb_hooks`) tienen acceso total al sistema: revisa dependencias y monta la carpeta en solo lectura.
