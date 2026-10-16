// pbmini: microframework de rutas sobre routerAdd. CommonJS (goja).
const table = []; // {method, pattern, handler}
const compile = (p) => p; // patrones nativos Go: {id} {rest...} {$}

function ctx(e) {
  const c = {
    e,
    params: new Proxy({}, { get: (_, k) => e.request.pathValue(String(k)) }),
    query: (k) => e.request.url.query().get(k),
    auth: e.auth,
    html: (s, code) => e.html(code || 200, s),
    json: (o, code) => e.json(code || 200, o),
    text: (s, code) => e.string(code || 200, s),
    redirect: (u, code) => e.redirect(code || 302, u),
    view(name, data, layout) {
      const files = [`${__hooks}/views/${layout || "layout"}.html`, `${__hooks}/views/${name}.html`];
      return e.html(200, $template.loadFiles(...files).render(data || {}));
    },
  };
  return c;
}

// Dispatch único: la tabla vive en el módulo (registro de módulos compartido).
let loaded = false, registering = false;
function load() { // cada runtime del pool carga routes.js una vez
  if (loaded) return; loaded = true;
  require(`${__hooks}/routes.js`)(module.exports);
}
function register() { registering = true; load(); registering = false; }

function dispatch(e) {
  load();
  const pat = e.request.pattern; // patrón que ganó en ServeMux
  const r = table.find((r) => (r.method + " " + r.pattern) === pat || r.pattern === pat);
  if (!r) return e.json(500, { error: "no handler for " + pat });
  return r.handler(ctx(e));
}

function route(method, pattern, handler) {
  table.push({ method, pattern, handler });
  // el handler pasado a routerAdd se serializa: sólo puede usar require()
  if (registering) routerAdd(method, pattern, (e) => require(`${__hooks}/lib/mini.js`).dispatch(e));
}

module.exports = {
  dispatch, register, route,
  get: (p, h) => route("GET", p, h),
  post: (p, h) => route("POST", p, h),
};
