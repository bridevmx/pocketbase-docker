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

## Estructura (el archivo ES la ruta)
```
pb_hooks/
  pages/
    _layout.html            layout de todo el sitio ({{block "body" .}}); un _layout.html en una subcarpeta lo reemplaza ahí
    _partials/nav.html      parciales ({{define "nav"}}…{{end}}) disponibles en todas las páginas (≈ include de PHP)
    index.js + index.html   →  GET /
    about.html              →  GET /about        (solo .html = página estática pública)
    blog/index.js|html      →  GET /blog/
    blog/[slug].js|html     →  GET /blog/{slug}  (param de ruta)
    docs/[...path].js       →  GET /docs/a/b/c   (comodín final)
    contacto.js             →  GET + POST /contacto  (un método por función)
  routes.js                 endpoints JSON opcionales (app.get/post…)
pb_public/                  CSS/JS/imágenes estáticos (el CSP es estricto: nada de <style>/<script> inline)
pb_migrations/              colecciones como código
```
Los archivos que empiezan con `_` o `.` nunca son rutas. Un nombre inválido o un archivo que no sea `.js`/`.html` **aborta el arranque** (no se ignora).

## Una página
```js
// pages/blog/[slug].js
module.exports = {
  auth: "public",                                   // OBLIGATORIO: "public" | "user" | "superuser"
  params: { slug: "slug" },                         // tipos: id slug uuid int bool string{max} enum RegExp
  query:  { page: { type: "int", min: 1, max: 100, default: 1 } },   // lo no declarado => 400
  queries: {                                        // consultas PREPARADAS: el filtro es una constante
    bySlug: { collection: "posts", filter: "slug = {:s} && published = true", rule: "view", sort: ["-created"] },
  },
  get(c) {
    const post = c.findOne("bySlug", { s: c.params.slug });   // aplica viewRule; nunca devuelve campos hidden
    if (!post) return c.notFound();
    return { post };                                // el objeto devuelto se renderiza con [slug].html dentro del layout
  },
};
```
```html
<!-- pages/blog/[slug].html -->
{{define "title"}}{{.post.title}}{{end}}
{{define "body"}}<h1>{{.post.title}}</h1><p>{{.post.body}}</p>{{end}}
```
En la plantilla tienes `.Q` (query validada), `.P` (params), `.User` (usuario autenticado por `Authorization`) y tus datos. El HTML se
**escapa automáticamente**; `raw`, `js` y `html` están prohibidos por el lint. Un HTML sin `{{define}}` se inserta como cuerpo del layout
(el `{{block "body" .}}` del layout debe estar vacío); con `{{define}}` puedes redefinir `title`, `body`, etc.

## API de `c`
| | |
|---|---|
| `c.params`, `c.q`, `c.b` | params de ruta, query y body **ya validados** (objetos sin prototipo) |
| `c.find(q, params, {sort,page,limit})`, `c.findOne(q, params)` | ejecutan una consulta declarada en `queries` (reglas de colección aplicadas) |
| `c.json(o,code)`, `c.text(s,code)`, `c.redirect("/ruta",code)`, `c.notFound()`, `c.forbidden()` | respuestas (redirect solo a rutas relativas) |
| `c.view(nombre, datos)` | plantilla de `pb_hooks/views/` (para `routes.js`) |
| `c.file(dirRelativo, ruta)` | sirve un archivo sin symlinks, dotfiles ni traversal |
| `c.auth` | registro autenticado (`null` en rutas con `cache`) |

Opciones de ruta: `auth`, `params`, `query`, `body` (POST/PUT/PATCH/DELETE), `queries`, `cache: {maxAge, server}`, `rateLimit: {max, windowSec}|false`,
`bodyLimit`, `unknownQuery: "ignore"`. Cualquier opción desconocida (un typo) **aborta el arranque**.

## Reglas de oro
1. En `pages/` y `routes.js` **solo** la API `c`. `$app`, `$os`, `$http`, `e.*`, `require` los bloquea `security/lint.sh` (CI).
2. Nunca construyas filtros con texto del usuario: declara la consulta y pasa parámetros.
3. Autenticación y registro de usuarios: usa lo de PocketBase (API/SDK). pbmini lee `Authorization`; no implementa sesiones propias.
4. Prueba: `examples/pbmini/security/run-mini.sh /ruta/a/pocketbase` (278 comprobaciones).

## Límites actuales
- Aún no hay escritura declarativa (crear/editar registros desde un `post`); se hará con la misma idea (esquema + reglas `createRule`/`updateRule`).
- HTML enriquecido guardado en la base se muestra escapado (seguro). Para mostrarlo hace falta un sanitizador decidido a propósito (o usar texto/markdown).
- Páginas `auth: "user"` requieren enviar `Authorization` (fetch/SDK); el login por cookie para navegación clásica no está implementado.
