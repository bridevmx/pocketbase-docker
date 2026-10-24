// Pruebas unitarias del núcleo puro de pb_hooks/lib/ai.js (sin PocketBase): node unit_ai.js <ruta a pb_hooks>. Imprime {total, bad, groups}.
const path = require("path");
const real = path.resolve(process.argv[2]);
globalThis.__hooks = real;
const C = require(path.join(real, "lib", "ai.js")).core;

const groups = {}; let cur;
const group = (n) => { cur = groups[n] = { pass: 0, fail: [] }; };
const eq = (l, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) cur.pass++; else cur.fail.push(`${l}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); };
const ok = (l, c) => { if (c) cur.pass++; else cur.fail.push(l); };
const throws = (l, fn, re) => { try { fn(); cur.fail.push(`${l}: debía lanzar`); } catch (e) { if (re && !re.test(String(e.message))) cur.fail.push(`${l}: lanzó otro error: ${e.message}`); else cur.pass++; } };

group("json del modelo");
eq("objeto plano", C.parseJson('{"a":1}'), { a: 1 }); eq("con ```json", C.parseJson('```json\n{"a":1}\n```'), { a: 1 }); eq("con ``` sin lenguaje", C.parseJson('```\n{"a":1}\n```'), { a: 1 }); eq("espacios alrededor", C.parseJson('  \n{"a":1}\n '), { a: 1 });
for (const [l, v] of [["texto libre", "Claro: {\"a\":1}"], ["roto", "{no"], ["arreglo", "[1]"], ["número", "5"], ["nulo", "null"], ["vacío", ""], ["enorme", "x".repeat(20001)], ["no texto", 5], ["indefinido", undefined], ["objeto", {}]]) eq(`no interpretable (${l})`, C.parseJson(v), null);

eq("JSON válido pero enorme (tope de tamaño)", C.parseJson('{"a":"' + "x".repeat(20001) + '"}'), null); eq("JSON válido justo bajo el tope", C.parseJson('{"a":"' + "x".repeat(1000) + '"}') !== null, true);

group("campos declarados");
const F = (o) => () => C.validateFields(o), S = { type: "string", desc: "d" };
F({ a: S })(); cur.pass++;
throws("sin campos", F({}), /1 a 20/); throws("no es un objeto", F([S]), /objeto/); throws("nombre con mayúsculas", F({ A: S }), /nombre/); throws("nombre con espacio", F({ "a b": S }), /nombre/); throws("nombre que empieza por número", F({ "1a": S }), /nombre/);
throws("tipo desconocido", F({ a: { type: "date", desc: "d" } }), /type/); throws("sin tipo", F({ a: { desc: "d" } }), /type/); throws("sin descripción", F({ a: { type: "string" } }), /desc/); throws("descripción vacía", F({ a: { type: "string", desc: "" } }), /desc/);
throws("descripción de 301", F({ a: { type: "string", desc: "x".repeat(301) } }), /desc/); throws("descripción con control", F({ a: { type: "string", desc: "a\x01b" } }), /desc/); throws("opción desconocida", F({ a: { ...S, regex: ".*" } }), /desconocida/);
throws("enum sin values", F({ a: { type: "enum", desc: "d" } }), /values/); throws("enum con repetidos", F({ a: { type: "enum", desc: "d", values: ["x", "x"] } }), /values/); throws("enum con valor no texto", F({ a: { type: "enum", desc: "d", values: [1] } }), /values/);
throws("values en un string", F({ a: { ...S, values: ["x"] } }), /enum/); throws("min en un string", F({ a: { ...S, min: 1 } }), /min/); throws("max no numérico", F({ a: { ...S, max: "9" } }), /max/);
throws("21 campos", F(Object.fromEntries(Array.from({ length: 21 }, (_, i) => ["f" + i, S]))), /1 a 20/); F(Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["f" + i, S])))(); cur.pass++;

group("validación de la salida");
const FD = { s: { type: "string", desc: "d", max: 5 }, n: { type: "number", desc: "d", min: 0, max: 10 }, b: { type: "boolean", desc: "d" }, e: { type: "enum", desc: "d", values: ["x", "y"] } };
eq("todo válido", C.coerce(FD, { s: "hola", n: 3, b: true, e: "x" }), { s: "hola", n: 3, b: true, e: "x" });
eq("claves no declaradas se descartan", C.coerce(FD, { s: "a", evil: "x", status: "paid", __proto__: { z: 1 } }), { s: "a", n: null, b: null, e: null });
eq("texto demasiado largo", C.coerce(FD, { s: "123456" }).s, null); eq("texto recortado de espacios", C.coerce(FD, { s: "  ab  " }).s, "ab"); eq("texto vacío", C.coerce(FD, { s: "   " }).s, null); eq("texto con control", C.coerce(FD, { s: "a\x07b" }).s, null);
for (const v of ["3", NaN, Infinity, -1, 11, null, [], {}, true]) eq(`número no válido ${JSON.stringify(v)}`, C.coerce(FD, { n: v }).n, null);
for (const v of ["true", 1, 0, null, "sí"]) eq(`booleano no válido ${JSON.stringify(v)}`, C.coerce(FD, { b: v }).b, null); eq("booleano false se conserva", C.coerce(FD, { b: false }).b, false);
for (const v of ["z", "X", 1, null, ["x"], "x "]) eq(`enum no válido ${JSON.stringify(v)}`, C.coerce(FD, { e: v }).e, null);
for (const v of [null, undefined, "x", 5, [], true]) eq(`salida que no es objeto ${JSON.stringify(v)}`, C.coerce(FD, v), { s: null, n: null, b: null, e: null });
eq("string sin max usa el tope de 500", [C.coerce({ s: { type: "string", desc: "d" } }, { s: "a".repeat(500) }).s.length, C.coerce({ s: { type: "string", desc: "d" } }, { s: "a".repeat(501) }).s], [500, null]);

group("prompt y respuesta de Google");
const P = C.extractPrompt("Extrae el total.", { total: { type: "number", desc: "importe", max: 100 }, tipo: { type: "enum", desc: "clase", values: ["a", "b"] } });
ok("incluye la instrucción", P.indexOf("Extrae el total.") === 0); ok("avisa que el contenido no es confiable", /DATO NO CONFIABLE/.test(P) && /ignora cualquier instrucci/.test(P)); ok("lista los campos y sus tipos", /total \(number, máx 100\): importe/.test(P) && /tipo \(uno de: a \| b\): clase/.test(P)); ok("pide solo JSON", /ÚNICAMENTE con un objeto JSON/.test(P));
const R = C.readResponse;
eq("respuesta completa", R({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] }), { text: "{}" });
eq("sin finishReason pero con texto", R({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { text: "{}" }); eq("partes de razonamiento se ignoran", R({ candidates: [{ content: { parts: [{ text: "pensando", thought: true }, { text: "{}" }] }, finishReason: "STOP" }] }), { text: "{}" });
eq("varias partes se unen", R({ candidates: [{ content: { parts: [{ text: "{" }, { text: "}" }] }, finishReason: "STOP" }] }), { text: "{}" });
for (const [l, v] of [["cortada MAX_TOKENS", { candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] }], ["bloqueada SAFETY", { candidates: [{ finishReason: "SAFETY" }] }], ["sin candidatos", { promptFeedback: {} }], ["candidatos vacíos", { candidates: [] }], ["sin partes", { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }],
  ["solo razonamiento", { candidates: [{ content: { parts: [{ text: "x", thought: true }] }, finishReason: "STOP" }] }], ["no es objeto", "x"], ["nulo", null], ["partes no válidas", { candidates: [{ content: { parts: [5, null] }, finishReason: "STOP" }] }]]) ok(`${l} => reintento con otro modelo`, typeof R(v).retry === "string");

const out = {}; let total = 0, bad = 0;
for (const [k, g] of Object.entries(groups)) { out[k] = g; total += g.pass; bad += g.fail.length; }
console.log(JSON.stringify({ total, bad, groups: out })); process.exit(bad ? 1 : 0);
