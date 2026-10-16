// Páginas y endpoints por archivos. Un archivo = una ruta; TODO parámetro es una carpeta [param]/ (nunca un archivo plano).
//   pages/users/index.js              => /users
//   pages/users/[id]/index.js         => /users/{id}            (index = la ruta del directorio, sin barra final; raíz = /{$})
//   pages/users/[id]/update.js        => /users/{id}/update     (un método por función: get/post/put/patch/delete)
//   pages/files/[...path]/index.js    => /files/{path...}       ([...x] es carpeta y solo admite index.*)
// Un .js con .html renderiza la página (objeto devuelto => plantilla). Un .js SIN .html es un endpoint (equivalente a +server.js):
// el objeto devuelto se responde como JSON, o usa ctx.json/ctx.text/ctx.redirect. Un .html sin .js es una página estática pública.
// Archivos/carpetas que empiezan con _ o . nunca son rutas. _layout.html y _partials/ definen layout y parciales.
// Cada .js exporta {auth, params, query, body, queries, cache, bodyLimit, unknownQuery, get, post, put, patch, delete}.
module.exports = function (app) {
  const root = `${__hooks}/pages`;
  const fail = (m) => { throw new Error("pbmini pages: " + m); };
  const METHODS = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" };
  const ROUTE_KEYS = ["auth", "params", "query", "queries", "cache", "bodyLimit", "unknownQuery"];
  const MOD_KEYS = ROUTE_KEYS.concat(["body", "get", "post", "put", "patch", "delete"]);
  const list = (dir) => $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const PLAIN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

  // Carpeta => segmento del patrón: nombre plano, {param} o {param...}
  function dirSegment(name, where) {
    let m;
    if ((m = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]{0,31})\]$/.exec(name))) return { seg: "{" + m[1] + "...}", wild: true };
    if ((m = /^\[([A-Za-z_][A-Za-z0-9_]{0,31})\]$/.exec(name))) return { seg: "{" + m[1] + "}", wild: false };
    if (PLAIN.test(name) && name.indexOf("..") < 0) return { seg: name, wild: false };
    return fail(`${where}: nombre de carpeta no permitido "${name}" (minúsculas, dígitos, _ . -  o [param])`);
  }
  // Archivo (distinto de index) => segmento plano. Un [param] plano está prohibido: los parámetros son carpetas.
  function fileSegment(base, where) {
    if (/^\[.*\]$/.test(base)) fail(`${where}: un parámetro debe ser una carpeta (usa ${base}/index.js)`);
    if (PLAIN.test(base) && base.indexOf("..") < 0) return base;
    return fail(`${where}: nombre de archivo no permitido "${base}" (minúsculas, dígitos, _ . -)`);
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

  function walk(dir, segs, layout, wild) {
    const entries = list(dir);
    if (entries.some((e) => e.name === "_layout.html" && !e.dir && e.type === 0)) layout = dir + "/_layout.html";
    const files = {};
    for (const e of entries) {
      if (e.name.charAt(0) === "." || e.name.charAt(0) === "_") continue; // ocultos/privados: nunca son rutas
      const where = (dir + "/" + e.name).slice(root.length + 1);
      if (e.dir) {
        if (wild) fail(`${where}: dentro de una carpeta [...comodín] solo puede haber index.js|html`);
        const s = dirSegment(e.name, where);
        walk(dir + "/" + e.name, segs.concat(s.seg), layout, s.wild);
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
      const opts = {}; ROUTE_KEYS.forEach((k) => { if (mod[k] !== undefined) opts[k] = mod[k]; });
      const hasHtml = !!f.html;
      methods.forEach((m) => {
        const o = Object.assign({}, opts);
        if (m !== "get" && mod.body) o.body = mod.body;
        if (m !== "get") delete o.cache; // la caché solo aplica a GET
        // con .html el objeto se renderiza; sin .html (endpoint) se responde como JSON
        const handler = f.js ? (ctx) => { const out = require(f.js)[m](ctx); return out && typeof out === "object" ? (hasHtml ? ctx.page(out) : ctx.json(out)) : out; } : mod.get;
        app.route(METHODS[m], pattern, o, handler, { page: { html: f.html || null, layout, partials: parts } });
      });
    }
  }
  walk(root, [], null, false);
};
