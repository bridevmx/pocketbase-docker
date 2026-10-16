// pbmini: microframework de rutas sobre routerAdd (goja/CommonJS). Seguro por defecto.
// Ver SECURITY.md. Cada ruta DEBE declarar `auth`; todo input se valida antes del handler.
const AUTH = { public: 1, user: 1, superuser: 1 };
const SYSTEM_PREFIX = /^\/(api|_)(\/|$)/;
const METHODS = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };
const DEFAULTS = { bodyLimit: 1 << 20, rateLimit: { max: 120, windowSec: 60 } };
const table = {}; // "METHOD /patron" -> {opts, handler}

// ---- validación de entrada ------------------------------------------------
// Un segmento es seguro si no contiene separadores, NUL/control, % residual ni es "." / "..".
const SEG_BAD = /[\x00-\x1f\x7f\\\/%]/;
function safeSegment(s) { return typeof s === "string" && s.length > 0 && s.length <= 255 && s !== "." && s !== ".." && !SEG_BAD.test(s); }
function safeWildcard(s) { // {rest...}: permite "/" pero cada segmento debe ser seguro y no oculto
  if (typeof s !== "string" || s.length === 0 || s.length > 1024 || s.charAt(0) === "/") return false;
  return s.split("/").every((x) => safeSegment(x) && x.charAt(0) !== ".");
}
const PARAM_TYPES = {
  id: /^[a-z0-9]{15}$/, slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, int: /^[0-9]{1,15}$/, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
function patternParams(pattern) { // [{name, wildcard}]
  const out = []; pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(\.\.\.)?\}/g, (_, n, w) => { out.push({ name: n, wildcard: !!w }); return ""; });
  return out;
}
function validateParams(e, route) {
  const clean = {};
  for (const p of route.params) {
    const v = e.request.pathValue(p.name);
    if (!(p.wildcard ? safeWildcard(v) : safeSegment(v))) return null;
    const t = route.opts.params && route.opts.params[p.name];
    const re = t instanceof RegExp ? t : t && PARAM_TYPES[t];
    if (t && (!re || !re.test(v))) return null;
    clean[p.name] = v;
  }
  return clean;
}

// ---- helpers seguros de salida --------------------------------------------
function safeRedirectTarget(u) { // sólo rutas relativas del mismo sitio: "/x" (no "//x", "/\x", esquemas, control chars)
  return typeof u === "string" && u.length < 2048 && /^\/(?![\/\\])/.test(u) && !/[\x00-\x1f\x7f\\]/.test(u);
}
const SEC_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Cross-Origin-Resource-Policy": "same-origin",
};
// Servir un archivo bajo `base` sin symlinks, dotfiles ni salir del directorio.
function safeFileTarget(base, rel) {
  if (!safeWildcard(rel)) return null;
  let dir = base;
  const segs = rel.split("/");
  for (let i = 0; i < segs.length; i++) {
    let entries; try { entries = $os.readDir(dir); } catch (_) { return null; }
    const ent = entries.find((d) => d.name() === segs[i]);
    if (!ent) return null;
    const last = i === segs.length - 1;
    const t = Number(ent.type()); // FileMode envuelto por Go: 0 = archivo regular (ModeDir/ModeSymlink/etc. son != 0)
    if (last ? t !== 0 : !ent.isDir()) return null; // rechaza symlinks, sockets, etc.
    dir = dir + "/" + segs[i];
  }
  return rel;
}

function rateLimited(e, route) {
  const cfg = route.opts.rateLimit === false ? null : Object.assign({}, DEFAULTS.rateLimit, route.opts.rateLimit);
  if (!cfg) return false;
  const win = Math.floor(Date.now() / 1000 / cfg.windowSec);
  const key = `pbmini:rl:${e.realIP()}:${route.key}:${win}`;
  const store = $app.store();
  const n = (store.get(key) || 0) + 1; // aproximado (no atómico), suficiente contra abuso básico
  store.set(key, n);
  if (store.length() > 50000) store.reset(); // tope de memoria
  return n > cfg.max;
}

function ctx(e, params) {
  const c = {
    e, params, auth: e.auth,
    query: (k) => e.request.url.query().get(k),
    body: () => e.requestInfo().body,
    esc: (s) => String(s).replace(/[&<>"'`]/g, (ch) => "&#" + ch.charCodeAt(0) + ";"),
    json: (o, code) => e.json(code || 200, o),
    text: (s, code) => e.string(code || 200, s),
    // HTML sólo vía plantilla con autoescape. Para HTML ya confiable: unsafeHtml (nombre explícito).
    view(name, data, layout) {
      if (!safeSegment(name) || (layout !== undefined && !safeSegment(layout))) throw new Error("pbmini: nombre de vista inválido");
      const files = [`${__hooks}/views/${layout || "layout"}.html`, `${__hooks}/views/${name}.html`];
      return e.html(200, $template.loadFiles(...files).render(data || {}));
    },
    unsafeHtml: (s, code) => e.html(code || 200, s),
    redirect(url, code) {
      if (!safeRedirectTarget(url)) throw new Error("pbmini: redirect no permitido (solo rutas relativas)");
      return e.redirect(code || 302, url);
    },
    // c.file("public-dir-relativo-a-hooks", rel): sin symlinks ni dotfiles ni traversal.
    file(baseDir, rel) {
      const base = `${__hooks}/../${baseDir}`;
      const ok = safeFileTarget(base, rel);
      if (!ok) return c.json({ error: "not found" }, 404);
      return e.fileFS($os.dirFS(base), ok);
    },
    notFound: () => c.json({ error: "not found" }, 404),
    forbidden: () => c.json({ error: "forbidden" }, 403),
  };
  return c;
}

// ---- carga perezosa por runtime -------------------------------------------
let loaded = false;
function load() { if (loaded) return; loaded = true; require(`${__hooks}/routes.js`)(module.exports); }
// Registro atómico: se valida TODO antes del primer routerAdd. Un error en hooks NO detiene PocketBase
// (queda vivo sin las rutas), así que por defecto abortamos el proceso: fail-closed. PBMINI_ON_ERROR=warn lo relaja (dev).
function register() {
  try {
    load();
    for (const k in table) {
      const r = table[k];
      routerAdd(r.method, r.pattern, (e) => require(`${__hooks}/lib/mini.js`).dispatch(e), $apis.bodyLimit(r.opts.bodyLimit || DEFAULTS.bodyLimit)); // handler se serializa: sólo require() adentro
    }
  } catch (err) {
    console.log("pbmini: registro abortado:", String(err));
    if ($os.getenv("PBMINI_ON_ERROR") !== "warn") $os.exit(1);
  }
}

function dispatch(e) {
  load();
  const route = table[e.request.pattern] || table[e.request.pattern.replace(/^\S+\s/, "")];
  const h = e.response.header();
  for (const k in SEC_HEADERS) h.set(k, SEC_HEADERS[k]);
  if (!route) return e.json(404, { error: "not found" });
  try {
    const level = route.opts.auth;
    if (level === "user" && !e.auth) return e.json(401, { error: "authentication required" });
    if (level === "superuser" && !e.hasSuperuserAuth()) return e.json(e.auth ? 403 : 401, { error: e.auth ? "forbidden" : "authentication required" });
    if (rateLimited(e, route)) { h.set("Retry-After", "60"); return e.json(429, { error: "too many requests" }); }
    const params = validateParams(e, route);
    if (!params) return e.json(404, { error: "not found" }); // parámetro inválido: igual que ruta inexistente
    return route.handler(ctx(e, params));
  } catch (err) {
    $app.logger().error("pbmini handler error", "route", route.key, "error", String(err)); // detalle sólo en logs
    return e.json(500, { error: "internal error" });
  }
}

// ---- registro (falla al arrancar si la ruta es insegura) -------------------
function route(method, pattern, opts, handler) {
  if (typeof opts === "function") { handler = opts; opts = {}; } // sin opts => falla abajo por auth
  const fail = (m) => { throw new Error(`pbmini: ${method} ${pattern}: ${m}`); };
  if (!METHODS[method]) fail("método no soportado");
  if (typeof pattern !== "string" || pattern.charAt(0) !== "/") fail("el patrón debe empezar con '/'");
  if (!opts || !AUTH[opts.auth]) fail("falta `auth: 'public' | 'user' | 'superuser'` (deny by default)");
  if (typeof handler !== "function") fail("handler requerido");
  if (SYSTEM_PREFIX.test(pattern) && !opts.allowSystemPrefix) fail("prefijos /api/ y /_/ reservados (usa allowSystemPrefix si estás seguro)");
  if (/\/$/.test(pattern) && !opts.prefix) fail("un patrón terminado en '/' es comodín de todo el prefijo; usa '/{$}' para exacto o `prefix: true` explícito");
  if (/\.\.|\/\/|\\/.test(pattern.replace(/\{[A-Za-z_][A-Za-z0-9_]*(?:\.\.\.)?\}/g, "x"))) fail("patrón con segmentos sospechosos");
  const params = patternParams(pattern);
  for (const p of params) if (opts.params && opts.params[p.name] && !(opts.params[p.name] instanceof RegExp) && !PARAM_TYPES[opts.params[p.name]]) fail(`tipo de parámetro desconocido: ${opts.params[p.name]}`);
  const key = method + " " + pattern;
  if (table[key]) fail("ruta duplicada");
  table[key] = { key, method, pattern, opts, handler, params };
}

const mk = (m) => (p, o, h) => route(m, p, o, h);
module.exports = { dispatch, register, route, get: mk("GET"), post: mk("POST"), put: mk("PUT"), patch: mk("PATCH"), del: mk("DELETE"), PARAM_TYPES };
