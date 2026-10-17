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
  if (obj !== undefined && obj !== null && (typeof obj !== "object" || Array.isArray(obj))) fail("un esquema debe ser un objeto de campos (o, en pages/, el nombre de un archivo de pages/_schemas/)");
  if (obj) for (const k of Object.keys(obj)) out[k] = compileField(k, obj[k], fail);
  return out;
}
// Descripción serializable de un campo compilado (para pbmini:routes, el fuzzer guiado y los tipos).
function describeField(f) {
  const d = { type: f.type };
  ["min", "max", "enum", "required", "default", "multi", "allowEmpty"].forEach((k) => { if (f[k] !== undefined) d[k] = f[k]; });
  if (f.pattern) d.pattern = f.pattern.source;
  return d;
}
// Devuelve {ok, v}. `raw` puede ser string (query/form) o primitivo JSON (body).
function checkValue(f, raw, json) { // json=true: el cuerpo ya viene tipado; no se aceptan cadenas como número/booleano ({"n":"5"})
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
      else if (!json && isStr && /^-?(0|[1-9][0-9]{0,14})$/.test(raw) && raw !== "-0") n = Number(raw);
      else return { ok: false };
      if (!Number.isInteger(n) || n < f.min || n > f.max) return { ok: false };
      return { ok: true, v: n };
    }
    case "bool":
      if (raw === true || (!json && raw === "true")) return { ok: true, v: true };
      if (raw === false || (!json && raw === "false")) return { ok: true, v: false };
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
  // JSON estricto: Go decodifica el primer valor e ignora el resto ({"n":1}x, dos documentos); JSON.parse lo rechaza.
  // Leer el cuerpo lo consume, por eso el JSON se parsea aquí y no con requestInfo().
  let body, isJson = false;
  if ((e.request.header.get("Content-Type") || "").toLowerCase().indexOf("application/json") === 0) {
    isJson = true;
    try { const txt = toString(e.request.body); body = txt === "" ? {} : JSON.parse(txt); } catch (_) { return { err: 400 }; }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return { err: 400 };
  } else {
    try { body = e.requestInfo().body; } catch (_) { return { err: 400 }; }
  }
  const keys = body ? Object.keys(body) : [];
  if (keys.length > LIM.bodyKeys) return { err: 400 };
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], f = route.body[k];
    if (!f) return { err: 400 }; // campo no declarado (mass assignment / pollution)
    const r = checkValue(f, body[k], isJson);
    if (!r.ok) return { err: 400, field: k };
    out[k] = r.v;
  }
  const miss = applyDefaults(route.body, out);
  return miss ? { err: 400, field: miss } : { b: out };
}

// ---- parámetros de ruta ----------------------------------------------------
// además de control, "\", "/" y "%": UTF-8 inválido (U+FFFD), invisibles/bidi y barras/puntos de ancho completo o parecidos (spoofing y "best-fit" de Windows)
// Caracteres que nunca forman parte de un segmento de ruta: control, "\", "/", "%", UTF-8 inválido (U+FFFD), invisibles/rellenos/bidi
// (soft hyphen, CGJ, ALM, fillers Hangul/Khmer/Mongol, ZW*, LRM/RLM, LRE..RLO, aislados U+2066-2069, braille en blanco, BOM), barras/puntos
// "parecidos" (ancho completo, división, fracción, big solidus, box drawing) y los caracteres TAG (U+E0000..E007F). Spoofing y "best-fit" de Windows.
const SEG_BAD = /[\x00-\x1f\x7f\\\/%\ufffd\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\u2800\u3164\ufeff\uffa0\uff0f\uff3c\uff0e\u2215\u2216\u2044\u2571\u2572\u29f5\u29f8\u29f9]|\udb40[\udc00-\udfff]/;
// NFKC: cualquier carácter "de compatibilidad" (ancho completo, puntos guía U+2024/2025, punto pequeño U+FE52...) cambia al normalizar => confundible con "." o "/"
const stable = (s) => !s.normalize || s.normalize("NFKC") === s;
function safeSegment(s) { return typeof s === "string" && s.length > 0 && s.length <= 255 && s !== "." && s !== ".." && !SEG_BAD.test(s) && stable(s); }
// ---- archivos que nunca deben servirse desde un directorio público (defensa en profundidad; no sustituye a no desplegarlos) ----
const SENSITIVE_EXT = /\.(bak|backup|old|orig|save|swp|swo|tmp|temp|sql|sqlite3?|db|log|pem|key|pfx|p12|env|ini|conf|cfg|htpasswd|htaccess)$/i;
const SENSITIVE_NAME = /^(id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|dockerfile|docker-compose\.ya?ml|web\.config|composer\.(json|lock)|package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|credentials|secrets?)$/i;
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$|clock\$)(\..*)?$/i;
function hiddenName(seg, last) {
  if (seg.charAt(0) === ".") return true;                                   // dotfiles y directorios ocultos (.env, .git, .ssh...)
  const s = seg.replace(/:.*$/, "").replace(/[. ]+$/, "");                  // NTFS ignora ":flujo" y los puntos/espacios finales
  if (/~[0-9]/.test(s) || WIN_RESERVED.test(s)) return true;               // nombres cortos 8.3 (ENV~1) y dispositivos de Windows (CON, NUL, COM1...)
  return !!last && (SENSITIVE_EXT.test(s) || /~$/.test(s) || SENSITIVE_NAME.test(s));   // respaldos, claves, bases de datos, logs, configuración
}
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
const tagsExist = (tags) => !tags || tags.every((t) => { try { $app.findCollectionByNameOrId(t); return true; } catch (_) { return false; } });
// Invalida las entradas de servidor etiquetadas con `tag` (nombre de colección). Recorre el almacén compartido: no depende de estado por VM.
function invalidateTag(tag) {
  const store = $app.store(), ks = store.keys(), needle = '"' + tag + '"';
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    if (k.indexOf(CK) !== 0) continue;
    const v = store.get(k);
    if (typeof v !== "string" || v.indexOf(needle) < 0) continue;
    try { if (JSON.parse(v).tags.indexOf(tag) >= 0) store.remove(k); } catch (_) { store.remove(k); }
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
// RequestInfo propio para evaluar las reglas de colección: e.requestInfo() releería el cuerpo (ya consumido por el parser JSON estricto => EOF)
// y además mezclaría cabeceras/consulta arbitrarias del cliente. Las reglas ven: auth, método y el cuerpo YA VALIDADO; query y headers van vacíos.
function newInfo(e, anon, body) {
  const info = new RequestInfo();
  info.method = e.request.method; info.auth = anon ? null : e.auth; info.body = body || {}; info.query = {}; info.headers = {}; info.context = "default";
  return info;
}
const bindable = (v) => (typeof v === "string" && v.length <= 256 && !CTRL.test(v)) || (typeof v === "number" && isFinite(v)) || typeof v === "boolean";
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// `app` es $app, o el txApp dentro de ctx.tx (usar $app dentro de una transacción provoca interbloqueo).
function runQuery(app, e, route, anon, qname, params, opt) {
  const qd = route.queries[qname];
  if (!qd) throw new Error(`pbmini: consulta no declarada: ${qname}`);
  params = params || {}; opt = opt || {};
  const names = Object.keys(params);
  if (names.length !== qd.placeholders.length || !names.every((n) => qd.placeholders.indexOf(n) >= 0)) throw new Error("pbmini: parámetros no coinciden con los placeholders");
  const bound = {};
  names.forEach((n) => {
    if (!bindable(params[n])) throw new Error("pbmini: valor de parámetro inválido");
    bound[n] = params[n];
  });
  // Filtros opcionales: fragmentos CONSTANTES declarados en la consulta (`filters`). Quien llama solo aporta valores, que se enlazan siempre;
  // el orden de los fragmentos es el de la declaración y la consulta HTTP nunca aporta texto de filtro ni nombres de campo.
  let filter = qd.filter;
  if (opt.where !== undefined && opt.where !== null) {
    if (typeof opt.where !== "object" || Array.isArray(opt.where)) throw new Error("pbmini: where debe ser un objeto");
    Object.keys(opt.where).forEach((k) => { if (!hasOwn(qd.filters, k)) throw new Error(`pbmini: filtro no declarado: ${k}`); });
    Object.keys(qd.filters).forEach((k) => {
      if (!hasOwn(opt.where, k) || opt.where[k] === undefined || opt.where[k] === null) return;
      if (!bindable(opt.where[k])) throw new Error("pbmini: valor de filtro inválido");
      filter = "(" + filter + ") && (" + qd.filters[k].replace("{:v}", "{:f_" + k + "}") + ")";
      bound["f_" + k] = opt.where[k];
    });
  }
  const col = app.findCollectionByNameOrId(qd.collection);
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
  const size = opt.pageSize === undefined ? limit : opt.pageSize; // tamaño de página (el desplazamiento usa éste, no el límite leído)
  const page = opt.page === undefined ? 1 : opt.page;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(size) || size < 1 || size > limit || !Number.isInteger(page) || page < 1 || page > LIM.page) throw new Error("pbmini: paginación inválida");
  const info = newInfo(e, anon, {}); // rutas cacheables (anon): nunca evaluar reglas con la identidad del visitante
  const rule = qd.rule === "view" ? col.viewRule : col.listRule; // null => sólo superuser; "" => público
  const recs = app.findRecordsByFilter(qd.collection, filter, sort, limit, (page - 1) * size, bound);
  return recs.filter((r) => { try { return app.canAccessRecord(r, info, rule); } catch (_) { return false; } })
    .map((r) => r.publicExport()); // sin campos hidden ni email oculto
}

// ---- escrituras declaradas (mutations): lista blanca de campos + reglas de colección create/update/delete de PocketBase ----
const FORBIDDEN_FIELDS = ["id", "created", "updated", "collectionId", "collectionName", "expand", "tokenKey", "password", "passwordConfirm", "oldPassword", "verified", "emailVisibility", "email", "username"];
function httpError(status, msg) { const err = new Error(msg); err.pbminiStatus = status; return err; }
function mutate(app, e, route, name, op, id, data) {
  if (route.method === "GET") throw new Error("pbmini: las escrituras no se permiten en GET (CSRF)");
  const md = route.mutations[name];
  if (!md || md.op !== op) throw new Error(`pbmini: mutación no declarada: ${name} (${op})`);
  const col = app.findCollectionByNameOrId(md.collection);
  if (col.type !== "base") throw new Error("pbmini: las mutaciones solo admiten colecciones base (las cuentas se gestionan con la API nativa)");
  let rec;
  if (op === "create") rec = new Record(col);
  else {
    if (typeof id !== "string" || !PARAM_TYPES.id.test(id)) throw httpError(404, "not found");
    try { rec = app.findRecordById(col.name, id); } catch (_) { throw httpError(404, "not found"); }
  }
  let sets = [];
  if (op !== "delete") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("pbmini: data debe ser un objeto");
    const keys = Object.keys(data);
    keys.forEach((k) => {
      if (md.fields.indexOf(k) < 0) throw new Error(`pbmini: campo no permitido en la mutación ${name}: ${k}`);
      const f = col.fields.getByName(k);
      if (!f || f.type() === "password") throw new Error(`pbmini: campo inexistente o de contraseña: ${k}`);
      if (!bindable(data[k])) throw new Error(`pbmini: valor inválido en ${k}`);
    });
    sets = keys;
  }
  const rule = op === "create" ? col.createRule : op === "update" ? col.updateRule : col.deleteRule; // null => solo superuser
  const info = newInfo(e, false, data && typeof data === "object" ? Object.assign({}, data) : {}); // @request.body de las reglas = los datos de la mutación
  const denied = "pbmini:denied";
  try {
    if (op === "create") {
      // Igual que la API nativa: la regla de creación se evalúa con el registro ya guardado dentro de una transacción; si no pasa, se revierte.
      sets.forEach((k) => rec.set(k, data[k]));
      app.runInTransaction((tx) => { tx.save(rec); if (!tx.canAccessRecord(rec, info, rule)) throw new Error(denied); });
    } else {
      // update/delete: la regla se evalúa contra el registro EXISTENTE, antes de aplicar nada (si no, un atacante cambiaría `owner` y pasaría la regla)
      let allowed = false;
      try { allowed = app.canAccessRecord(rec, info, rule); } catch (err) { if ($os.getenv("PBMINI_DEBUG") === "1") console.log("pbmini canAccessRecord:", String(err)); }
      if (!allowed) throw new Error(denied);
      if (op === "update") { sets.forEach((k) => rec.set(k, data[k])); app.save(rec); } else app.delete(rec);
    }
  } catch (err) {
    if (String(err).indexOf(denied) >= 0) throw httpError(op === "create" ? 403 : 404, op === "create" ? "forbidden" : "not found");
    app.logger().warn("pbmini mutación rechazada", "route", route.key, "mutation", name, "error", String(err));
    throw httpError(422, "invalid data");
  }
  return op === "delete" ? { id: rec.id } : rec.publicExport();
}

const i18n = () => require(`${__hooks}/lib/i18n.js`);
const mod = (n) => require(`${__hooks}/lib/${n}.js`); // access, sessions, mail, config, cron (módulos opcionales; apagados por defecto)
// ---- páginas de error: solo rutas con .html y clientes que aceptan text/html; el contenido es fijo (Status/Reason), nunca datos de la petición ----
const REASONS = { 400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found", 414: "URI Too Long", 422: "Unprocessable Entity", 429: "Too Many Requests", 500: "Internal Server Error" };
function wantsHtml(e) {
  const a = e.request.header.get("Accept");
  if (!a || a.length > 1024) return false;
  return a.split(",", 16).some((p) => { const m = /^\s*text\/html\s*(?:;(.*))?$/i.exec(p); if (!m) return false; const q = /(?:^|;)\s*q\s*=\s*([0-9.]+)/i.exec(m[1] || ""); return !q || Number(q[1]) > 0; });
}
function errorPage(e, route, code) {
  const pg = route && route.page;
  if (!pg || !pg.html || !pg.error || !wantsHtml(e)) return null;
  try {
    const html = $template.loadFiles(pg.error, ...pg.partials).render({ Status: code, Reason: REASONS[code] || "Error" });
    e.response.header().set("Vary", "Accept");
    return e.blob(code, "text/html; charset=utf-8", toBytes(html));
  } catch (err) { $app.logger().error("pbmini error page", "route", route.key, "error", String(err)); return null; } // plantilla rota: JSON clásico
}

function buildContext(e, route, params, q, b, state) {
  const anon = !!route.opts.cache;
  const ctx = {
    params, query: q, body: b,
    locale: state.locale || null,
    can: (permission) => mod("access").can(e, permission),
    hasRole: (role) => mod("access").hasRole(e, role),
    membership: () => mod("access").membership(e),
    mail: (name, opt) => mod("mail").send(e, route, name, opt),
    logout: () => mod("sessions").logout(e, route),
    logoutEverywhere: () => mod("sessions").logoutEverywhere(e, route),
    sessions: () => mod("sessions").list(e),
    revokeSession: (id) => mod("sessions").revoke(e, route, id),
    t: (key, vars) => { if (!state.locale) throw new Error("pbmini: i18n no configurado (crea pb_hooks/i18n/<idioma>.json)"); return i18n().t(state.locale, key, vars); },
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
      const chain = pg.layouts && pg.layouts.length ? pg.layouts : (pg.layout ? [pg.layout] : []); // raíz -> hoja
      let tpl;
      // loadFiles parsea cada archivo por separado (permite que la página redefina bloques del layout);
      // en una sola cadena Go rechaza redefinir un {{block}} con contenido por defecto.
      if (!chain.length) {
        if (hasDef) throw new Error("pbmini: la página usa {{define}} pero no hay _layout.html");
        tpl = $template.loadFiles(pg.html, ...pg.partials);
      } else if (hasDef) tpl = $template.loadFiles(chain[0], ...pg.partials, ...chain.slice(1), pg.html);
      else tpl = $template.loadString(rd(chain[0]) + pg.partials.map(rd).join("") + chain.slice(1).map(rd).join("") + `{{define "${pg.slot || "body"}"}}` + body + "{{end}}"); // HTML plano => slot del layout más profundo (los bloques con contenido por defecto no se redefinen)
      const d = Object.assign({}, data || {});
      d.Query = Object.assign({}, q); d.Params = Object.assign({}, params); d.User = ctx.user ? ctx.user.publicExport() : null;
      if (state.locale) { d.T = i18n().table(state.locale); d.Locale = state.locale; }
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
    find: (name, p, opt) => runQuery($app, e, route, anon, name, p, opt),
    findOne: (name, p, opt) => { const r = runQuery($app, e, route, anon, name, p, Object.assign({}, opt, { limit: 1 })); return r.length ? r[0] : null; },
    // Paginación estándar: usa ctx.query.page / perPage (/ sort) que la opción `paginate` añade al esquema de la ruta. Sin `total` a propósito:
    // contarlo ignoraría las reglas de la colección y revelaría cuántos registros ocultos existen. `hasMore` sale solo de lo que el usuario puede ver.
    paginate(name, p, opt) {
      const pg = route.opts.paginate;
      if (!pg) throw new Error("pbmini: ctx.paginate requiere la opción `paginate` en la ruta");
      const perPage = ctx.query.perPage, o = { limit: perPage + 1, pageSize: perPage, page: ctx.query.page };
      if (pg.sort) o.sort = ctx.query.sort;
      if (opt && opt.where) o.where = opt.where;
      const rows = runQuery($app, e, route, anon, name, p, o);
      return { items: rows.slice(0, perPage), page: o.page, perPage, hasMore: rows.length > perPage };
    },
    create: (name, data) => mutate($app, e, route, name, "create", null, data),
    update: (name, id, data) => mutate($app, e, route, name, "update", id, data),
    delete: (name, id) => mutate($app, e, route, name, "delete", id),
    // Transacción: todo o nada. Dentro solo existen find/findOne/create/update/delete (con txApp); no hay $app, correo ni red.
    tx(fn) {
      if (typeof fn !== "function") throw new Error("pbmini: ctx.tx requiere una función");
      if (route.method === "GET") throw new Error("pbmini: ctx.tx no se permite en GET");
      let out, cause = null;
      try {
        $app.runInTransaction((txApp) => {
          try {
            out = fn({
              find: (name, p, opt) => runQuery(txApp, e, route, anon, name, p, opt),
              findOne: (name, p, opt) => { const r = runQuery(txApp, e, route, anon, name, p, Object.assign({}, opt, { limit: 1 })); return r.length ? r[0] : null; },
              create: (name, data) => mutate(txApp, e, route, name, "create", null, data),
              update: (name, id, data) => mutate(txApp, e, route, name, "update", id, data),
              delete: (name, id) => mutate(txApp, e, route, name, "delete", id),
            });
          } catch (err) { cause = err; throw err; } // el rollback lo hace PocketBase; la causa original se relanza abajo
        });
      } catch (err) { throw cause || err; }
      return out;
    },
    notFound: () => reply(404, "application/json; charset=utf-8", '{"error":"not found"}'),
    forbidden: () => reply(403, "application/json; charset=utf-8", '{"error":"forbidden"}'),
  };
  function reply(code, ctype, body) {
    const h = e.response.header(), creds = hasCreds(e);
    h.set("Cache-Control", cacheControl(route, code, creds));
    if (code === 200 && route.opts.cache && !creds) {
      const tag = etagOf(body); h.set("ETag", tag);
      if (matchesEtag(e, tag)) return e.noContent(304);
      if (state.cacheKey && body.length <= LIM.cacheBytes && tagsExist(route.opts.cache.tags)) cachePut(state.cacheKey, { exp: Date.now() + route.opts.cache.maxAge * 1000, ctype, body, tag, tags: route.opts.cache.tags || [] });
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
    if (hiddenName(segs[i], i === segs.length - 1) || /[:*?"<>|]/.test(segs[i])) return null;
    const t = Number(ent.type()); // FileMode envuelto por Go: 0 = archivo regular
    if (i === segs.length - 1 ? t !== 0 : !ent.isDir()) return null; // rechaza symlinks y especiales
    dir = dir + "/" + segs[i];
  }
  return rel;
}

// ---- carga perezosa por runtime + registro atómico fail-closed ---------------
let loaded = false;
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
let rootError = null; // pages/_error.html raíz (para el 404 nativo); lo fija pages.js
function setRootError(o) { rootError = o; }
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
// declara same-origin/none (Fetch Metadata) y Origin/Referer coinciden con el Host. Sin esas cabeceras (cliente no-navegador) no hay CSRF posible.
function csrfOk(e) {
  const m = e.request.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const sfs = e.request.header.get("Sec-Fetch-Site");
  if (sfs && sfs !== "same-origin" && sfs !== "none") return false;     // cross-site, same-site (subdominio hermano) o valor inesperado
  // Origin (y si falta, Referer) deben ser del mismo host. Tras un proxy, éste debe reenviar el Host original
  // (si no, las escrituras con cookie fallan cerradas con 401). Ninguna página ajena puede falsificar estas cabeceras.
  const host = String(e.request.host || "").toLowerCase();
  const origin = e.request.header.get("Origin");
  if (origin) { const o = /^https?:\/\/([^\/?#]+)$/i.exec(origin); if (!o || o[1].toLowerCase() !== host) return false; }
  else {
    const ref = e.request.header.get("Referer");
    if (ref) { const r = /^https?:\/\/([^\/?#]+)/i.exec(ref); if (!r || r[1].toLowerCase() !== host) return false; }
  }
  if (sfs) return true; // navegador con Fetch Metadata y mismo origen: Sec-Fetch-Site no es falsificable por una página
  if (origin || e.request.header.get("Referer")) return true;
  // Sin Sec-Fetch-Site, Origin ni Referer (cliente no-navegador, o navegador antiguo con Referer suprimido): solo se acepta una petición
  // "no simple" que un <form> entre sitios no puede fabricar (Content-Type JSON o X-Requested-With) y que CORS sin credenciales no deja enviar.
  return /^application\/json/i.test(e.request.header.get("Content-Type") || "") || !!e.request.header.get("X-Requested-With");
}
// PocketBase sirve el publicDir tal cual (dotfiles, respaldos, symlinks...). Este middleware GLOBAL cierra lo que se puede cerrar por ruta:
//  - cualquier segmento que empiece por "." (salvo /.well-known/) => 404, en cualquier ruta (también /api y /_)
//  - en la ruta estática nativa: segmentos con bytes/Unicode raros (NFKC, bidi, U+FFFD, "%", "\"), caracteres de Windows (: * ? " < > |),
//    nombres 8.3 (ENV~1), dispositivos (CON, NUL), respaldos/claves/bases de datos/logs/configuración => 404
//  - symlinks y archivos especiales (p. ej. una FIFO, que bloquearía la lectura) detectados al arrancar: nunca se sirven
function guardPaths(e) {
  const segs = e.request.url.path.split("/");
  const isStatic = String(e.request.pattern || "").replace(/^\S+\s/, "") === "/{path...}";
  const deny = () => { const h = e.response.header(); h.set("Cache-Control", "no-store"); h.set("X-Content-Type-Options", "nosniff"); return e.json(404, { error: "not found" }); };
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if (s === "" || (i === 1 && s === ".well-known")) continue;
    if (s.charAt(0) === ".") return deny();
    if (isStatic && (!safeSegment(s) || /[:*?"<>|]/.test(s) || hiddenName(s, i === segs.length - 1))) return deny();
  }
  if (isStatic) {
    const rel = segs.filter((x) => x !== "").join("/").toLowerCase(), links = pubScan().links;
    for (let i = 0; i < links.length; i++) if (rel === links[i] || rel.indexOf(links[i] + "/") === 0) return deny();
    // 404 nativo de la ruta estática (ninguna ruta ni archivo): si el cliente acepta HTML y existe pages/_error.html, se responde con esa página
    try { return e.next(); } catch (err) {
      if (err && err.value && err.value.status === 404) {
        load();
        const h = e.response.header();
        if (rootError && wantsHtml(e)) { // las cabeceras van antes de escribir la respuesta
          for (const k in SEC_HEADERS) h.set(k, SEC_HEADERS[k]);
          h.set("Cache-Control", "no-store");
          const r = errorPage(e, { key: "404", page: { html: true, error: rootError.error, partials: rootError.partials } }, 404);
          if (r) return r;
        }
      }
      throw err;
    }
  }
  return e.next();
}
// Directorio público: --publicDir de la línea de comandos, PBMINI_PUBLIC_DIR o ../pb_public.
function publicDir() {
  const a = $os.args || [];
  for (let i = 0; i < a.length; i++) { const m = /^--?publicDir(?:=(.*))?$/.exec(String(a[i])); if (m) return m[1] !== undefined ? m[1] : String(a[i + 1] || ""); }
  return $os.getenv("PBMINI_PUBLIC_DIR") || `${__hooks}/../pb_public`;
}
let _scan = null; // por runtime (cada VM del pool lo calcula una vez)
function pubScan() {
  if (_scan) return _scan;
  _scan = { bad: [], links: [], dir: "" };
  if (($os.getenv("PBMINI_PUBLIC_AUDIT") || "strict") === "off") return _scan;
  const dir = publicDir();
  if (!dir || !exists(dir)) return _scan;
  _scan.dir = dir; let n = 0;
  $filepath.walkDir(dir, (p, d, err) => {
    if (err || ++n > 50000) return;
    const rel = String(p).slice(dir.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
    if (rel === "") return;
    if (!d.isDir() && Number(d.type()) !== 0) { _scan.bad.push(`${rel}: enlace simbólico o archivo especial`); _scan.links.push(rel.toLowerCase()); }
    else if (rel.split("/")[0] !== ".well-known" && hiddenName(d.name(), !d.isDir())) _scan.bad.push(`${rel}: archivo oculto/sensible`);
  });
  return _scan;
}
// PBMINI_PUBLIC_AUDIT = strict (por defecto: aborta el arranque) | warn (avisa; el guardia bloquea en ejecución) | off
function auditPublic() {
  const mode = $os.getenv("PBMINI_PUBLIC_AUDIT") || "strict", sc = pubScan();
  if (mode === "off" || !sc.bad.length) return;
  const msg = `pbmini: el directorio público (${sc.dir}) no es seguro (${sc.bad.length}): ${sc.bad.slice(0, 5).join("; ")}${sc.bad.length > 5 ? "; ..." : ""}`;
  if (mode === "warn") console.log(msg + " [PBMINI_PUBLIC_AUDIT=warn: los symlinks/especiales y lo oculto/sensible se bloquean en ejecución]");
  else throw new Error(msg + " (retíralos, o PBMINI_PUBLIC_AUDIT=warn|off solo en desarrollo)");
}
function cookieAuth(e) {
  let tok = null;
  if (!e.auth) {
    const t = sessionToken(e);
    if (t && csrfOk(e)) { try { e.auth = $app.findAuthRecordByToken(t, "auth"); tok = t; } catch (_) { /* inválido/expirado/revocado => anónimo */ } }
  } else tok = String(e.request.header.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim() || null;
  // sesiones revocables (módulo opcional): un token cuya sesión fue revocada deja de valer en las rutas de pbmini
  if (e.auth && tok && !mod("sessions").verify(e, tok)) e.auth = null;
  return e.next();
}

function register() {
  try {
    load();
    auditPublic();
    i18n().load(); // valida pb_hooks/i18n/*.json (claves y {variables} iguales en todos los idiomas)
    const conf = mod("config").load(); // pbmini.config.js (todo apagado por defecto)
    mod("mail").validate();
    mod("cron").jobs().forEach((j) => { // el cuerpo de cada tarea se serializa y corre en una VM aislada: el id (validado ^[a-z0-9_]+$) va como literal
      const fn = eval("(() => require(__hooks + '/lib/cron.js').run(" + JSON.stringify(j.id) + "))");
      cronAdd("pbmini_" + j.id, j.schedule, fn);
    });
    if (conf.access.enabled && conf.access.statusField) { // cuenta bloqueada: sin inicio de sesión (ni refresh) y, tras bloquearla, sus sesiones se vetan
      onRecordAuthRequest((e) => { require(`${__hooks}/lib/access.js`).guardAuth(e); return e.next(); }, conf.access.collection);
      onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/access.js`).onUserSaved(e); return e.next(); }, conf.access.collection);
    }
    if (conf.sessions.enabled) {
      routerUse(new Middleware((e) => require(`${__hooks}/lib/sessions.js`).guard(e), -1015, "pbmini_sessions")); // veto global (también /api/*)
      onRecordAuthRequest((e) => { require(`${__hooks}/lib/sessions.js`).issue(e); return e.next(); }, conf.sessions.collection);
      cronAdd("pbmini_sessions_gc", "17 3 * * *", () => require(`${__hooks}/lib/sessions.js`).gc($app));
    }
    $app.onServe().bindFunc((e) => { require(`${__hooks}/lib/mini.js`).onServe(); return e.next(); });
    routerUse(new Middleware((e) => require(`${__hooks}/lib/mini.js`).guardPaths(e), -1100, "pbmini_paths"));
    for (const k in table) {
      const r = table[k];
      // Middleware nativo de PocketBase: cookie del SDK -> e.auth, luego requireAuth/requireSuperuserAuth y bodyLimit.
      const mws = [new Middleware((e) => require(`${__hooks}/lib/mini.js`).cookieAuth(e), -1000, "pbmini_cookie_auth")];
      if (r.auth === "user") mws.push($apis.requireAuth());
      else if (r.auth === "superuser") mws.push($apis.requireSuperuserAuth());
      mws.push($apis.bodyLimit(r.opts.bodyLimit || DEFAULTS.bodyLimit));
      routerAdd(r.method, r.pattern, (e) => require(`${__hooks}/lib/mini.js`).dispatch(e), ...mws);
    }
    const tags = []; // invalidación de la caché de servidor cuando cambia un registro de una colección etiquetada (cualquier origen: API nativa incluida)
    for (const k in table) { const t = table[k].opts.cache && table[k].opts.cache.tags; if (t) t.forEach((x) => { if (tags.indexOf(x) < 0) tags.push(x); }); }
    if (tags.length) {
      const inv = (e) => { require(`${__hooks}/lib/mini.js`).invalidate(e.record.collection().name); return e.next(); };
      onRecordAfterCreateSuccess(inv, ...tags); onRecordAfterUpdateSuccess(inv, ...tags); onRecordAfterDeleteSuccess(inv, ...tags);
      $app.onServe().bindFunc((e) => {
        // una etiqueta sin colección (typo) nunca invalida: por eso cachePut no guarda nada bajo etiquetas inexistentes (falla hacia "sin caché")
        tags.forEach((t) => { try { $app.findCollectionByNameOrId(t); } catch (_) { console.log(`pbmini: AVISO cache.tags usa la colección inexistente "${t}": esas rutas no se cachearán en el servidor`); } });
        return e.next();
      });
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
  const fail = (code, msg, extra) => errorPage(e, route, code) || e.json(code, Object.assign({ error: msg }, extra || {}));
  if (!route) return fail(404, "not found");
  try {
    if (route.opts.access) { // roles / membresías (módulo opcional): antes de leer parámetros, consulta o cuerpo
      const v = mod("access").check(e, route.opts.access);
      if (v) return fail(v.status, v.status === 402 ? "payment required" : v.status === 401 ? "unauthorized" : "forbidden", { code: v.code });
    }
    const params = validateParams(e, route);
    if (!params) return fail(404, "not found");
    const pq = parseQuery(e, route);
    if (pq.err) return fail(pq.err, pq.err === 414 ? "uri too long" : "invalid query", pq.field ? { field: pq.field } : undefined);
    const pb = parseBody(e, route);
    if (pb.err) return fail(400, "invalid body", pb.field ? { field: pb.field } : undefined);
    const state = {};
    if (i18n().enabled()) { // solo Accept-Language, validado contra los archivos existentes; las rutas cacheables lo incluyen en la clave
      state.locale = i18n().negotiate(e.request.header.get("Accept-Language"));
      if (route.opts.cache && i18n().multi()) h.set("Vary", "Accept-Language");
    }
    if (route.opts.cache && route.opts.cache.server && !hasCreds(e)) {
      // clave = sólo valores validados y declarados (nunca URL cruda, Host ni cabeceras)
      state.cacheKey = JSON.stringify([route.key, route.params.map((p) => params[p.name]), Object.keys(route.query).map((n) => (pq.q[n] === undefined ? null : pq.q[n])), state.locale || null]);
      const hit = cacheGet(state.cacheKey);
      if (hit) {
        h.set("Cache-Control", cacheControl(route, 200, false)); h.set("ETag", hit.tag);
        if (matchesEtag(e, hit.tag)) return e.noContent(304);
        return e.blob(200, hit.ctype, toBytes(hit.body));
      }
    }
    return route.handler(buildContext(e, route, params, pq.q, pb.b, state));
  } catch (err) {
    if (err && err.pbminiStatus) { h.set("Cache-Control", "no-store"); return fail(err.pbminiStatus, String(err.message)); }
    $app.logger().error("pbmini handler error", "route", route.key, "error", String(err)); // detalle sólo en logs
    if ($os.getenv("PBMINI_DEBUG") === "1") console.log("pbmini handler error:", route.key, String(err)); // depuración local: también por consola
    h.set("Cache-Control", "no-store");
    return fail(500, "internal error");
  }
}

const OPT_KEYS = ["auth", "params", "query", "body", "queries", "cache", "bodyLimit", "unknownQuery", "allowSystemPrefix", "prefix", "paginate", "mutations", "access"];
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/, COLL_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/, FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
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
  let qspec = opts.query;
  if (opts.paginate !== undefined) { // paginación estándar: añade page / perPage (/ sort) al esquema de query de la ruta
    const pgn = opts.paginate;
    if (method !== "GET") fail("paginate solo en GET");
    if (!pgn || typeof pgn !== "object" || Array.isArray(pgn)) fail("paginate debe ser {perPage, maxPerPage[, sort]}");
    Object.keys(pgn).forEach((k) => { if (["perPage", "maxPerPage", "sort"].indexOf(k) < 0) fail(`paginate: opción desconocida "${k}"`); });
    if (!Number.isInteger(pgn.maxPerPage) || pgn.maxPerPage < 1 || pgn.maxPerPage >= LIM.limit) fail(`paginate.maxPerPage debe ser entero 1..${LIM.limit - 1}`);
    if (!Number.isInteger(pgn.perPage) || pgn.perPage < 1 || pgn.perPage > pgn.maxPerPage) fail("paginate.perPage debe ser entero 1..maxPerPage");
    if (pgn.sort !== undefined && (!Array.isArray(pgn.sort) || pgn.sort.length === 0 || pgn.sort.some((x) => typeof x !== "string" || !/^-?[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x)))) fail("paginate.sort debe ser una lista de campos (con - para descendente)");
    qspec = Object.assign({}, qspec || {});
    ["page", "perPage", "sort"].forEach((k) => { if (hasOwn(qspec, k) && (k !== "sort" || pgn.sort)) fail(`paginate ya define la query "${k}"`); });
    qspec.page = { type: "int", min: 1, max: LIM.page, default: 1 };
    qspec.perPage = { type: "int", min: 1, max: pgn.maxPerPage, default: pgn.perPage };
    if (pgn.sort) qspec.sort = { enum: pgn.sort.slice(), default: pgn.sort[0] };
  }
  if (opts.access !== undefined) { // roles / membresías: solo para rutas de usuario, validado contra pbmini.config.js
    if (opts.auth !== "user") fail("access requiere auth:'user'");
    mod("access").validateSpec(opts.access, fail);
  }
  const query = compileSchema(qspec, fail), body = compileSchema(opts.body, fail);
  for (const k in query) if (query[k].type === "string" && query[k].max > 1000) fail(`límite de ${k} excesivo`);
  if (opts.body && (method === "GET")) fail("GET no admite body");
  const queries = Object.create(null);
  if (opts.queries) for (const name in opts.queries) {
    const d = opts.queries[name];
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) || RESERVED.indexOf(name) >= 0) fail(`nombre de consulta inválido: ${name}`);
    if (!d || typeof d.filter !== "string" || typeof d.collection !== "string") fail(`consulta ${name}: requiere collection y filter (string constante)`);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(d.collection) || /^pbmini_/i.test(d.collection)) fail(`consulta ${name}: colección no permitida (las de sistema "_xxx" y las internas "pbmini_xxx" están vetadas)`);
    if (d.filter.length > 400 || CTRL.test(d.filter)) fail(`consulta ${name}: filtro inválido`);
    const ph = []; d.filter.replace(/\{:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => { if (ph.indexOf(n) < 0) ph.push(n); return ""; });
    const stray = d.filter.replace(/\{:[A-Za-z_][A-Za-z0-9_]*\}/g, "");
    if (/[{}]/.test(stray)) fail(`consulta ${name}: placeholder mal formado`);
    if (d.rule !== undefined && d.rule !== "list" && d.rule !== "view") fail(`consulta ${name}: rule debe ser list|view`);
    const sort = d.sort === undefined ? [] : d.sort;
    if (!Array.isArray(sort) || sort.some((s) => !/^-?[A-Za-z][A-Za-z0-9_]{0,63}(,-?[A-Za-z][A-Za-z0-9_]{0,63}){0,2}$/.test(s))) fail(`consulta ${name}: sort inválido`);
    const filters = Object.create(null);
    if (d.filters !== undefined) {
      if (!d.filters || typeof d.filters !== "object" || Array.isArray(d.filters)) fail(`consulta ${name}: filters debe ser un objeto {clave: "campo = {:v}"}`);
      Object.keys(d.filters).forEach((k) => {
        const fr = d.filters[k];
        if (!NAME_RE.test(k) || RESERVED.indexOf(k) >= 0) fail(`consulta ${name}: nombre de filtro inválido: ${k}`);
        if (typeof fr !== "string" || fr.length > 200 || CTRL.test(fr)) fail(`consulta ${name}: filtro ${k} inválido`);
        if ((fr.match(/\{:v\}/g) || []).length !== 1 || /[{}]/.test(fr.replace("{:v}", ""))) fail(`consulta ${name}: el filtro ${k} debe contener exactamente un {:v} y ningún otro placeholder`);
        filters[k] = fr;
      });
      if (ph.some((n) => /^f_/.test(n))) fail(`consulta ${name}: con filters, los placeholders no pueden empezar por f_`);
    }
    if (opts.paginate && (d.maxLimit || 50) < opts.paginate.maxPerPage + 1) fail(`consulta ${name}: maxLimit debe ser >= paginate.maxPerPage + 1 (se lee una fila de más para calcular hasMore)`);
    queries[name] = { collection: d.collection, filter: d.filter, placeholders: ph, sort, rule: d.rule || "list", maxLimit: Math.min(d.maxLimit || 50, LIM.limit), filters };
  }
  const mutations = Object.create(null);
  if (opts.mutations !== undefined) {
    if (!opts.mutations || typeof opts.mutations !== "object" || Array.isArray(opts.mutations)) fail("mutations debe ser un objeto");
    if (method === "GET") fail("mutations no se permite en GET (CSRF)");
    Object.keys(opts.mutations).forEach((name) => {
      const m = opts.mutations[name];
      if (!NAME_RE.test(name) || RESERVED.indexOf(name) >= 0) fail(`mutación con nombre inválido: ${name}`);
      if (!m || typeof m !== "object") fail(`mutación ${name}: definición inválida`);
      Object.keys(m).forEach((k) => { if (["collection", "op", "fields"].indexOf(k) < 0) fail(`mutación ${name}: opción desconocida "${k}"`); });
      if (typeof m.collection !== "string" || !COLL_RE.test(m.collection) || /^pbmini_/i.test(m.collection)) fail(`mutación ${name}: colección no permitida (las de sistema "_xxx" y las internas "pbmini_xxx" están vetadas)`);
      if (["create", "update", "delete"].indexOf(m.op) < 0) fail(`mutación ${name}: op debe ser create|update|delete`);
      if (m.op === "delete") { if (m.fields !== undefined) fail(`mutación ${name}: delete no lleva fields`); }
      else {
        if (!Array.isArray(m.fields) || m.fields.length === 0 || m.fields.length > 32) fail(`mutación ${name}: fields requerido (lista blanca de 1..32 campos)`);
        m.fields.forEach((f) => { if (typeof f !== "string" || !FIELD_RE.test(f) || RESERVED.indexOf(f) >= 0 || FORBIDDEN_FIELDS.indexOf(f) >= 0) fail(`mutación ${name}: campo no permitido: ${f}`); });
        if (new Set(m.fields).size !== m.fields.length) fail(`mutación ${name}: campos repetidos`);
      }
      mutations[name] = { collection: m.collection, op: m.op, fields: m.fields ? m.fields.slice() : [] };
    });
  }
  const c = opts.cache;
  if (c) {
    if (c.tags !== undefined) {
      if (!c.server) fail("cache.tags requiere cache.server (no hay nada que invalidar en la caché del navegador)");
      if (!Array.isArray(c.tags) || c.tags.length === 0 || c.tags.length > 8 || c.tags.some((t) => typeof t !== "string" || !COLL_RE.test(t) || /^pbmini_/i.test(t))) fail("cache.tags debe ser una lista de 1..8 nombres de colección");
    }
    Object.keys(c).forEach((k) => { if (["maxAge", "server", "shared", "tags"].indexOf(k) < 0) fail(`cache: opción desconocida "${k}"`); });
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
  table[key] = { key, method, pattern, auth: opts.auth, opts, handler, params, paramTypes, query, body, queries, mutations, page: internal && internal.page };
}

// No hay registro global de rutas (routes.js): cada ruta es un archivo de pages/ (lib/pages.js llama a route()).
// Al servir (tras las migraciones): crea la colección de sesiones si hace falta y comprueba que los campos de acceso existan.
function onServe() {
  const warnOnly = $os.getenv("PBMINI_ON_ERROR") === "warn";
  const attempt = (label, fn) => { try { fn(); } catch (err) { console.log(`pbmini: ${label}: ${String(err)}`); if (!warnOnly) $os.exit(1); } };
  const conf = mod("config").load();
  if (conf.sessions.enabled) attempt("sessions", () => { mod("sessions").ensure($app); console.log(`pbmini: sessions activo; ${mod("sessions").loadDeny($app)} sesiones vetadas recargadas`); });
  if (conf.access.enabled) attempt("access", () => mod("access").validateSchema($app));
}

// Tabla de rutas como datos puros (sin funciones): la consumen pbmini:routes, el fuzzer guiado por definiciones y la prueba de tipos.
function routeTable() {
  load();
  const fields = (s) => { const o = {}; for (const k of Object.keys(s)) o[k] = describeField(s[k]); return o; };
  return Object.keys(table).sort().map((k) => {
    const r = table[k], c = r.opts.cache;
    return {
      key: r.key, method: r.method, pattern: r.pattern, auth: r.auth,
      params: r.params.map((p) => ({ name: p.name, wildcard: p.wildcard, spec: r.paramTypes[p.name] ? describeField(r.paramTypes[p.name]) : null })),
      query: fields(r.query), body: fields(r.body), queries: Object.keys(r.queries),
      cache: c ? { maxAge: c.maxAge, server: !!c.server, tags: c.tags || [] } : null,
      access: r.opts.access || null, paginate: r.opts.paginate || null, mutations: Object.keys(r.mutations).map((n) => ({ name: n, collection: r.mutations[n].collection, op: r.mutations[n].op, fields: r.mutations[n].fields })), bodyLimit: r.opts.bodyLimit || DEFAULTS.bodyLimit,
      unknownQuery: r.opts.unknownQuery || "reject", html: !!(r.page && r.page.html),
    };
  });
}

module.exports = { setRootError, onServe, dispatch, register, route, cookieAuth, guardPaths, routeTable, invalidate: invalidateTag };
