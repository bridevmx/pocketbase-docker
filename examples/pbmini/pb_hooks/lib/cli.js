// Comandos de consola (corren en un proceso aparte del `serve`; PocketBase carga también los hooks, así que
// si alguna página es inválida el registro aborta antes de llegar aquí: es el comportamiento fail-closed deseado).
//   ./pocketbase pbmini:routes                          tabla de rutas como JSON entre marcadores (la usan el fuzzer guiado y los tipos)
//   ./pocketbase pbmini:new page|endpoint <ruta> [métodos]   crea pages/<ruta>.js (+ .html si es page); métodos: get,post,put,patch,delete
//   ./pocketbase pbmini:new schema <nombre>              crea pages/_schemas/<nombre>.js
// Ejemplos:  pbmini:new endpoint users/[id]/update post     pbmini:new page blog/[slug]     pbmini:new page docs/   (index de la carpeta)
const MARK = "PBMINI_ROUTES_JSON";
const names = () => require(`${__hooks}/lib/names.js`);
const fail = (m) => { throw new Error("pbmini:new: " + m); };
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
const METHODS = ["get", "post", "put", "patch", "delete"];

function routes() {
  const t = require(`${__hooks}/lib/mini.js`).routeTable();
  console.log(MARK + "_BEGIN\n" + JSON.stringify(t) + "\n" + MARK + "_END");
}

// ¿"users/[id]/update" => carpetas ["users","[id]"] + archivo "update"? Una ruta que termina en "/" (o vacía) es el index de la carpeta;
// un último segmento [param] también es carpeta (los parámetros siempre son carpetas) y lleva index.
function plan(path) {
  if (typeof path !== "string" || path.length > 200 || /[\x00-\x1f\x7f\\]/.test(path)) fail("ruta inválida");
  const raw = path.replace(/^\/+/, ""), isIndex = raw === "" || /\/$/.test(raw);
  const segs = raw.split("/").filter((x, i, a) => !(x === "" && i === a.length - 1));
  if (segs.length > 8) fail("máximo 8 niveles");
  const N = names(), dirs = [], params = [];
  let file = "index", wild = false;
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s === "") fail("segmento vacío");
    if (last && !isIndex && !/^\[/.test(s)) { if (!N.fileSegment(s)) fail(`nombre de archivo no permitido "${s}" (minúsculas, dígitos, _ . -)`); file = s; return; }
    const d = N.dirSegment(s);
    if (!d) fail(`nombre de carpeta no permitido "${s}" (minúsculas, dígitos, _ . -  o [param])`);
    if (wild) fail("dentro de [...comodín] solo puede haber index");
    if (d.wild) { if (!last) fail("[...x] solo puede ser el último segmento"); wild = true; }
    if (d.param) { if (params.indexOf(d.param) >= 0) fail(`parámetro repetido: ${d.param}`); params.push(d.param); }
    dirs.push(s);
  });
  return { dirs, file, params, wild };
}
const paramSpec = (p) => (p === "id" ? '"id"' : p === "slug" ? '"slug"' : p === "uuid" ? '"uuid"' : '{ type: "string", max: 64 }');

function jsTemplate(pl, kind, methods) {
  const prefix = "../".repeat(pl.dirs.length + 1) + "types/pbmini";
  const writes = methods.some((m) => m !== "get");
  const out = ['/** @type {import("' + prefix + '").Route} */', "module.exports = {",
    '  auth: "user", // por defecto exige sesión (deny-by-default); cambia a "public" solo si es intencional'];
  if (pl.params.length && !pl.wild) out.push("  params: { " + pl.params.map((p) => `${p}: ${paramSpec(p)}`).join(", ") + " },");
  if (methods.indexOf("get") >= 0) out.push("  query: {}, // contrato de la query string: { nombre: \"int\" | { type: \"string\", max: 50 } | ... }");
  if (writes) out.push("  body: { /* campo: { type: \"string\", max: 100, required: true } */ },");
  methods.forEach((m) => {
    if (kind === "page" && m === "get") out.push("  get: (ctx) => ({ title: \"" + pl.file + "\" }), // el objeto devuelto se renderiza en el .html");
    else if (m === "get") out.push("  get: (ctx) => ({ ok: true }),");
    else out.push(`  ${m}: (ctx) => ctx.json({ ok: true }),`);
  });
  out.push("};", "");
  return out.join("\n");
}
const htmlTemplate = (pl) => "<h1>{{.title}}</h1>\n" + (pl.params.length ? pl.params.map((p) => `<p>${p}: {{.Params.${p}}}</p>`).join("\n") + "\n" : "");

function create(args) {
  args = (args || []).map(String);
  const kind = args[0];
  const root = `${__hooks}/pages`;
  if (!exists(root)) fail("no existe pb_hooks/pages");
  if (kind === "schema") {
    const nm = args[1];
    if (!nm || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(nm)) fail("nombre de esquema inválido (minúsculas, dígitos, _ -)");
    const dir = `${root}/_schemas`, file = `${dir}/${nm}.js`;
    if (exists(file)) fail(`ya existe ${file}`);
    $os.mkdirAll(dir, 0o755);
    $os.writeFile(file, '/** Esquema reutilizable: úsalo con `body: "' + nm + '"` / `query: "' + nm + '"` */\nmodule.exports = {\n  // campo: { type: "string", max: 100, required: true },\n};\n', 0o644);
    console.log("creado " + file); return;
  }
  if (kind !== "page" && kind !== "endpoint") fail("uso: pbmini:new page|endpoint <ruta> [métodos] | pbmini:new schema <nombre>");
  const pl = plan(args[1] === undefined ? "" : args[1]);
  const methods = (args[2] || "get").split(",").map((x) => x.trim().toLowerCase());
  if (methods.length === 0 || methods.length > 5 || new Set(methods).size !== methods.length || methods.some((m) => METHODS.indexOf(m) < 0)) fail("métodos inválidos (get,post,put,patch,delete)");
  if (pl.wild && methods.some((m) => m !== "get")) fail("una ruta [...comodín] suele ser de lectura; escribe el archivo a mano si de verdad la necesitas");
  const dir = [root].concat(pl.dirs).join("/"), js = `${dir}/${pl.file}.js`, html = `${dir}/${pl.file}.html`;
  // la misma ruta no puede existir como x.js y como x/index.js (duplicado): se comprueban las dos formas
  const twin = pl.file === "index" ? (pl.dirs.length ? `${[root].concat(pl.dirs.slice(0, -1)).join("/")}/${pl.dirs[pl.dirs.length - 1]}.js` : null) : `${dir}/${pl.file}/index.js`;
  [js, html, twin].forEach((f) => { if (f && exists(f)) fail(`ya existe ${f} (no se sobrescribe nada)`); });
  $os.mkdirAll(dir, 0o755);
  $os.writeFile(js, jsTemplate(pl, kind, methods), 0o644);
  console.log("creado " + js);
  if (kind === "page") { $os.writeFile(html, htmlTemplate(pl), 0o644); console.log("creado " + html); }
}
// pbmini:access rules  -> reglas de PocketBase equivalentes a la configuración `access` (para proteger también la API nativa)
function access(args) {
  if ((args || [])[0] !== "rules") fail("uso: pbmini:access rules");
  const t = require(`${__hooks}/lib/mini.js`).routeTable();
  require(`${__hooks}/lib/access.js`).rules(t).forEach((l) => console.log(l));
}
module.exports = { routes, create, access };
