// Páginas por archivos (estilo PHP): pages/blog/[slug].js + [slug].html => GET /blog/{slug}
//   index.js|html => /dir/{$}   [x] => {x}   [...x] => {x...} (último segmento)   _layout.html / _partials/ / _* / .* se ignoran
// Un .html sin .js es una página estática pública. Un .js exporta {auth, params, query, body, queries, cache, rateLimit, bodyLimit, unknownQuery, get, post, put, patch, delete}.
module.exports = function (app) {
  const root = `${__hooks}/pages`;
  const fail = (m) => { throw new Error("pbmini pages: " + m); };
  const METHODS = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" };
  const ROUTE_KEYS = ["auth", "params", "query", "queries", "cache", "bodyLimit", "unknownQuery"];
  const MOD_KEYS = ROUTE_KEYS.concat(["body", "get", "post", "put", "patch", "delete"]);
  const list = (dir) => $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1));

  function segment(name, last, where) {
    let m;
    if ((m = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]{0,31})\]$/.exec(name))) { if (!last) fail(`${where}: [...x] solo puede ser el archivo final`); return "{" + m[1] + "...}"; }
    if ((m = /^\[([A-Za-z_][A-Za-z0-9_]{0,31})\]$/.exec(name))) return "{" + m[1] + "}";
    if (/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(name) && name.indexOf("..") < 0) return name;
    return fail(`${where}: nombre no permitido "${name}" (minúsculas, dígitos, _ . -  o [param])`);
  }
  function partials() {
    const dir = root + "/_partials";
    if (!exists(dir)) return [];
    return list(dir).filter((e) => e.name.charAt(0) !== ".").map((e) => {
      if (e.dir || e.type !== 0 || !/^[A-Za-z0-9_-]+\.html$/.test(e.name)) fail(`_partials/${e.name}: solo archivos .html regulares`);
      return dir + "/" + e.name;
    });
  }
  const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
  const parts = partials();

  function walk(dir, segs, layout) {
    const entries = list(dir);
    if (entries.some((e) => e.name === "_layout.html" && !e.dir && e.type === 0)) layout = dir + "/_layout.html";
    const files = {};
    for (const e of entries) {
      if (e.name.charAt(0) === "." || e.name.charAt(0) === "_") continue; // ocultos/privados: nunca son rutas
      const where = (dir + "/" + e.name).slice(root.length + 1);
      if (e.dir) { walk(dir + "/" + e.name, segs.concat(segment(e.name, false, where)), layout); continue; }
      if (e.type !== 0) fail(`${where}: enlaces simbólicos y archivos especiales no permitidos`);
      const dot = e.name.lastIndexOf("."), ext = e.name.slice(dot + 1), base = e.name.slice(0, dot);
      if ((ext !== "js" && ext !== "html") || dot < 1) fail(`${where}: solo se admiten .js y .html (renombra o mueve el archivo)`);
      (files[base] = files[base] || {})[ext] = dir + "/" + e.name;
    }
    for (const base in files) {
      const f = files[base], where = (dir + "/" + base).slice(root.length + 1);
      const pattern = "/" + (base === "index" ? segs.concat("{$}") : segs.concat(segment(base, true, where))).join("/");
      let mod;
      if (f.js) {
        mod = require(f.js);
        if (!mod || typeof mod !== "object") fail(`${where}.js debe exportar un objeto`);
        for (const k in mod) if (MOD_KEYS.indexOf(k) < 0) fail(`${where}.js: clave desconocida "${k}"`);
      } else mod = { auth: "public", get: (c) => c.page({}) }; // .html puro: página estática pública, sin datos
      const methods = Object.keys(METHODS).filter((m) => typeof mod[m] === "function");
      if (methods.length === 0) fail(`${where}: define al menos un método (${Object.keys(METHODS).join(", ")})`);
      for (const m of Object.keys(mod)) if (METHODS[m] && typeof mod[m] !== "function") fail(`${where}.js: "${m}" debe ser función`);
      const opts = {}; ROUTE_KEYS.forEach((k) => { if (mod[k] !== undefined) opts[k] = mod[k]; });
      methods.forEach((m) => {
        const o = Object.assign({}, opts);
        if (m !== "get" && mod.body) o.body = mod.body;
        if (m !== "get") delete o.cache; // la caché solo aplica a GET
        const handler = f.js ? (c) => { const out = require(f.js)[m](c); return out && typeof out === "object" ? c.page(out) : out; } : mod.get;
        app.route(METHODS[m], pattern, o, handler, { page: { html: f.html || null, layout, partials: parts } });
      });
    }
  }
  walk(root, [], null);
};
