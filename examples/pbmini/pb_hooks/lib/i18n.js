// Internacionalización mínima y segura. Traducciones en pb_hooks/i18n/<idioma>.json (claves planas, texto con {variables}).
//  - El idioma SOLO sale de Accept-Language, validado y comparado con la lista de archivos existentes (nunca se usa como ruta).
//  - Todos los idiomas deben tener las mismas claves y las mismas {variables}: si no, el registro aborta (fail-closed).
//  - Las traducciones son texto: en plantillas HTML pasan por el autoescape (no hay `raw`); las {variables} se sustituyen una sola vez y de forma literal.
//  - Sin la carpeta i18n/ el módulo está apagado y ctx.t lanza un error claro.
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const VAR_RE = /\{([a-z_][a-z0-9_]*)\}/g;
const BADCHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f�]/;
const LIM = { file: 256 * 1024, value: 2000, keys: 2000 };
const RESERVED = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (m) => { throw new Error("pbmini i18n: " + m); };
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };

let _state = null; // por runtime (cada VM del pool lo calcula una vez)
function vars(s) { const out = []; s.replace(VAR_RE, (_, n) => { if (out.indexOf(n) < 0) out.push(n); return ""; }); return out.sort(); }

function load() {
  if (_state) return _state;
  const st = { names: [], tables: Object.create(null), lower: Object.create(null), def: null };
  const dir = `${__hooks}/i18n`;
  if (!exists(dir)) return (_state = st);
  const ents = $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of ents) {
    if (e.name.charAt(0) === ".") continue;
    if (e.dir || e.type !== 0) fail(`i18n/${e.name}: solo archivos .json regulares`);
    const m = /^(.+)\.json$/.exec(e.name);
    if (!m || !LOCALE_RE.test(m[1])) fail(`i18n/${e.name}: el nombre debe ser <idioma>.json (p. ej. es.json, en.json, pt-BR.json)`);
    const txt = toString($os.readFile(`${dir}/${e.name}`));
    if (txt.length > LIM.file) fail(`i18n/${e.name}: archivo demasiado grande`);
    let obj; try { obj = JSON.parse(txt); } catch (err) { fail(`i18n/${e.name}: JSON inválido`); }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) fail(`i18n/${e.name}: la raíz debe ser un objeto {clave: texto}`);
    const keys = Object.keys(obj);
    if (keys.length > LIM.keys) fail(`i18n/${e.name}: demasiadas claves`);
    const tbl = Object.create(null);
    keys.forEach((k) => {
      if (!KEY_RE.test(k) || RESERVED.indexOf(k) >= 0) fail(`i18n/${e.name}: clave no permitida "${k}"`);
      const v = obj[k];
      if (typeof v !== "string" || v.length > LIM.value || BADCHAR.test(v)) fail(`i18n/${e.name}: el valor de "${k}" debe ser texto (máx. ${LIM.value}) sin caracteres de control`);
      tbl[k] = v;
    });
    st.names.push(m[1]); st.tables[m[1]] = tbl; st.lower[m[1].toLowerCase()] = m[1];
  }
  if (st.names.length) {
    const base = st.names[0], bk = Object.keys(st.tables[base]).sort();
    st.names.forEach((n) => {
      const ks = Object.keys(st.tables[n]).sort();
      if (ks.join("\n") !== bk.join("\n")) fail(`i18n/${n}.json y i18n/${base}.json no tienen las mismas claves`);
      ks.forEach((k) => { if (vars(st.tables[n][k]).join(",") !== vars(st.tables[base][k]).join(",")) fail(`i18n: la clave "${k}" usa {variables} distintas en ${n} y ${base}`); });
    });
    const want = $os.getenv("PBMINI_DEFAULT_LOCALE");
    if (want) { if (st.names.indexOf(want) < 0) fail(`PBMINI_DEFAULT_LOCALE=${want} no existe en i18n/`); st.def = want; } else st.def = st.names[0];
    // idioma sin región como alias del primero con región (pt => pt-BR) si no existe el simple
    st.names.forEach((n) => { const p = n.split("-")[0]; if (!hasOwn(st.lower, p)) st.lower[p] = n; });
  }
  return (_state = st);
}

const enabled = () => load().names.length > 0;
const multi = () => load().names.length > 1;

// Accept-Language => idioma disponible. Entrada acotada: ≤256 caracteres, ≤16 etiquetas, q en 0..1; lo demás se ignora.
function negotiate(header) {
  const st = load();
  if (!st.names.length) return null;
  if (typeof header !== "string" || header.length === 0 || header.length > 256) return st.def;
  const parts = header.split(",", 16), cands = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^\s*([A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,2})\s*(?:;\s*q\s*=\s*(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)\s*)?$/.exec(parts[i]);
    if (!m) continue;
    const q = m[2] === undefined ? 1 : Number(m[2]);
    if (q > 0) cands.push({ tag: m[1].toLowerCase(), q, i });
  }
  cands.sort((a, b) => b.q - a.q || a.i - b.i);
  for (const c of cands) {
    if (hasOwn(st.lower, c.tag)) return st.lower[c.tag];
    const p = c.tag.split("-")[0];
    if (hasOwn(st.lower, p)) return st.lower[p];
  }
  return st.def;
}

// Texto de `key` en `locale`; {nombre} se sustituye con vars[nombre] una sola vez y sin interpretar patrones ($&, $1...).
function t(locale, key, v) {
  const st = load();
  if (!st.names.length) fail("no hay traducciones (crea pb_hooks/i18n/<idioma>.json)");
  const tbl = st.tables[locale];
  if (!tbl) fail("idioma desconocido");
  if (typeof key !== "string" || !hasOwn(tbl, key)) return String(key); // clave ausente: se muestra la clave (visible en pruebas), nunca un error de servidor
  const s = tbl[key];
  if (!v || typeof v !== "object") return s;
  return s.replace(VAR_RE, (m, n) => (hasOwn(v, n) ? String(v[n]) : m));
}
const table = (locale) => Object.assign({}, load().tables[locale] || {});

module.exports = { load, enabled, multi, negotiate, t, table };
