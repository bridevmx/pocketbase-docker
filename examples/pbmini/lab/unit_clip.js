// Pruebas unitarias del núcleo puro de pb_hooks/lib/clip.js (sin PocketBase): node unit_clip.js <ruta a pb_hooks>. Imprime un JSON {groups:{nombre:{pass,fail:[...]}}}.
// Los globals de PocketBase que usa el núcleo ($security.hs256/equal) se simulan con `crypto` de Node (hs256 de PocketBase = HMAC-SHA256 en hexadecimal).
const crypto = require("crypto");
const path = require("path");
globalThis.$security = {
  hs256: (m, k) => crypto.createHmac("sha256", k).update(m).digest("hex"),
  equal: (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)),
};
globalThis.$os = { getenv: () => "" };
globalThis.__hooks = path.resolve(process.argv[2]);
const C = require(path.join(globalThis.__hooks, "lib", "clip.js"));

const groups = {};
let cur;
const group = (name) => { cur = groups[name] = { pass: 0, fail: [] }; };
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) cur.pass++; else cur.fail.push(`${label}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); };
const ok = (label, cond) => { if (cond) cur.pass++; else cur.fail.push(label); };
const throws = (label, fn) => { try { fn(); cur.fail.push(`${label}: debía lanzar`); } catch (_) { cur.pass++; } };

// ------------------------------------------------------------------ estados
group("estados");
for (const [raw, want] of [["CHECKOUT_COMPLETED", "paid"], ["CHECKOUT_CANCELLED", "failed"], ["CHECKOUT_EXPIRED", "expired"], ["CHECKOUT_CREATED", "pending"], ["CHECKOUT_PENDING", "pending"]]) eq(raw, C.mapStatus(raw), want);
for (const raw of ["COMPLETED", "PAID", "paid", "success", "SUCCESS", "checkout_completed", "Checkout_Completed", " CHECKOUT_COMPLETED", "CHECKOUT_COMPLETED ", "CHECKOUT_COMPLETED\n", "CHECKOUT_COMPLETED\u0000", "CHECKOUT_COMPLETEDX", "CHECKOUT_", "", null, undefined, 0, 1, true, false, {}, [], ["CHECKOUT_COMPLETED"], { toString: () => "CHECKOUT_COMPLETED" },
  "__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "CHECKOUT_REFUNDED", "CHECKOUT_FAILED", "APPROVED", "COMPLETED_OK", "ＣHECKOUT_COMPLETED", "CHECKOUT-COMPLETED"]) eq("desconocido " + JSON.stringify(raw), C.mapStatus(raw), "pending");

// ------------------------------------------------------------------ dinero
group("dinero");
for (const [v, want] of [[1, 100], [0, 0], [0.01, 1], [0.1, 10], [0.29, 29], [1.1, 110], [1.15, 115], [1.005, null], [12.3, 1230], [123.45, 12345], [1207.11, 120711], [19.99, 1999], [4.35, 435], [8.2, 820], [100000, 10000000], [999999999.99, 99999999999], [0.3, 30], [0.07, 7], [2.675, null], [1e2, 10000], [10 / 3, null], [0.1 + 0.2, 30]]) eq("pesos " + v, C.toCents(v), want);
for (const [v, want] of [["1", 100], ["1.5", 150], ["1.50", 150], ["123.45", 12345], ["0.01", 1], ["0", 0], ["000123.4", 12340], ["999999999999", null], ["999999999.99", 99999999999], ["1000000000", C.MAX_CENTS], ["1000000000.01", null]]) eq("texto " + v, C.toCents(v), want);
for (const v of [-1, -0.01, NaN, Infinity, -Infinity, 1e300, 1e12, null, undefined, true, false, {}, [], [1], "", " ", "1e2", "1,5", "1.", ".5", "-1", "+1", "1.234", "0x10", "1 ", " 1", "١٢٣", "1\n", "NaN", "Infinity", "12345678901234", 1.0001, 1.001, 2.675, new Number(5), 9007199254740993]) eq("inválido " + String(v), C.toCents(v), null);
for (const c of [0, 1, 9, 10, 99, 100, 101, 12345, 99999, 100000, 1234567, 99999999999, C.MAX_CENTS]) { const p = C.fromCents(c); eq("ida y vuelta " + c, C.toCents(p), c); }
for (let c = 0; c <= 3000; c++) { const p = C.fromCents(c); if (C.toCents(p) !== c) { cur.fail.push("ida y vuelta falla en " + c); break; } } cur.pass++;
for (let i = 0; i < 20000; i++) { const c = Math.floor(Math.random() * 1e9); if (C.toCents(C.fromCents(c)) !== c) { cur.fail.push("ida y vuelta aleatoria falla en " + c); break; } } cur.pass++;
for (const c of [-1, 1.5, NaN, Infinity, "5", null, undefined, C.MAX_CENTS + 1, 1e20, {}, true]) throws("fromCents " + String(c), () => C.fromCents(c));

// ------------------------------------------------------------------ referencia firmada
group("referencia");
const KEY = "Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=", KEY2 = "Basic b3RoZXI6a2V5IQ==", ID = "8jbx6d6d7p8pfmt", ID2 = "abcdefghij01234";
const hexsig = (key, id) => crypto.createHmac("sha256", key).update("payref:v1:" + id).digest("hex").slice(0, 8);
const ref = C.makeReference("PBM", KEY, ID);
eq("formato", ref, `PBM-${ID}-${hexsig(KEY, ID)}`);
ok("cabe en 36 caracteres", ref.length <= 36 && C.makeReference("ABCDEF", KEY, ID).length <= 36);
eq("la reconoce", C.parseReference("PBM", KEY, ref), ID);
ok("estable por pago", C.makeReference("PBM", KEY, ID) === ref);
ok("distinta entre pagos", C.makeReference("PBM", KEY, ID2) !== ref);
ok("distinta con otra clave", C.makeReference("PBM", KEY2, ID) !== ref);
for (const [label, r] of [
  ["firma alterada", ref.slice(0, -1) + (ref.slice(-1) === "0" ? "1" : "0")], ["firma de otro pago", `PBM-${ID}-${hexsig(KEY, ID2)}`], ["id de otro pago con firma de este", `PBM-${ID2}-${hexsig(KEY, ID)}`],
  ["otro prefijo", ref.replace("PBM", "TDA")], ["minúsculas", ref.toLowerCase()], ["mayúsculas", ref.toUpperCase()], ["con espacios", " " + ref], ["con salto", ref + "\n"], ["sin firma", `PBM-${ID}-`], ["firma corta", ref.slice(0, -1)], ["firma larga", ref + "0"],
  ["firma no hex", `PBM-${ID}-zzzzzzzz`], ["id corto", `PBM-${ID.slice(1)}-${hexsig(KEY, ID.slice(1))}`], ["id con mayúsculas", `PBM-${ID.toUpperCase()}-${hexsig(KEY, ID.toUpperCase())}`], ["vacía", ""], ["basura", "x".repeat(40)], ["enorme", ref.repeat(100)],
  ["unicode", ref.replace("P", "Ｐ")], ["nula", null], ["número", 123], ["objeto", {}], ["arreglo", [ref]], ["undefined", undefined]]) eq("rechaza " + label, C.parseReference("PBM", KEY, r), null);
eq("otra clave no la reconoce", C.parseReference("PBM", KEY2, ref), null);
eq("otro prefijo configurado no la reconoce", C.parseReference("TDA", KEY, ref), null);
eq("sin clave", C.parseReference("PBM", "", ref), null); eq("clave corta", C.parseReference("PBM", "abc", ref), null); eq("sin clave (nula)", C.parseReference("PBM", null, ref), null);
for (const pf of ["pbm", "P", "ABCDEFG", "P8M", "", null, "(A)", ".*", "A|B"]) { eq("prefijo inválido al parsear " + pf, C.parseReference(pf, KEY, ref), null); throws("prefijo inválido al crear " + pf, () => C.makeReference(pf, KEY, ID)); }
for (const id of ["", "ABC", "8jbx6d6d7p8pfm", "8jbx6d6d7p8pfmtt", "8JBX6D6D7P8PFMT", "8jbx6d6d7p8pfm-", null, 5, {}]) throws("id inválido al crear " + JSON.stringify(id), () => C.makeReference("PBM", KEY, id));
for (const k of ["", "abc", null, undefined, 5]) throws("clave inválida al crear " + String(k), () => C.makeReference("PBM", k, ID));
// no hay colisiones entre 5000 ids distintos
const seen = new Set(); for (let i = 0; i < 5000; i++) { const id = crypto.randomBytes(8).toString("hex").slice(0, 15).replace(/[^a-z0-9]/g, "a"); seen.add(C.makeReference("PBM", KEY, id)); } ok("referencias únicas", seen.size > 4990);

// ------------------------------------------------------------------ transiciones
group("transiciones");
const ST = ["created", "pending", "paid", "failed", "expired", "review", "refunded"];
const ALLOWED = { created: ["pending", "failed"], pending: ["paid", "failed", "expired", "review"], failed: ["paid", "review"], expired: ["paid", "review"], review: ["paid", "failed"], paid: ["refunded"], refunded: [] };
for (const f of ST) for (const t of ST) eq(`${f} -> ${t}`, C.canTransition(f, t), ALLOWED[f].indexOf(t) >= 0);
for (const x of ["__proto__", "constructor", "toString", "", null, undefined, 5, {}]) { eq("origen raro " + String(x), C.canTransition(x, "paid"), false); eq("destino raro " + String(x), C.canTransition("pending", x), false); }
eq("el sistema llega a paid desde", C.fromStates("paid").sort(), ["expired", "failed", "pending"]);
eq("el sistema llega a failed desde", C.fromStates("failed").sort(), ["created", "pending"]);
eq("el sistema llega a review desde", C.fromStates("review").sort(), ["expired", "failed", "pending"]);
eq("el sistema nunca llega a refunded", C.fromStates("refunded"), []);
eq("el sistema nunca llega a pending desde terminales", C.fromStates("pending"), ["created"]);
ok("review>paid solo operador", C.needsOperator("review", "paid") && C.needsOperator("review", "failed") && C.needsOperator("paid", "refunded") && !C.needsOperator("pending", "paid"));
ok("un estado final no vuelve a pending", ST.every((f) => !C.canTransition(f, "created")) && !C.canTransition("paid", "pending") && !C.canTransition("refunded", "paid"));

// ------------------------------------------------------------------ decide()
group("decide");
const pay = { id: ID, reference: ref, amount: 12345 };
const ctx = (used) => ({ prefix: "PBM", key: KEY, receiptUsedByOther: used || (() => false) });
const good = { status: "paid", amountCents: 12345, currency: "MXN", reference: ref, receiptNo: "PYYz9Ieb" };
eq("todo cuadra", C.decide(pay, good, ctx()), { to: "paid", receiptNo: "PYYz9Ieb" });
eq("pendiente", C.decide(pay, { status: "pending" }, ctx()), { to: "pending" });
eq("cancelado", C.decide(pay, { status: "failed" }, ctx()), { to: "failed" });
eq("vencido", C.decide(pay, { status: "expired" }, ctx()), { to: "expired" });
eq("sin remoto", C.decide(pay, null, ctx()), { to: "pending" }); eq("remoto no objeto", C.decide(pay, "paid", ctx()), { to: "pending" });
eq("estado raro", C.decide(pay, { ...good, status: "COMPLETED" }, ctx()), { to: "pending" });
eq("completado sin recibo", C.decide(pay, { ...good, receiptNo: "" }, ctx()), { to: "pending" });
eq("completado con recibo nulo", C.decide(pay, { ...good, receiptNo: null }, ctx()), { to: "pending" });
const reviewOf = (r) => C.decide(pay, { ...good, ...r }, ctx());
for (const [label, r, frag] of [["monto menor", { amountCents: 100 }, "monto distinto"], ["monto mayor", { amountCents: 99999999 }, "monto distinto"], ["monto +1 centavo", { amountCents: 12346 }, "monto distinto"],
  ["monto nulo", { amountCents: null }, "monto ilegible"], ["monto texto", { amountCents: "12345" }, "monto ilegible"], ["monto decimal", { amountCents: 12345.5 }, "monto ilegible"], ["monto NaN", { amountCents: NaN }, "monto ilegible"],
  ["moneda USD", { currency: "USD" }, "moneda distinta"], ["moneda ausente", { currency: "" }, "moneda distinta"], ["moneda minúsculas", { currency: "mxn" }, "moneda distinta"],
  ["referencia ajena", { reference: "PBM-zzzzzzzzzzzzzzz-00000000" }, "referencia distinta"], ["referencia de otro pago con firma válida", { reference: C.makeReference("PBM", KEY, ID2) }, "referencia distinta"],
  ["referencia ausente", { reference: "" }, "referencia distinta"], ["referencia nula", { reference: null }, "referencia distinta"], ["referencia con firma de otra clave", { reference: C.makeReference("PBM", KEY2, ID) }, "referencia distinta"]]) {
  const d = reviewOf(r); ok(`${label} => review (no paid ni failed)`, d.to === "review" && (d.note || "").indexOf(frag) >= 0 && d.receiptNo === undefined);
}
const multi = reviewOf({ amountCents: 1, currency: "USD", reference: "x" }); ok("varios problemas juntos", multi.to === "review" && /referencia/.test(multi.note) && /monto/.test(multi.note) && /moneda/.test(multi.note));
for (const rn of ["a b", "x".repeat(65), "rec/1", "rec\n", "é", 5, {}, ["a"]]) { const d = reviewOf({ receiptNo: rn }); ok("recibo inválido " + JSON.stringify(rn), d.to === "review"); }
eq("recibo duplicado", C.decide(pay, good, ctx(() => true)), { to: "review", note: "recibo ya usado por otro pago" });
let asked = null; C.decide(pay, good, ctx((r) => { asked = r; return false; })); eq("pregunta por el recibo exacto", asked, "PYYz9Ieb");
let askedOnMismatch = false; C.decide(pay, { ...good, amountCents: 1 }, ctx(() => { askedOnMismatch = true; return false; })); ok("con anomalía no consulta recibos", !askedOnMismatch);
ok("la nota nunca pasa de 255 caracteres ni lleva controles", (() => { const d = reviewOf({ reference: "\n".repeat(500) }); return typeof d.note === "string" && d.note.length <= 255 && !/[\x00-\x1f]/.test(d.note); })());
// propiedad: con CUALQUIER mutación de un solo campo del caso bueno, jamás sale `paid`
const muts = { status: ["pending", "failed", "expired", "x", null, undefined, 5], amountCents: [0, 1, 12344, 12346, -12345, null, "12345", 12345.0001, Infinity], currency: ["USD", "", null, "MXN ", "mxn", undefined],
  reference: ["", null, "PBM", "PBM-" + ID, ref + "x", ref.slice(1), ref.replace(ID, ID2), undefined], receiptNo: ["", null, undefined, "a b", 0, "x".repeat(70)] };
let allSafe = true, count = 0;
for (const k of Object.keys(muts)) for (const v of muts[k]) { count++; const d = C.decide(pay, { ...good, [k]: v }, ctx()); if (d.to === "paid") { allSafe = false; cur.fail.push(`mutando ${k}=${JSON.stringify(v)} salió paid`); } }
ok(`${count} mutaciones de un campo: ninguna da paid`, allSafe);
// aleatorio: 20000 combinaciones; paid solo si coinciden los cuatro
for (let i = 0; i < 20000 && cur.fail.length < 5; i++) {
  const r = { status: ["paid", "paid", "pending", "failed"][i % 4], amountCents: Math.random() < 0.7 ? 12345 : Math.floor(Math.random() * 20000), currency: Math.random() < 0.7 ? "MXN" : "USD", reference: Math.random() < 0.7 ? ref : C.makeReference("PBM", KEY, ID2), receiptNo: Math.random() < 0.7 ? "R" + i : "" };
  const d = C.decide(pay, r, ctx()), should = r.status === "paid" && r.amountCents === 12345 && r.currency === "MXN" && r.reference === ref && r.receiptNo !== "";
  if ((d.to === "paid") !== should) cur.fail.push(`caso aleatorio ${JSON.stringify(r)} => ${d.to}`); else cur.pass++;
}

// ------------------------------------------------------------------ ids de Clip
group("ids de Clip");
for (const v of ["3746680a-e227-47d0-b209-cbffbfc69a77", "3746680A-E227-47D0-B209-CBFFBFC69A77"]) ok("UUID válido " + v, C.isClipId(v));
for (const v of ["", "3f2a9c1e", "3746680a-e227-47d0-b209-cbffbfc69a7", "3746680a-e227-47d0-b209-cbffbfc69a77x", "3746680ae22747d0b209cbffbfc69a77", "3746680a-e227-47d0-b209-cbffbfc69a7g", " 3746680a-e227-47d0-b209-cbffbfc69a77", "3746680a-e227-47d0-b209-cbffbfc69a77\n", "' OR 1=1", "../x", null, 5, {}, ["3746680a-e227-47d0-b209-cbffbfc69a77"], undefined]) ok("no es UUID " + JSON.stringify(v), !C.isClipId(v));

const out = {}; let total = 0, bad = 0;
for (const [k, g] of Object.entries(groups)) { out[k] = g; total += g.pass; bad += g.fail.length; }
console.log(JSON.stringify({ total, bad, groups: out }));
process.exit(bad ? 1 : 0);
