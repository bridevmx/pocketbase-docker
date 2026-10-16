// Páginas y endpoints por archivos. Un archivo = una ruta; TODO parámetro es una carpeta [param]/ (nunca un archivo plano).
//   pages/users/index.js              => /users
//   pages/users/[id]/index.js         => /users/{id}            (index = la ruta del directorio, sin barra final; raíz = /{$})
//   pages/users/[id]/update.js        => /users/{id}/update     (un método por función: get/post/put/patch/delete)
//   pages/files/[...path]/index.js    => /files/{path...}       ([...x] es carpeta y solo admite index.*)
// Un .js con .html renderiza la página (objeto devuelto => plantilla). Un .js SIN .html es un endpoint (equivalente a +server.js):
// el objeto devuelto se responde como JSON, o usa ctx.json/ctx.text/ctx.redirect. Un .html sin .js es una página estática pública.
// Archivos/carpetas que empiezan con _ o . nunca son rutas. _layout.html y _partials/ definen layout y parciales.
// Cada .js exporta {auth, access, params, query, body, queries, cache, paginate, mutations, bodyLimit, unknownQuery, get, post, put, patch, delete}.
// params/query/body pueden ser el nombre de un archivo de pages/_schemas/ (esquema reutilizable).
module.exports = function (app) {
  const root = `${__hooks}/pages`;
  const fail = (m) => { throw new Error("pbmini pages: " + m); };
  const METHODS = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" };
  const ROUTE_KEYS = ["auth", "params", "query", "queries", "cache", "bodyLimit", "unknownQuery", "paginate", "mutations", "access"];
  const MOD_KEYS = ROUTE_KEYS.concat(["body", "get", "post", "put", "patch", "delete"]);
  const list = (dir) => $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const names = require(`${__hooks}/lib/names.js`); // reglas de nombres compartidas con el generador pbmini:new

  // Carpeta => segmento del patrón: nombre plano, {param} o {param...}
  function dirSegment(name, where) {
    return names.dirSegment(name) || fail(`${where}: nombre de carpeta no permitido "${name}" (minúsculas, dígitos, _ . -  o [param])`);
  }
  // Archivo (distinto de index) => segmento plano. Un [param] plano está prohibido: los parámetros son carpetas.
  function fileSegment(base, where) {
    if (/^\[.*\]$/.test(base)) fail(`${where}: un parámetro debe ser una carpeta (usa ${base}/index.js)`);
    return names.fileSegment(base) || fail(`${where}: nombre de archivo no permitido "${base}" (minúsculas, dígitos, _ . -)`);
  }
  const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
  function partials() {
    const dir = root + "/_partials";
    if (!exists(dir)) return [];
    return list(dir).filter((e) => e.name.charAt(0) !== ".").map((e) => {
      if (e.dir || e.type !== 0 || !/^[A-Za-z0-9_-]+\.html$/.test(e.name)) fail(`_partials/${e.name}: solo archivos .html regulares`);
      return dir + "/" + e.name;
    });
  }
  const parts = partials();

  // Esquemas reutilizables: `body: "post"` / `query: "paging"` / `params: "..."` cargan pages/_schemas/<nombre>.js (objeto de campos).
  // Mismo formato que un esquema en línea; un nombre inexistente, una carpeta/archivo raro o un campo repetido aborta el arranque.
  const SCHEMA_KEYS = ["params", "query", "body"], schemaCache = {};
  function schemaDir() {
    const dir = root + "/_schemas";
    if (!exists(dir)) return {};
    const names = {};
    list(dir).forEach((e) => {
      if (e.name.charAt(0) === ".") return;
      if (e.dir || e.type !== 0 || !/^[a-z0-9][a-z0-9_-]{0,63}\.js$/.test(e.name)) fail(`_schemas/${e.name}: solo archivos .js regulares con nombre en minúsculas, dígitos, _ y -`);
      names[e.name.slice(0, -3)] = dir + "/" + e.name;
    });
    return names;
  }
  const schemaFiles = schemaDir();
  function resolveSchema(name, where, key) {
    if (!Object.prototype.hasOwnProperty.call(schemaFiles, name)) fail(`${where}: ${key} usa el esquema "${name}" que no existe en pages/_schemas/`);
    if (!schemaCache[name]) {
      const s = require(schemaFiles[name]);
      if (!s || typeof s !== "object" || Array.isArray(s)) fail(`_schemas/${name}.js debe exportar un objeto de campos`);
      schemaCache[name] = s;
    }
    return schemaCache[name];
  }

  // Layouts: cada carpeta puede tener un _layout.html. Si DEFINE el slot del layout padre ({{define "body"}}...) lo EXTIENDE (queda dentro del padre)
  // y debe declarar su propio slot ({{block "inner" .}}{{end}}); si no, REEMPLAZA a los anteriores (comportamiento clásico).
  // Slots por profundidad: body, inner, inner2, inner3...  La página rellena el slot del layout más profundo.
  const slotName = (i) => (i === 0 ? "body" : i === 1 ? "inner" : "inner" + i);
  const reSlot = (kind, name) => new RegExp("\\{\\{-?\\s*" + kind + "\\s+\"" + name + "\"[\\s}-]");
  function nestLayouts(dir, layouts) {
    const file = dir + "/_layout.html", rel = file.slice(root.length + 1), txt = toString($os.readFile(file));
    if (layouts.length === 0 || !reSlot("define", slotName(layouts.length - 1)).test(txt)) return [file];
    if (layouts.length >= 4) fail(`${rel}: máximo 4 niveles de layouts anidados`);
    const own = slotName(layouts.length);
    if (!reSlot("block", own).test(txt)) fail(`${rel}: extiende al layout padre; debe contener {{block "${own}" .}}{{end}} para el contenido de la página`);
    return layouts.concat(file);
  }
  function walk(dir, segs, layouts, wild, errPage) {
    const entries = list(dir);
    if (entries.some((e) => e.name === "_layout.html" && !e.dir && e.type === 0)) layouts = nestLayouts(dir, layouts);
    if (entries.some((e) => e.name === "_error.html" && !e.dir && e.type === 0)) errPage = dir + "/_error.html"; // el más cercano manda
    const files = {};
    for (const e of entries) {
      if (e.name.charAt(0) === "." || e.name.charAt(0) === "_") continue; // ocultos/privados: nunca son rutas
      const where = (dir + "/" + e.name).slice(root.length + 1);
      if (e.dir) {
        if (wild) fail(`${where}: dentro de una carpeta [...comodín] solo puede haber index.js|html`);
        const s = dirSegment(e.name, where);
        walk(dir + "/" + e.name, segs.concat(s.seg), layouts, s.wild, errPage);
        continue;
      }
      if (e.type !== 0) fail(`${where}: enlaces simbólicos y archivos especiales no permitidos`);
      const dot = e.name.lastIndexOf("."), ext = e.name.slice(dot + 1), base = e.name.slice(0, dot);
      if ((ext !== "js" && ext !== "html") || dot < 1) fail(`${where}: solo se admiten .js y .html (renombra o mueve el archivo)`);
      if (wild && base !== "index") fail(`${where}: dentro de una carpeta [...comodín] solo puede haber index.js|html`);
      (files[base] = files[base] || {})[ext] = dir + "/" + e.name;
    }
    for (const base in files) {
      const f = files[base], where = (dir + "/" + base).slice(root.length + 1);
      const pattern = base === "index" ? (segs.length ? "/" + segs.join("/") : "/{$}") : "/" + segs.concat(fileSegment(base, where)).join("/");
      let mod;
      if (f.js) {
        mod = require(f.js);
        if (!mod || typeof mod !== "object") fail(`${where}.js debe exportar un objeto`);
        for (const k in mod) if (MOD_KEYS.indexOf(k) < 0) fail(`${where}.js: clave desconocida "${k}"`);
      } else mod = { auth: "public", get: (ctx) => ctx.page({}) }; // .html puro: página estática pública, sin datos
      const methods = Object.keys(METHODS).filter((m) => typeof mod[m] === "function");
      if (methods.length === 0) fail(`${where}: define al menos un método (${Object.keys(METHODS).join(", ")})`);
      for (const m of Object.keys(mod)) if (METHODS[m] && typeof mod[m] !== "function") fail(`${where}.js: "${m}" debe ser función`);
      if (mod.body && methods.every((m) => m === "get")) fail(`${where}: "body" declarado pero la página solo tiene get (se ignoraría: agrega post/put/patch/delete o quítalo)`);
      if (mod.mutations && methods.every((m) => m === "get")) fail(`${where}: "mutations" declarado pero la página solo tiene get (las escrituras no se permiten en GET)`);
      if (mod.paginate && !methods.includes("get")) fail(`${where}: "paginate" solo aplica a get`);
      const opts = {}; ROUTE_KEYS.forEach((k) => { if (mod[k] !== undefined) opts[k] = mod[k]; });
      SCHEMA_KEYS.forEach((k) => { if (typeof opts[k] === "string") opts[k] = resolveSchema(opts[k], where, k); });
      if (typeof mod.body === "string") mod.body = resolveSchema(mod.body, where, "body");
      const hasHtml = !!f.html;
      methods.forEach((m) => {
        const o = Object.assign({}, opts);
        if (m !== "get" && mod.body) o.body = mod.body;
        if (m !== "get") { delete o.cache; delete o.paginate; } // la caché y la paginación solo aplican a GET
        else delete o.mutations;                                  // las escrituras nunca cuelgan de un GET (CSRF)
        // con .html el objeto se renderiza; sin .html (endpoint) se responde como JSON
        const handler = f.js ? (ctx) => { const out = require(f.js)[m](ctx); return out && typeof out === "object" ? (hasHtml ? ctx.page(out) : ctx.json(out)) : out; } : mod.get;
        app.route(METHODS[m], pattern, o, handler, { page: { html: f.html || null, layout: layouts.length ? layouts[layouts.length - 1] : null, layouts, slot: slotName(Math.max(layouts.length - 1, 0)), error: errPage, partials: parts } });
      });
    }
  }
  walk(root, [], [], false, null);
  if (exists(root + "/_error.html")) app.setRootError({ error: root + "/_error.html", partials: parts }); // 404 nativo con HTML
};
