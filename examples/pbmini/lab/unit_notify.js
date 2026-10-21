// Pruebas unitarias de pb_hooks/lib/notify.js (sin PocketBase): node unit_notify.js <ruta a pb_hooks>. Imprime {total, bad, groups}.
// config.js y telegram.js se SUSTITUYEN por dobles en un directorio temporal (notify.js los carga con require(`${__hooks}/lib/…`)).
const fs = require("fs"), os = require("os"), path = require("path");
const real = path.resolve(process.argv[2]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pbn-")); fs.mkdirSync(path.join(tmp, "lib"));
fs.writeFileSync(path.join(tmp, "lib", "config.js"), "module.exports = { load: () => globalThis.__CFG };");
fs.writeFileSync(path.join(tmp, "lib", "telegram.js"), "module.exports = { send: (app, to, msg, opt) => { globalThis.__CALLS.push({ app, to, msg, opt }); return { status: 'sent' }; } };");
globalThis.$app = { id: "app" }; globalThis.__hooks = tmp; globalThis.__CALLS = []; globalThis.__CFG = { telegram: { enabled: true } };
const N = require(path.join(real, "lib", "notify.js"));

const groups = {}; let cur;
const group = (n) => { cur = groups[n] = { pass: 0, fail: [] }; };
const eq = (l, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) cur.pass++; else cur.fail.push(`${l}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); };
const ok = (l, c) => { if (c) cur.pass++; else cur.fail.push(l); };
const throws = (l, fn) => { try { fn(); cur.fail.push(`${l}: debía lanzar`); } catch (_) { cur.pass++; } };
const route = (method, auth) => ({ method, auth });
const ID = "abcdefghij01234", authE = { auth: { id: ID }, hasSuperuserAuth: () => false }, suE = { auth: { id: "su" }, hasSuperuserAuth: () => true }, anonE = { auth: null, hasSuperuserAuth: () => false };
const on = () => { globalThis.__CFG = { telegram: { enabled: true } }; globalThis.__CALLS = []; }, off = () => { globalThis.__CFG = { telegram: { enabled: false } }; globalThis.__CALLS = []; };

group("destino");
eq("user válido", N.target({ user: ID }, null), { user: ID }); eq("group válido", N.target({ group: "staff" }, null), { group: "staff" }); eq("ops válido", N.target({ ops: true }, null), { ops: true });
eq("«me» usa el id del usuario autenticado", N.target({ user: "me" }, authE), { user: ID });
for (const [l, t] of [["nulo", null], ["undefined", undefined], ["texto", "me"], ["número", 5], ["arreglo", [{ user: ID }]], ["vacío", {}], ["dos claves", { user: ID, group: "staff" }], ["dos claves (ops)", { user: ID, ops: true }], ["clave desconocida", { canal: "x" }], ["clave desconocida con user", { user: ID, extra: 1 }],
  ["user corto", { user: "abc" }], ["user largo", { user: ID + "x" }], ["user mayúsculas", { user: ID.toUpperCase() }], ["user con espacio", { user: ID.slice(0, 14) + " " }], ["user traversal", { user: "../../x/../etc" }], ["user numérico", { user: 5 }], ["user nulo", { user: null }], ["user arreglo", { user: [ID] }], ["user objeto", { user: {} }], ["user «ME»", { user: "ME" }], ["user « me»", { user: " me" }],
  ["group mayúsculas", { group: "STAFF" }], ["group vacío", { group: "" }], ["group con espacio", { group: "a b" }], ["group largo", { group: "a".repeat(33) }], ["group con punto", { group: "a.b" }], ["group numérico", { group: 5 }], ["group nulo", { group: null }], ["group empieza por _", { group: "_x" }], ["group traversal", { group: "../x" }],
  ["ops false", { ops: false }], ["ops texto", { ops: "true" }], ["ops 1", { ops: 1 }], ["ops nulo", { ops: null }], ["ops arreglo", { ops: [true] }]]) throws("destino inválido: " + l, () => N.target(t, authE));
throws("«me» sin evento", () => N.target({ user: "me" }, null)); throws("«me» anónimo", () => N.target({ user: "me" }, anonE)); throws("«me» de un superusuario", () => N.target({ user: "me" }, suE));
ok("el destino devuelto es una copia limpia (sin claves extra)", Object.keys(N.target({ group: "staff" }, null)).join() === "group");
const proto = JSON.parse('{"__proto__": {"user": "x"}}'); throws("clave __proto__", () => N.target(proto, null));

group("mensaje");
eq("texto simple", N.message("hola"), { text: "hola" }); const o = { title: "T", text: "x", key: "k" }; ok("un objeto pasa tal cual", N.message(o) === o);
eq("texto vacío se normaliza (lo rechaza el canal)", N.message(""), { text: "" });

group("despacho");
on(); let r = N.send({}, { user: ID }, "hola", { key: "k1" });
eq("send llama al canal una vez", globalThis.__CALLS.length, 1); eq("destino al canal", globalThis.__CALLS[0].to, { user: ID }); eq("mensaje normalizado", globalThis.__CALLS[0].msg, { text: "hola" }); eq("opciones", globalThis.__CALLS[0].opt, { key: "k1" }); eq("resultado por canal", r, { telegram: { status: "sent" } });
on(); N.send({}, { group: "staff" }, { title: "A", text: "b" }); eq("objeto de mensaje intacto", globalThis.__CALLS[0].msg, { title: "A", text: "b" });
on(); N.send({}, { ops: true }, "x"); eq("ops", globalThis.__CALLS[0].to, { ops: true });
on(); throws("send con destino inválido no llama al canal", () => N.send({}, { user: "x" }, "m")); eq("0 llamadas tras destino inválido", globalThis.__CALLS.length, 0);
on(); throws("send con «me» fuera de una ruta (hook/cron) falla", () => N.send({}, { user: "me" }, "m")); eq("0 llamadas con «me» fuera de ruta", globalThis.__CALLS.length, 0);
off(); throws("sin canales habilitados lanza", () => N.send({}, { ops: true }, "x")); eq("0 llamadas sin canal", globalThis.__CALLS.length, 0); eq("channels() vacío", N.channels(), []);
on(); eq("channels() con telegram", N.channels(), ["telegram"]);

group("rutas (ctx.notify)");
on(); eq("ruta POST autenticada", N.ctxSend(authE, route("POST", "user"), { user: "me" }, "hola"), { telegram: { status: "sent" } }); eq("«me» se resolvió al usuario", globalThis.__CALLS[0].to, { user: ID });
for (const [l, rt] of [["GET", route("GET", "user")], ["ruta pública", route("POST", "public")], ["GET y pública", route("GET", "public")]]) { on(); throws("ctx.notify en " + l, () => N.ctxSend(authE, rt, { user: "me" }, "x")); eq("0 llamadas en " + l, globalThis.__CALLS.length, 0); }
on(); N.ctxSend(suE, route("POST", "superuser"), { ops: true }, "x"); eq("un superusuario puede avisar a operadores", globalThis.__CALLS.length, 1);
on(); throws("un superusuario no puede usar «me»", () => N.ctxSend(suE, route("POST", "superuser"), { user: "me" }, "x"));
on(); throws("destino inválido en una ruta", () => N.ctxSend(authE, route("POST", "user"), { user: ID, group: "g" }, "x")); eq("0 llamadas", globalThis.__CALLS.length, 0);
off(); throws("sin canales en una ruta", () => N.ctxSend(authE, route("POST", "user"), { user: "me" }, "x"));
on(); ok("PUT/PATCH/DELETE sí se permiten", [route("PUT", "user"), route("PATCH", "user"), route("DELETE", "user")].every((rt) => { try { N.ctxSend(authE, rt, { user: "me" }, "x"); return true; } catch (_) { return false; } }));

fs.rmSync(tmp, { recursive: true, force: true });
const out = {}; let total = 0, bad = 0;
for (const [k, g] of Object.entries(groups)) { out[k] = g; total += g.pass; bad += g.fail.length; }
console.log(JSON.stringify({ total, bad, groups: out })); process.exit(bad ? 1 : 0);
