// pbmini: microframework de rutas sobre routerAdd (goja/CommonJS). Seguro por defecto. Ver SECURITY.md.
//  - auth obligatoria por ruta          - query/body/params con esquema estricto (parser propio)
//  - consultas preparadas (sin SQL/filtros dinámicos) con reglas de colección aplicadas y campos hidden protegidos
//  - Cache-Control deny-by-default; caché de servidor opt-in, solo para rutas públicas y claves validadas
const AUTH = { public: 1, user: 1, superuser: 1 };
const SYSTEM_PREFIX = /^\/(api|_)(\/|$)/;
const METHODS = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };
const DEFAULTS = { bodyLimit: 1 << 20 };
const LIM = { rawQuery: 2048, params: 32, multi: 10, bodyKeys: 64, strMax: 100, cacheEntries: 1000, cacheBytes: 256 * 1024, storeMax: Number($os.getenv("PBMINI_STORE_MAX")) || 20000, page: 1000, limit: 100 };
const RESERVED = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf", "isPrototypeOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"];
const table = {}; // "METHOD /patrón" -> ruta

const CTRL = /[\x00-\x1f\x7f]/;

// ---- tipos y validación ---------------------------------------------------
const PARAM_TYPES = {
  id: /^[a-z0-9]{15}$/, slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
// Normaliza una especificación de campo: "int" | {type:"int",min,max} | {enum:[..]} | RegExp | ...
function compileField(name, spec, fail) {
  if (RESERVED.indexOf(name) >= 0 || !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name)) fail(`nombre de campo no permitido: ${name}`);
  let f = spec instanceof RegExp ? { type: "string", pattern: spec } : typeof spec === "string" ? { type: spec } : Object.assign({}, spec);
  if (f.enum) f.type = "enum";
  if (["string", "int", "bool", "id", "slug", "uuid", "enum"].indexOf(f.type) < 0) fail(`tipo desconocido para ${name}: ${f.type}`);
  if (f.type === "int") { f.min = f.min === undefined ? 0 : f.min; f.max = f.max === undefined ? 2147483647 : f.max; }
  if (f.type === "string") f.max = f.max === undefined ? LIM.strMax : f.max;
  if (f.type === "slug") f.max = f.max === undefined ? 64 : f.max;
  if (f.type === "enum" && (!Array.isArray(f.enum) || f.enum.length === 0)) fail(`enum vacío: ${name}`);
  f.name = name;
  return f;
}
function compileSchema(obj, fail) {
  const out = Object.create(null);
  if (obj) for (const k in obj) out[k] = compileField(k, obj[k], fail);
  return out;
}
// Devuelve {ok, v}. `raw` puede ser string (query/form) o primitivo JSON (body).
function checkValue(f, raw) {
  const isStr = typeof raw === "string";
  switch (f.type) {
    case "string": {
      if (!isStr || raw.length < (f.allowEmpty ? 0 : 1) || raw.length > f.max || CTRL.test(raw)) return { ok: false };
      if (f.pattern && !f.pattern.test(raw)) return { ok: false };
      return { ok: true, v: raw };
    }
    case "int": {
      let n;
      if (typeof raw === "number") n = raw;
      else if (isStr && /^-?(0|[1-9][0-9]{0,14})$/.test(raw) && raw !== "-0") n = Number(raw);
      else return { ok: false };
      if (!Number.isInteger(n) || n < f.min || n > f.max) return { ok: false };
      return { ok: true, v: n };
    }
    case "bool":
      if (raw === true || raw === "true") return { ok: true, v: true };
      if (raw === false || raw === "false") return { ok: true, v: false };
      return { ok: false };
    case "id": case "uuid": return isStr && PARAM_TYPES[f.type].test(raw) ? { ok: true, v: raw } : { ok: false };
    case "slug": return isStr && raw.length <= f.max && PARAM_TYPES.slug.test(raw) ? { ok: true, v: raw } : { ok: false };
    case "enum": return isStr && f.enum.indexOf(raw) >= 0 ? { ok: true, v: raw } : { ok: false };
  }
  return { ok: false };
}
function applyDefaults(schema, out) { // devuelve el nombre del campo faltante o null
  for (const k in schema) {
    if (k in out) continue;
    if (schema[k].required) return k;
    if (schema[k].default !== undefined) out[k] = schema[k].default;
  }
  return null;
}

// ---- parseo estricto de query string (no usa url.query(): evita diferenciales con Go/proxies/WAF) ----
function parseQuery(e, route) {
  const raw = e.request.url.rawQuery;
  const out = Object.create(null);
  if (raw.length > LIM.rawQuery) return { err: 414 };
  const ignore = route.opts.unknownQuery === "ignore";
  if (raw !== "") {
    const pairs = raw.split("&");
    if (pairs.length > LIM.params) return { err: 400 };
    const seen = Object.create(null);
    const dec = (s) => decodeURIComponent(s.replace(/\+/g, " "));
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (pair === "" || pair.indexOf(";") >= 0) return { err: 400 }; // Go descarta en silencio estos pares: nosotros rechazamos
      const eq = pair.indexOf("=");
      let k, v;
      try { k = dec(eq < 0 ? pair : pair.slice(0, eq)); v = eq < 0 ? "" : dec(pair.slice(eq + 1)); } catch (_) { return { err: 400 }; }
      if (CTRL.test(k) || CTRL.test(v)) return { err: 400 };
      const f = route.query[k]; // objeto sin prototipo: "__proto__" no es especial
      if (!f) { if (ignore && k.length <= 64) continue; return { err: 400 }; }
      const r = checkValue(f, v);
      if (!r.ok) return { err: 400, field: k };
      if (f.multi) { (seen[k] = seen[k] || []).push(r.v); if (seen[k].length > LIM.multi) return { err: 400 }; out[k] = seen[k]; }
      else { if (k in seen) return { err: 400, field: k }; seen[k] = true; out[k] = r.v; } // duplicados (HPP) rechazados
    }
  }
  const miss = applyDefaults(route.query, out);
  return miss ? { err: 400, field: miss } : { q: out };
}
function parseBody(e, route) {
  const out = Object.create(null);
  if (route.method === "GET") return { b: out };
  let body; try { body = e.requestInfo().body; } catch (_) { return { err: 400 }; }
  const keys = body ? Object.keys(body) : [];
  if (keys.length > LIM.bodyKeys) return { err: 400 };
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], f = route.body[k];
    if (!f) return { err: 400 }; // campo no declarado (mass assignment / pollution)
    const r = checkValue(f, body[k]);
    if (!r.ok) return { err: 400, field: k };
    out[k] = r.v;
  }
  const miss = applyDefaults(route.body, out);
  return miss ? { err: 400, field: miss } : { b: out };
}

// ---- parámetros de ruta ----------------------------------------------------
const SEG_BAD = /[\x00-\x1f\x7f\\\/%]/;
function safeSegment(s) { return typeof s === "string" && s.length > 0 && s.length <= 255 && s !== "." && s !== ".." && !SEG_BAD.test(s); }
function safeWildcard(s) {
  if (typeof s !== "string" || s.length === 0 || s.length > 1024 || s.charAt(0) === "/") return false;
  return s.split("/").every((x) => safeSegment(x) && x.charAt(0) !== ".");
}
function patternParams(pattern) {
  const out = []; pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(\.\.\.)?\}/g, (_, n, w) => { out.push({ name: n, wildcard: !!w }); return ""; });
  return out;
}
function validateParams(e, route) {
  const clean = Object.create(null);
  for (let i = 0; i < route.params.length; i++) {
    const p = route.params[i], v = e.request.pathValue(p.name);
    if (!(p.wildcard ? safeWildcard(v) : safeSegment(v))) return null;
    const f = route.paramTypes[p.name];
    if (f) { const r = checkValue(f, v); if (!r.ok) return null; clean[p.name] = r.v; } else clean[p.name] = v;
  }
  return clean;
}

// ---- salida y caché HTTP ----------------------------------------------------
const SEC_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
  "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()", "Cross-Origin-Resource-Policy": "same-origin",
};
const safeRedirectTarget = (u) => typeof u === "string" && u.length < 2048 && /^\/(?![\/\\])/.test(u) && !/[\x00-\x1f\x7f\\]/.test(u);
const hasCreds = (e) => !!(e.request.header.get("Authorization") || e.request.header.get("Cookie"));

function cacheControl(route, code, creds) { // deny by default: sólo 200 anónimo de rutas con `cache`
  const c = route.opts.cache;
  if (!c || code !== 200 || creds || route.auth !== "public") return "no-store";
  return (c.shared === false ? "private" : "public") + ", max-age=" + c.maxAge;
}
const etagOf = (body) => '"' + $security.sha256(body).slice(0, 32) + '"';
function matchesEtag(e, etag) {
  const h = e.request.header.get("If-None-Match");
  if (!h) return false;
  return h.split(",").some((t) => { t = t.trim().replace(/^W\//, ""); return t === etag || t === "*"; });
}

// ---- caché de servidor (sólo strings JSON en $app.store(): los objetos JS no cruzan runtimes) ----
const CK = "pbmini:c:";
function purgeStore() {
  const store = $app.store(), now = Date.now(), ks = store.keys();
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    if (k.indexOf(CK) === 0) { try { if (JSON.parse(store.get(k)).exp < now) store.remove(k); } catch (_) { store.remove(k); } }
  }
}
function cacheGet(key) {
  const s = $app.store().get(CK + key);
  if (!s) return null;
  try { const o = JSON.parse(s); return o.exp > Date.now() ? o : null; } catch (_) { return null; }
}
function cachePut(key, o) {
  const store = $app.store();
  if (store.length() >= LIM.storeMax) { purgeStore(); if (store.length() >= LIM.storeMax) return; } // lleno: no cachear (nunca desalojar)
  store.set(CK + key, JSON.stringify(o));
}

// ---- consultas preparadas ----------------------------------------------------
function runQuery(e, route, anon, qname, params, opt) {
  const qd = route.queries[qname];
  if (!qd) throw new Error(`pbmini: consulta no declarada: ${qname}`);
  params = params || {}; opt = opt || {};
  const names = Object.keys(params);
  if (names.length !== qd.placeholders.length || !names.every((n) => qd.placeholders.indexOf(n) >= 0)) throw new Error("pbmini: parámetros no coinciden con los placeholders");
  const bound = {};
  names.forEach((n) => {
    const v = params[n];
    if (!(typeof v === "string" && v.length <= 256 && !CTRL.test(v)) && !(typeof v === "number" && isFinite(v)) && typeof v !== "boolean") throw new Error("pbmini: valor de parámetro inválido");
    bound[n] = v;
  });
  const col = $app.findCollectionByNameOrId(qd.collection);
  let sort = "";
  if (opt.sort !== undefined) {
    if (qd.sort.indexOf(opt.sort) < 0) throw new Error("pbmini: sort no permitido");
    sort = opt.sort;
  } else if (qd.sort.length) sort = qd.sort[0];
  if (sort) sort.split(",").forEach((s) => { // los campos hidden/password no pueden ordenar (oráculo de contenido)
    const f = col.fields.getByName(s.replace(/^-/, ""));
    if (!f || f.getHidden()) throw new Error("pbmini: sort sobre campo inexistente u oculto");
  });
  const limit = Math.min(opt.limit === undefined ? 20 : opt.limit, qd.maxLimit);
  const page = opt.page === undefined ? 1 : opt.page;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(page) || page < 1 || page > LIM.page) throw new Error("pbmini: paginación inválida");
  const info = e.requestInfo();
  if (anon) info.auth = null; // rutas cacheables: nunca evaluar reglas con la identidad del visitante
  const rule = qd.rule === "view" ? col.viewRule : col.listRule; // null => sólo superuser; "" => público
  const recs = $app.findRecordsByFilter(qd.collection, qd.filter, sort, limit, (page - 1) * limit, bound);
  return recs.filter((r) => { try { return $app.canAccessRecord(r, info, rule); } catch (_) { return false; } })
    .map((r) => r.publicExport()); // sin campos hidden ni email oculto
}

function buildContext(e, route, params, q, b, state) {
  const anon = !!route.opts.cache;
  const ctx = {
    params, query: q, body: b,
    user: anon ? null : e.auth, // una ruta cacheable no puede personalizar
    escape: (s) => String(s).replace(/[&<>"'`]/g, (ch) => "&#" + ch.charCodeAt(0) + ";"),
    json: (o, code) => reply(code || 200, "application/json; charset=utf-8", JSON.stringify(o)),
    text: (s, code) => reply(code || 200, "text/plain; charset=utf-8", String(s)),
    view(name, data, layout) {
      if (!safeSegment(name) || (layout !== undefined && !safeSegment(layout))) throw new Error("pbmini: nombre de vista inválido");
      const files = [`${__hooks}/views/${layout || "layout"}.html`, `${__hooks}/views/${name}.html`];
      return reply(200, "text/html; charset=utf-8", $template.loadFiles(...files).render(data || {})); // autoescape
    },
    // Página por archivos: layout más cercano + parciales + HTML de la página (autoescape). Expone .Query, .Params y .User.
    page(data) {
      const pg = route.page;
      if (!pg || !pg.html) throw new Error("pbmini: esta ruta no tiene plantilla .html");
      const rd = (f) => toString($os.readFile(f));
      const body = rd(pg.html), hasDef = /\{\{-?\s*define\s/.test(body);
      let tpl;
      // loadFiles parsea cada archivo por separado (permite que la página redefina bloques del layout);
      // en una sola cadena Go rechaza redefinir un {{block}} con contenido por defecto.
      if (!pg.layout) {
        if (hasDef) throw new Error("pbmini: la página usa {{define}} pero no hay _layout.html");
        tpl = $template.loadFiles(pg.html, ...pg.partials);
      } else if (hasDef) tpl = $template.loadFiles(pg.layout, ...pg.partials, pg.html);
      else tpl = $template.loadString(rd(pg.layout) + pg.partials.map(rd).join("") + '{{define "body"}}' + body + "{{end}}"); // HTML plano => cuerpo (el bloque body del layout debe estar vacío)
      const d = Object.assign({}, data || {});
      d.Query = Object.assign({}, q); d.Params = Object.assign({}, params); d.User = ctx.user ? ctx.user.publicExport() : null;
      return reply(200, "text/html; charset=utf-8", tpl.render(d));
    },
    unsafeHtml: (s, code) => reply(code || 200, "text/html; charset=utf-8", String(s)),
    redirect(url, code) {
      if (!safeRedirectTarget(url)) throw new Error("pbmini: redirect no permitido (solo rutas relativas)");
      e.response.header().set("Cache-Control", "no-store");
      return e.redirect(code || 302, url);
    },
    file(baseDir, rel) { // sin symlinks, dotfiles, directorios ni traversal
      const base = `${__hooks}/../${baseDir}`;
      if (!safeFileTarget(base, rel)) return ctx.notFound();
      e.response.header().set("Cache-Control", cacheControl(route, 200, hasCreds(e)));
      return e.fileFS($os.dirFS(base), rel);
    },
    find: (name, p, opt) => runQuery(e, route, anon, name, p, opt),
    findOne: (name, p) => { const r = runQuery(e, route, anon, name, p, { limit: 1 }); return r.length ? r[0] : null; },
    notFound: () => reply(404, "application/json; charset=utf-8", '{"error":"not found"}'),
    forbidden: () => reply(403, "application/json; charset=utf-8", '{"error":"forbidden"}'),
  };
  function reply(code, ctype, body) {
    const h = e.response.header(), creds = hasCreds(e);
    h.set("Cache-Control", cacheControl(route, code, creds));
    if (code === 200 && route.opts.cache && !creds) {
      const tag = etagOf(body); h.set("ETag", tag);
      if (matchesEtag(e, tag)) return e.noContent(304);
      if (state.cacheKey && body.length <= LIM.cacheBytes) cachePut(state.cacheKey, { exp: Date.now() + route.opts.cache.maxAge * 1000, ctype, body, tag });
    }
    return e.blob(code, ctype, toBytes(body));
  }
  return ctx;
}
function safeFileTarget(base, rel) {
  if (!safeWildcard(rel)) return null;
  let dir = base;
  const segs = rel.split("/");
  for (let i = 0; i < segs.length; i++) {
    let entries; try { entries = $os.readDir(dir); } catch (_) { return null; }
    const ent = entries.find((d) => d.name() === segs[i]);
    if (!ent) return null;
    const t = Number(ent.type()); // FileMode envuelto por Go: 0 = archivo regular
    if (i === segs.length - 1 ? t !== 0 : !ent.isDir()) return null; // rechaza symlinks y especiales
    dir = dir + "/" + segs[i];
  }
  return rel;
}

// ---- carga perezosa por runtime + registro atómico fail-closed ---------------
let loaded = false;
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
function load() {
  if (loaded) return; loaded = true;
  if (exists(`${__hooks}/pages`)) require(`${__hooks}/lib/pages.js`)(module.exports);
}
// ---- sesión = token de PocketBase ------------------------------------------------------------------
// No hay login, sesiones ni revocación propios. El navegador manda la cookie `pb_auth` del SDK oficial
// ({"token":"<JWT>","record":{...}}); sólo se usa el token y lo valida PocketBase (firma, expiración, tokenKey:
// cambiar la contraseña lo revoca). `record` de la cookie se IGNORA. La cabecera Authorization nativa tiene prioridad.
// La API nativa de PocketBase (/api/*) no lee esta cookie: sólo las rutas de pbmini.
const JWT_RE = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{0,2048}$/;
function sessionToken(e) {
  const h = e.request.header.get("Cookie");
  if (!h || h.length > 8192) return null;
  const m = /(?:^|;\s*)pb_auth=([^;]*)/.exec(h); // primera ocurrencia
  if (!m) return null;
  try { const t = JSON.parse(decodeURIComponent(m[1])).token; return typeof t === "string" && JWT_RE.test(t) ? t : null; } catch (_) { return null; }
}
// Con cookie hay credencial ambiental => CSRF. Métodos que cambian estado sólo aceptan la cookie si el navegador
// declara same-origin/none (Fetch Metadata). Sin la cabecera (cliente no-navegador) no hay CSRF posible.
function csrfOk(e) {
  const m = e.request.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const sfs = e.request.header.get("Sec-Fetch-Site");
  return !sfs || sfs === "same-origin" || sfs === "none";
}
function cookieAuth(e) {
  if (!e.auth) {
    const t = sessionToken(e);
    if (t && csrfOk(e)) { try { e.auth = $app.findAuthRecordByToken(t, "auth"); } catch (_) { /* inválido/expirado/revocado => anónimo */ } }
  }
  return e.next();
}

function register() {
  try {
    load();
    for (const k in table) {
      const r = table[k];
      // Middleware nativo de PocketBase: cookie del SDK -> e.auth, luego requireAuth/requireSuperuserAuth y bodyLimit.
      const mws = [new Middleware((e) => require(`${__hooks}/lib/mini.js`).cookieAuth(e), -1000, "pbmini_cookie_auth")];
      if (r.auth === "user") mws.push($apis.requireAuth());
      else if (r.auth === "superuser") mws.push($apis.requireSuperuserAuth());
      mws.push($apis.bodyLimit(r.opts.bodyLimit || DEFAULTS.bodyLimit));
      routerAdd(r.method, r.pattern, (e) => require(`${__hooks}/lib/mini.js`).dispatch(e), ...mws);
    }
    // onServe corre tras las migraciones (aquí ya se ve el valor real). El handler va aislado: sólo globals.
    $app.onServe().bindFunc((e) => { try { if (!$app.settings().rateLimits.enabled) console.log("pbmini: AVISO el limitador nativo de PocketBase está DESACTIVADO (Settings > Application > Rate limiting). Ver README."); } catch (_) {} return e.next(); });
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
  h.set("Cache-Control", "no-store"); // por defecto; reply()/file() lo relajan sólo si la ruta lo declaró
  const fail = (code, msg, extra) => e.json(code, Object.assign({ error: msg }, extra || {}));
  if (!route) return fail(404, "not found");
  try {
    const params = validateParams(e, route);
    if (!params) return fail(404, "not found");
    const pq = parseQuery(e, route);
    if (pq.err) return fail(pq.err, pq.err === 414 ? "uri too long" : "invalid query", pq.field ? { field: pq.field } : undefined);
    const pb = parseBody(e, route);
    if (pb.err) return fail(400, "invalid body", pb.field ? { field: pb.field } : undefined);
    const state = {};
    if (route.opts.cache && route.opts.cache.server && !hasCreds(e)) {
      // clave = sólo valores validados y declarados (nunca URL cruda, Host ni cabeceras)
      state.cacheKey = JSON.stringify([route.key, route.params.map((p) => params[p.name]), Object.keys(route.query).map((n) => (pq.q[n] === undefined ? null : pq.q[n]))]);
      const hit = cacheGet(state.cacheKey);
      if (hit) {
        h.set("Cache-Control", cacheControl(route, 200, false)); h.set("ETag", hit.tag);
        if (matchesEtag(e, hit.tag)) return e.noContent(304);
        return e.blob(200, hit.ctype, toBytes(hit.body));
      }
    }
    return route.handler(buildContext(e, route, params, pq.q, pb.b, state));
  } catch (err) {
    $app.logger().error("pbmini handler error", "route", route.key, "error", String(err)); // detalle sólo en logs
    h.set("Cache-Control", "no-store");
    return fail(500, "internal error");
  }
}

const OPT_KEYS = ["auth", "params", "query", "body", "queries", "cache", "bodyLimit", "unknownQuery", "allowSystemPrefix", "prefix"];
function route(method, pattern, opts, handler, internal) {
  if (typeof opts === "function") { handler = opts; opts = {}; }
  const fail = (m) => { throw new Error(`pbmini: ${method} ${pattern}: ${m}`); };
  if (opts) for (const k in opts) if (OPT_KEYS.indexOf(k) < 0) fail(`opción desconocida "${k}" (¿error de tipeo? una opción ignorada puede desactivar un control)`);
  if (opts && opts.unknownQuery !== undefined && opts.unknownQuery !== "ignore") fail('unknownQuery solo admite "ignore"');
  if (opts && opts.bodyLimit !== undefined && !(Number.isInteger(opts.bodyLimit) && opts.bodyLimit >= 1 && opts.bodyLimit <= 32 * 1024 * 1024)) fail("bodyLimit debe ser entero 1..33554432");
  if (!METHODS[method]) fail("método no soportado");
  if (typeof pattern !== "string" || pattern.charAt(0) !== "/") fail("el patrón debe empezar con '/'");
  if (!opts || !AUTH[opts.auth]) fail("falta `auth: 'public' | 'user' | 'superuser'` (deny by default)");
  if (typeof handler !== "function") fail("handler requerido");
  if (SYSTEM_PREFIX.test(pattern) && !opts.allowSystemPrefix) fail("prefijos /api/ y /_/ reservados (usa allowSystemPrefix si estás seguro)");
  if (/\/$/.test(pattern) && !opts.prefix) fail("un patrón terminado en '/' es comodín de todo el prefijo; usa '/{$}' para exacto o `prefix: true` explícito");
  if (/\.\.|\/\/|\\/.test(pattern.replace(/\{[A-Za-z_][A-Za-z0-9_]*(?:\.\.\.)?\}/g, "x"))) fail("patrón con segmentos sospechosos");
  const params = patternParams(pattern);
  const paramTypes = compileSchema(opts.params, fail);
  for (const k in paramTypes) if (!params.some((p) => p.name === k)) fail(`el parámetro tipado ${k} no está en el patrón`);
  const query = compileSchema(opts.query, fail), body = compileSchema(opts.body, fail);
  for (const k in query) if (query[k].type === "string" && query[k].max > 1000) fail(`límite de ${k} excesivo`);
  if (opts.body && (method === "GET")) fail("GET no admite body");
  const queries = Object.create(null);
  if (opts.queries) for (const name in opts.queries) {
    const d = opts.queries[name];
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) || RESERVED.indexOf(name) >= 0) fail(`nombre de consulta inválido: ${name}`);
    if (!d || typeof d.filter !== "string" || typeof d.collection !== "string") fail(`consulta ${name}: requiere collection y filter (string constante)`);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(d.collection)) fail(`consulta ${name}: colección no permitida (las de sistema "_xxx" están vetadas)`);
    if (d.filter.length > 400 || CTRL.test(d.filter)) fail(`consulta ${name}: filtro inválido`);
    const ph = []; d.filter.replace(/\{:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => { if (ph.indexOf(n) < 0) ph.push(n); return ""; });
    const stray = d.filter.replace(/\{:[A-Za-z_][A-Za-z0-9_]*\}/g, "");
    if (/[{}]/.test(stray)) fail(`consulta ${name}: placeholder mal formado`);
    if (d.rule !== undefined && d.rule !== "list" && d.rule !== "view") fail(`consulta ${name}: rule debe ser list|view`);
    const sort = d.sort === undefined ? [] : d.sort;
    if (!Array.isArray(sort) || sort.some((s) => !/^-?[A-Za-z][A-Za-z0-9_]{0,63}(,-?[A-Za-z][A-Za-z0-9_]{0,63}){0,2}$/.test(s))) fail(`consulta ${name}: sort inválido`);
    queries[name] = { collection: d.collection, filter: d.filter, placeholders: ph, sort, rule: d.rule || "list", maxLimit: Math.min(d.maxLimit || 50, LIM.limit) };
  }
  const c = opts.cache;
  if (c) {
    if (method !== "GET") fail("cache sólo en GET");
    if (opts.auth !== "public") fail("cache sólo en rutas auth:'public' (nunca cachear respuestas personalizadas)");
    if (!Number.isInteger(c.maxAge) || c.maxAge < 1 || c.maxAge > 86400) fail("cache.maxAge debe ser entero 1..86400");
    if (opts.prefix) fail("cache no se permite en rutas prefix:true");
    if (c.server) { // la clave debe estar acotada para que un atacante no pueda inflar la caché
      const bounded = (f) => f.type !== "string" || (f.max <= 32);
      for (const k in query) if (!bounded(query[k]) || query[k].multi) fail(`cache.server: la query ${k} no está acotada (string max<=32, enum, int, bool, id, slug)`);
      for (const p of params) { const f = paramTypes[p.name]; if (!f || !bounded(f) || p.wildcard) fail(`cache.server: el parámetro ${p.name} debe estar tipado y acotado`); }
    }
  }
  const key = method + " " + pattern;
  if (table[key]) fail("ruta duplicada");
  table[key] = { key, method, pattern, auth: opts.auth, opts, handler, params, paramTypes, query, body, queries, page: internal && internal.page };
}

// No hay registro global de rutas (routes.js): cada ruta es un archivo de pages/ (lib/pages.js llama a route()).
module.exports = { dispatch, register, route, cookieAuth };
