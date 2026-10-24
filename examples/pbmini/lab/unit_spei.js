// Pruebas unitarias del núcleo puro de pb_hooks/lib/spei.js (sin PocketBase): node unit_spei.js <ruta a pb_hooks>. Imprime {total, bad, groups}.
const path = require("path");
const real = path.resolve(process.argv[2]);
globalThis.__hooks = real;
const S = require(path.join(real, "lib", "spei.js")).core, B = require(path.join(real, "lib", "spei_banks.js"));

const groups = {}; let cur;
const group = (n) => { cur = groups[n] = { pass: 0, fail: [] }; };
const eq = (l, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) cur.pass++; else cur.fail.push(`${l}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); };
const ok = (l, c) => { if (c) cur.pass++; else cur.fail.push(l); };
const throws = (l, fn, re) => { try { fn(); cur.fail.push(`${l}: debía lanzar`); } catch (e) { if (re && !re.test(String(e.message))) cur.fail.push(`${l}: lanzó otro error: ${e.message}`); else cur.pass++; } };
// CLABE válida de un banco: 3 dígitos de banco + 3 de plaza + 11 de cuenta + verificador (calculado aquí con otra implementación)
const mk = (bank3, rest14) => { const b = bank3 + rest14, w = [3, 7, 1]; let s = 0; for (let i = 0; i < 17; i++) s += (Number(b[i]) * w[i % 3]) % 10; return b + String((10 - (s % 10)) % 10); };
const BBVA = mk("012", "18000011835971".slice(0, 14)), BNTE = mk("072", "18000011835971"), NU = mk("638", "18000011835971");

group("CLABE y tarjeta");
ok("CLABE de ejemplo conocida", S.clabeValid("032180000118359719")); ok("CLABE generada BBVA", S.clabeValid(BBVA)); ok("CLABE generada Banorte", S.clabeValid(BNTE));
ok("dígito verificador alterado", !S.clabeValid("032180000118359710")); ok("17 dígitos", !S.clabeValid("03218000011835971")); ok("19 dígitos", !S.clabeValid("0321800001183597190"));
for (const v of [null, undefined, 5, [], {}, "", "abc", "03218000011835971a", "032 180000118359719"]) ok(`CLABE no válida: ${JSON.stringify(v)}`, !S.clabeValid(v));
ok("Luhn válida", S.luhnValid("4111111111111111")); ok("Luhn con dígitos dobles mayores que 9 (resta 9)", S.luhnValid("4012888888881881")); ok("Luhn con dobles >9 y un dígito cambiado", !S.luhnValid("4012888888881882")); ok("Luhn de otra tarjeta con dobles >9", S.luhnValid("5555555555554444")); ok("Luhn inválida", !S.luhnValid("4111111111111112")); ok("Luhn con 15 dígitos", !S.luhnValid("411111111111111")); ok("Luhn con letras", !S.luhnValid("411111111111111a"));

group("cuenta receptora");
const A = (o) => S.normalizeAccount(o, "x");
eq("CLABE BBVA", [A({ account: BBVA, holder: "Ana" }).bank, A({ account: BBVA, holder: "Ana" }).kind], ["40012", "clabe"]);
eq("banco declarado igual al de la CLABE", A({ account: BNTE, bank: "40072", holder: "Ana" }).bank, "40072");
eq("etiqueta por defecto = nombre del banco", A({ account: BBVA, holder: "Ana" }).label, "BBVA MEXICO"); eq("etiqueta propia", A({ account: BBVA, holder: "Ana", label: "Mi BBVA" }).label, "Mi BBVA");
eq("espacios y guiones se ignoran", A({ account: BBVA.slice(0, 6) + " " + BBVA.slice(6, 12) + "-" + BBVA.slice(12), holder: "Ana" }).account, BBVA);
eq("tarjeta con banco", [A({ account: "4111111111111111", bank: "40072", holder: "Ana" }).kind, A({ account: "4111111111111111", bank: "40072", holder: "Ana" }).bank], ["card", "40072"]);
throws("tarjeta sin banco", () => A({ account: "4111111111111111", holder: "Ana" }), /obligatorio/);
throws("tarjeta con Luhn malo", () => A({ account: "4111111111111112", bank: "40072", holder: "Ana" }), /Luhn/);
throws("CLABE con verificador malo", () => A({ account: BBVA.slice(0, 17) + ((Number(BBVA[17]) + 1) % 10), holder: "Ana" }), /verificador/);
throws("banco declarado distinto del de la CLABE", () => A({ account: BBVA, bank: "40072", holder: "Ana" }), /no coincide/);
throws("banco inexistente", () => A({ account: BBVA, bank: "99999", holder: "Ana" }), /código de banco/);
throws("banco no es texto", () => A({ account: BBVA, bank: 40012, holder: "Ana" }), /código de banco/);
throws("prefijo de CLABE sin banco", () => A({ account: mk("999", "18000011835971"), holder: "Ana" }), /prefijo/);
throws("CLABE de un banco sin CLABE (Banxico 2001)", () => A({ account: mk("001", "18000011835971"), holder: "Ana" }), /prefijo/);
throws("cuenta de 10 dígitos (celular) no se acepta", () => A({ account: "5512345678", bank: "40012", holder: "Ana" }), /18 dígitos/);
throws("cuenta no es texto", () => A({ account: 5, holder: "Ana" }), /texto/); throws("sin cuenta", () => A({ holder: "Ana" }), /texto/);
throws("sin titular", () => A({ account: BBVA }), /holder/); throws("titular vacío", () => A({ account: BBVA, holder: "  " }), /holder/);
throws("titular con <", () => A({ account: BBVA, holder: "<b>x" }), /holder/); throws("titular largo", () => A({ account: BBVA, holder: "a".repeat(81) }), /holder/);
throws("titular con salto de línea", () => A({ account: BBVA, holder: "a\nb" }), /holder/);
throws("etiqueta larga", () => A({ account: BBVA, holder: "Ana", label: "x".repeat(41) }), /label/);
throws("opción desconocida", () => A({ account: BBVA, holder: "Ana", pin: "1" }), /desconocida/);
throws("no es un objeto", () => S.normalizeAccount([BBVA], "x"), /objeto/); throws("nulo", () => S.normalizeAccount(null, "x"), /objeto/);

group("archivo de cuentas");
const J = (o) => JSON.stringify(o), acc = (a, h) => ({ account: a, holder: h || "Ana" });
eq("objeto { accounts }", S.parseAccounts(J({ accounts: [acc(BBVA), acc(BNTE)] })).length, 2); eq("lista directa", S.parseAccounts(J([acc(BBVA)])).length, 1);
throws("no es JSON", () => S.parseAccounts("{no"), /JSON/); throws("vacío", () => S.parseAccounts(J({ accounts: [] })), /1 a 10/);
throws("más de 10", () => S.parseAccounts(J(Array.from({ length: 11 }, () => acc(BBVA)))), /1 a 10/);
throws("repetidas", () => S.parseAccounts(J([acc(BBVA), acc(BBVA, "Otra")])), /repetidas/);
throws("clave extra en el objeto", () => S.parseAccounts(J({ accounts: [acc(BBVA)], extra: 1 })), /1 a 10/); throws("un número", () => S.parseAccounts("5"), /1 a 10/);
throws("una cuenta inválida invalida todo", () => S.parseAccounts(J([acc(BBVA), acc("123")])), /accounts\[1\]/);

group("elegir cuenta");
const ACCS = S.parseAccounts(J([acc(BBVA), acc(BNTE)]));
eq("cliente BBVA recibe Banorte", S.pickAccount(ACCS, "40012").account.bank, "40072"); eq("cliente Banorte recibe BBVA", S.pickAccount(ACCS, "40072").account.bank, "40012");
eq("cliente de otro banco recibe la primera", S.pickAccount(ACCS, "40638").account.bank, "40012");
eq("sin banco: la primera y banco desconocido", [S.pickAccount(ACCS, undefined).account.bank, S.pickAccount(ACCS, undefined).bankKnown], ["40012", false]);
eq("banco inválido se trata como desconocido", S.pickAccount(ACCS, "00000").bankKnown, false); eq("banco no texto", S.pickAccount(ACCS, { x: 1 }).bankKnown, false);
const ONE = S.parseAccounts(J([acc(BBVA)]));
eq("solo hay cuenta del mismo banco => sameBank", [S.pickAccount(ONE, "40012").sameBank, S.pickAccount(ONE, "40012").account.bank], [true, "40012"]);
eq("solo una cuenta y cliente de otro banco", S.pickAccount(ONE, "40072").sameBank, false); throws("sin cuentas", () => S.pickAccount([], "40012"), /sin cuentas/);

group("clave de rastreo, fechas y montos");
eq("clave real de Spin con guion (medida en Banxico)", S.trackingKey("SPIN-20261023192350YPDFH5B9"), "SPIN-20261023192350YPDFH5B9"); eq("clave de Spin partida en dos renglones", S.trackingKey("SPIN-20261023192350YP DFH5B9"), "SPIN-20261023192350YPDFH5B9"); eq("guion bajo y punto", S.trackingKey("AB_CD.1234"), "AB_CD.1234");
eq("clave válida", S.trackingKey("MBAN01002609040080500083"), "MBAN01002609040080500083"); eq("espacios en los extremos (incluido un salto final)", S.trackingKey("  MBAN01002609\n"), "MBAN01002609"); eq("minúsculas y espacios: se conserva el caso y se quitan los espacios", S.trackingKey(" mban-0100 2609 "), "mban-01002609");
for (const v of ["", "abc", "A".repeat(31), "MBAN0100'; DROP", "MBAN0100%0a", "clave con ñandú1", null, 5, {}, "1234567", "MBAN01002609\n040080", "MBAN0100\t2609040080"]) ok(`clave inválida: ${JSON.stringify(v)}`, S.trackingKey(v) === null);
eq("referencia de 7 dígitos no se acepta (v1)", S.trackingKey("1234567"), null);
eq("fecha dd-mm-aaaa", S.parseDate("04-09-2026"), "04-09-2026"); eq("fecha dd/mm/aaaa", S.parseDate("04/09/2026"), "04-09-2026"); eq("fecha ISO", S.parseDate("2026-09-04"), "04-09-2026");
for (const v of ["31-02-2026", "2026-13-01", "4-9-2026", "04-09-26", "", null, 5, "04-09-2014", "04-09-2026 12:00"]) ok(`fecha inválida: ${JSON.stringify(v)}`, S.parseDate(v) === null);
eq("borde de la zona horaria: 05:30 UTC es 23:30 del día anterior (UTC-6, no UTC-5)", S.mxDate(Date.UTC(2026, 9, 23, 5, 30, 0)), "22-10-2026"); eq("justo después: 06:30 UTC ya es el 23", S.mxDate(Date.UTC(2026, 9, 23, 6, 30, 0)), "23-10-2026");
eq("fecha de México: 2026-10-23 03:00 UTC es el 22", S.mxDate(Date.UTC(2026, 9, 23, 3, 0, 0)), "22-10-2026"); eq("2026-10-23 06:00 UTC es el 23", S.mxDate(Date.UTC(2026, 9, 23, 6, 0, 0)), "23-10-2026");
eq("hora de Banxico (UTC-6)", S.parseBxTime("23/10/2026 14:30:05"), Date.UTC(2026, 9, 23, 20, 30, 5)); eq("sin hora", S.parseBxTime("23/10/2026"), Date.UTC(2026, 9, 23, 6, 0, 0));
for (const v of ["", "2026-10-23", "23/10/2026 25:00:00x", null, 5]) ok(`hora inválida: ${JSON.stringify(v)}`, S.parseBxTime(v) === null);
eq("monto simple", S.bxCents("1.00"), 100); eq("con $ y miles", S.bxCents("$1,300.50"), 130050); eq("un decimal", S.bxCents("1.5"), 150); eq("entero", S.bxCents("300"), 30000);
for (const v of ["", "abc", "-1", "1.234", "1e3", null, 5, "1.2.3"]) ok(`monto inválido: ${JSON.stringify(v)}`, S.bxCents(v) === null);

group("variantes de la clave");
eq("tal cual, mayúsculas, minúsculas y sin separadores", S.keyVariants("Spin-2026ab"), ["Spin-2026ab", "SPIN-2026AB", "spin-2026ab", "Spin2026ab"]); eq("clave ya en mayúsculas sin separadores: una sola", S.keyVariants("ABCDEFGH1234"), ["ABCDEFGH1234", "abcdefgh1234"]);
eq("máximo 4 variantes", S.keyVariants("Ab_Cd.Ef-Gh12").length <= 4, true); eq("una variante demasiado corta se descarta", S.keyVariants("A-B-C-D-E").every((v) => v.length >= 8), true);
eq("canon ignora mayúsculas, espacios y separadores", S.canonKey(" spin-2026_ab.cd "), "SPIN2026ABCD"); eq("canon de basura", S.canonKey(null), "");

group("bancos");
eq("97 instituciones del formulario", B.list().length, 97); ok("códigos únicos", new Set(B.list().map((b) => b.code)).size === 97);
eq("CLABE de BBVA", B.byClabe(BBVA).code, "40012"); eq("CLABE de Nubank", B.byClabe(NU).code, "40638"); eq("Clip es un banco del catálogo", B.byCode("90730").name, "Clip");
eq("código inexistente", B.byCode("00000"), null); eq("__proto__ no es un banco", B.byCode("__proto__"), null); eq("constructor no es un banco", B.byCode("constructor"), null); eq("prefijo __proto__", B.byClabe("__proto__"), null);
eq("pista BBVA por clave", B.hintFromTracking("MBAN0100").code, "40012"); eq("pista en minúsculas", B.hintFromTracking("mban0100").code, "40012"); eq("clave sin pista", B.hintFromTracking("XYZ123456"), null); eq("pista no texto", B.hintFromTracking(5), null);
ok("los prefijos de CLABE no se repiten", (() => { const seen = {}; for (const b of B.list()) { if (["2001", "90901", "90902", "90903"].indexOf(b.code) >= 0) continue; const p = b.code.slice(2); if (seen[p]) return false; seen[p] = 1; } return true; })());

group("transiciones");
eq("pendiente puede pasar a verificando", S.canTransition("awaiting", "checking"), true); eq("verificando puede pagarse", S.canTransition("checking", "paid"), true); eq("pendiente no pasa directo a pagado", S.canTransition("awaiting", "paid"), false);
eq("pagado es final", ["awaiting", "checking", "review", "failed", "expired"].some((t) => S.canTransition("paid", t)), false); eq("fallado es final", ["awaiting", "paid"].some((t) => S.canTransition("failed", t)), false);
eq("revisión a pagado solo operador", S.needsOperator("review", "paid"), true); eq("revisión a fallado solo operador", S.needsOperator("review", "failed"), true); eq("verificando a pagado lo hace el sistema", S.needsOperator("checking", "paid"), false);
eq("desde qué estados el sistema puede pagar", S.fromStates("paid"), ["checking"]); eq("estado desconocido", S.canTransition("x", "paid"), false); eq("__proto__", S.canTransition("__proto__", "paid"), false);
eq("un vencido puede revisarse (pago tardío, solo operador)", [S.canTransition("expired", "review"), S.needsOperator("expired", "review")], [true, true]);

group("decisión (decide)");
const NOW = Date.UTC(2026, 9, 23, 18, 0, 0), ORD = { amount: 30000, account: BNTE, accountBank: "40072", createdMs: NOW - 3600e3, expiresMs: NOW + 23 * 3600e3, tracking: "MBAN01002609040080500083", emisor: "40012" };
const BX = (o) => Object.assign({ found: true, status: "Liquidado", amountCents: 30000, account: BNTE, processedMs: NOW - 600e3, tracking: "MBAN01002609040080500083" }, o || {});
const D = (b, o, c) => S.decide(Object.assign({}, ORD, o || {}), b, Object.assign({ now: NOW }, c || {}));
eq("todo cuadra => pagado", D(BX()).to, "paid");
eq("estado con acentos y mayúsculas", D(BX({ status: "  LIQUIDADO " })).to, "paid"); eq("cuenta con espacios y guiones", D(BX({ account: BNTE.slice(0, 4) + " " + BNTE.slice(4) })).to, "paid");
eq("no encontrada => seguir verificando", [D({ found: false }).to, D({ found: false }).retry, D({ found: false }).notFound], ["checking", true, true]);
eq("Banxico con error => reintento, nunca pagado", [D({ error: "timeout" }).to, D({ error: "timeout" }).retry], ["checking", true]);
for (const v of [null, undefined, "x", 5, []]) eq(`respuesta no interpretable ${JSON.stringify(v)}`, D(v).to, "checking");
eq("en proceso => reintento", [D(BX({ status: "En proceso" })).to, D(BX({ status: "En proceso" })).retry], ["checking", true]);
for (const st of ["Cancelado", "Rechazado", "Devuelto", "Retornado", "No liquidado", "En proceso de devolución", "", "raro"]) eq(`estado «${st}» => revisión`, D(BX({ status: st })).to, "review");
eq("monto menor", D(BX({ amountCents: 29999 })).to, "review"); eq("monto mayor", D(BX({ amountCents: 30001 })).to, "review"); eq("monto ilegible", D(BX({ amountCents: null })).to, "review"); eq("monto indefinido", D(BX({ amountCents: undefined })).to, "review");
eq("otra cuenta", D(BX({ account: BBVA })).to, "review"); eq("mismos 4 últimos dígitos pero otra cuenta (no basta el final)", D(BX({ account: "0".repeat(BNTE.length - 4) + BNTE.slice(-4) })).to, "review"); eq("mismo prefijo y otro final", D(BX({ account: BNTE.slice(0, -1) + ((Number(BNTE.slice(-1)) + 1) % 10) })).to, "review"); eq("cuenta vacía", D(BX({ account: "" })).to, "review"); eq("cuenta corta", D(BX({ account: "3451" })).to, "review"); eq("cuenta enmascarada", D(BX({ account: "**** 9719" })).to, "review");
eq("transferencia anterior a la orden", D(BX({ processedMs: ORD.createdMs - 16 * 60e3 })).to, "review"); eq("dentro de la tolerancia de reloj (1 min)", D(BX({ processedMs: ORD.createdMs - 60e3 })).to, "paid"); eq("fuera de la tolerancia (3 min): una orden nueva no reclama una transferencia previa", D(BX({ processedMs: ORD.createdMs - 3 * 60e3 })).to, "review"); eq("la tolerancia es de 2 minutos", S.SKEW_MS, 120000);
eq("posterior al vencimiento", D(BX({ processedMs: ORD.expiresMs + 16 * 60e3 })).to, "review"); { const dv = D(BX({ processedMs: ORD.expiresMs + 3 * 60e3 }), null, { now: ORD.expiresMs + 3600e3 }); eq("posterior al vencimiento aunque ya no sea futura (solo esa regla)", [dv.to, /vencimiento/.test(dv.note), /futuro/.test(dv.note)], ["review", true, false]); eq("justo dentro del vencimiento + tolerancia", D(BX({ processedMs: ORD.expiresMs + 60e3 }), null, { now: ORD.expiresMs + 3600e3 }).to, "paid"); } eq("fecha en el futuro", D(BX({ processedMs: NOW + 16 * 60e3 }), { expiresMs: 0 }).to, "review");
eq("fecha ilegible", D(BX({ processedMs: undefined })).to, "review"); eq("fecha como texto", D(BX({ processedMs: "hoy" })).to, "review");
eq("clave de Banxico distinta de la reportada", D(BX({ tracking: "OTRA0000000000" })).to, "review"); eq("clave de Banxico igual sin distinguir mayúsculas", D(BX({ tracking: "mban01002609040080500083" })).to, "paid"); eq("clave de Banxico con otro guion: la consulta ya acertó con una variante, Banxico es la verdad", D(BX({ tracking: "MBAN-01002609040080500083" })).to, "paid"); eq("clave de Banxico realmente distinta", D(BX({ tracking: "MBAN01002609040080500084" })).to, "review");
eq("clave ya usada por otro pago", D(BX(), null, { trackingUsedByOther: true }).to, "review");
eq("mismo banco de origen => revisión sin consultar", D({ found: false }, { emisor: "40072" }).to, "review");
eq("más de un motivo se junta", /monto/.test(D(BX({ amountCents: 1, account: BBVA })).note) && /cuenta/.test(D(BX({ amountCents: 1, account: BBVA })).note), true);
eq("la nota no supera 250 caracteres", D(BX({ amountCents: 1, account: BBVA, processedMs: 1, tracking: "X".repeat(40) })).note.length <= 250, true);
ok("jamás paga ante CUALQUIER anomalía sola (barrido)", ["amountCents", "account", "processedMs", "tracking", "status"].every((k) => { const bad = { amountCents: 29999, account: BBVA, processedMs: 1, tracking: "OTRA0000000000", status: "Rechazado" }[k]; return D(BX({ [k]: bad })).to !== "paid"; }));

group("parseo de Banxico");
const garble = (s) => s.replace(/[áéíóúñÁÉÍÓÚÑ]/g, "�"); // el sitio responde en Latin-1 y se lee como UTF-8
const ROWS = [["Número de referencia", "1234567"], ["Clave de rastreo", "MBAN01002609040080500083"], ["Institución emisora del pago", "BBVA MEXICO"], ["Institución receptora del pago", "BANORTE"], ["Estado del pago en Banxico", "Liquidado"],
  ["Fecha y hora de recepción", "23/10/2026 14:30:05"], ["Fecha y hora de procesamiento", "23/10/2026 14:30:06"], ["Cuenta beneficiaria", BNTE], ["Monto", "1,300.50"]];
const table = (drop, over) => "<html><table>" + ROWS.filter((r) => !(drop || []).includes(r[0])).map((r) => `<tr><td class="a">${garble(r[0])}</td><td>${(over && over[r[0]]) || r[1]}</td></tr>`).join("") + "</table></html>";
const P = S.parseBx, NF = "<html><div class=\"info\"><strong>Operaci�n no encontrada. El SPEI no ha recibido una orden</strong></div></html>";
const f = P(table());
eq("tabla completa: encontrada", f.found, true); eq("estado", f.status, "Liquidado"); eq("monto en centavos", f.amountCents, 130050); eq("cuenta", f.account, BNTE); eq("clave", f.tracking, "MBAN01002609040080500083");
eq("fecha de procesamiento (hora de México)", f.processedMs, Date.UTC(2026, 9, 23, 20, 30, 6)); eq("emisor y receptor", [f.issuing, f.receiving], ["BBVA MEXICO", "BANORTE"]);
eq("etiquetas en Latin-1 leído como UTF-8", P(table()).found, true); eq("etiquetas con acentos bien leídas", P(table().replace(/�/g, "ó")).found, true);
eq("operación no encontrada (con la letra rota)", P(NF), { found: false }); ok("una respuesta ENORME con la tabla dentro se descarta (tope de tamaño)", !!P("x".repeat(500000) + table()).error && P("x".repeat(500000) + table()).found === undefined); ok("con marca de error de Banxico, aunque diga «no encontrada», es error", !!P("<meta name=\"meta:stats=ERR\"/>" + NF).error && P("<meta name=\"meta:stats=ERR\"/>" + NF).found === undefined); eq("sin la marca, la misma página sí es «no encontrada»", P(NF), { found: false }); eq("operación no encontrada (acentuada)", P(NF.replace("�", "ó")), { found: false });
for (const [l, h] of [["vacía", ""], ["nula", null], ["número", 5], ["objeto", {}], ["captcha", "<div id=\"captchaImage\">El texto de la imagen de seguridad no ha sido ingresado.</div>"], ["mantenimiento", "<h1>Sitio en mantenimiento</h1>"], ["bloqueo", "<h1>Access Denied</h1>"],
  ["marca ERR", "<meta name=\"meta:stats=ERR\"/>"], ["enorme", "x".repeat(500000)], ["sin estado", table(["Estado del pago en Banxico"])], ["solo cabecera", "<table></table>"]]) ok(`respuesta ${l} => error, nunca «no encontrada» ni pagada`, !!P(h).error && P(h).found === undefined);
eq("monto ilegible => encontrada con monto nulo", P(table(null, { Monto: "mucho" })).amountCents, null); eq("fecha ilegible => nula", P(table(null, { "Fecha y hora de procesamiento": "ayer" })).processedMs, null);
eq("cuenta con espacios", P(table(null, { "Cuenta beneficiaria": "0721 8000 0123 4567 89" })).account, "072180000123456789"); eq("etiquetas con etiquetas HTML dentro del valor", P(table(null, { "Estado del pago en Banxico": "<b>Liquidado</b>" })).status, "Liquidado");
eq("filas desconocidas se ignoran", P(table().replace("</table>", "<tr><td>Otra cosa</td><td>x</td></tr></table>")).status, "Liquidado");

const fs2 = require("fs");
const fx = P(fs2.readFileSync(path.join(__dirname, "fixtures", "cep_liquidado.html"), "utf8"));
eq("respuesta REAL de Banxico (fixture): encontrada", fx.found, true); eq("estado real", fx.status, "Liquidado"); eq("monto real «0.01» -> centavos", fx.amountCents, 1); eq("cuenta real (número completo)", fx.account, "4111111111111111");
eq("clave real con guion", fx.tracking, "SPIN-20990101120000ZZZZZZZZ"); eq("fecha real de procesamiento (hora de México)", fx.processedMs, Date.UTC(2026, 9, 23, 19, 24, 2)); eq("fecha real de recepción", fx.receivedMs, Date.UTC(2026, 9, 23, 19, 23, 59));
eq("emisor real (con &oacute; en la etiqueta)", fx.issuing, "SPIN BY OXXO"); eq("receptor real", fx.receiving, "BANORTE"); eq("referencia real", fx.reference, "1234567");

group("lectura del comprobante");
const R = (o, now) => S.parseReading(typeof o === "string" ? o : JSON.stringify(o), now || Date.UTC(2026, 9, 23, 20));
const GOOD = { tracking_key: "SPIN-20261023192350YPDFH5B9", amount: 0.01, date: "23-10-2026", issuing_bank_code: "90728", issuing_bank_name: "SPIN BY OXXO", confidence: 1 };
eq("lectura completa (medida con Gemini)", R(GOOD), { tracking: "SPIN-20261023192350YPDFH5B9", amountCents: 1, date: "23-10-2026", emisor: "90728", bankName: "SPIN BY OXXO", confidence: 1 });
eq("código de banco como número (lo que devolvió el modelo)", R({ ...GOOD, issuing_bank_code: 90728 }).emisor, "90728"); eq("sin código: banco por nombre exacto", R({ ...GOOD, issuing_bank_code: undefined }).emisor, "90728");
eq("nombre en minúsculas", R({ ...GOOD, issuing_bank_code: null, issuing_bank_name: "bbva mexico" }).emisor, "40012"); eq("nombre inexistente", R({ ...GOOD, issuing_bank_code: null, issuing_bank_name: "Banco Imaginario" }).emisor, null); eq("nombre parcial «BANCO» no adivina un banco", R({ ...GOOD, issuing_bank_code: null, issuing_bank_name: "BANCO" }).emisor, null); eq("nombre parcial «BBVA» no se acepta (solo el nombre exacto o el código)", R({ ...GOOD, issuing_bank_code: null, issuing_bank_name: "BBVA" }).emisor, null); eq("código inexistente", R({ ...GOOD, issuing_bank_code: "99999", issuing_bank_name: null }).emisor, null);
eq("fecha con hora (como la devolvió el modelo)", R({ ...GOOD, date: "23/10/2026 01:23:50 p.m." }).date, "23-10-2026"); eq("fecha ISO", R({ ...GOOD, date: "2026-10-23" }).date, "23-10-2026"); eq("fecha futura se descarta", R({ ...GOOD, date: "30-10-2026" }).date, null); eq("fecha basura", R({ ...GOOD, date: "ayer" }).date, null);
eq("monto como texto", R({ ...GOOD, amount: "300.00" }).amountCents, 30000); eq("monto con miles", R({ ...GOOD, amount: "$1,300.50" }).amountCents, 130050); for (const v of [-1, 0, NaN, Infinity, 1e12, "mucho", null, [], {}, 0.001]) eq(`monto no válido ${JSON.stringify(v)}`, R({ ...GOOD, amount: v }).amountCents, null);
for (const v of [null, "", "ab", "A".repeat(31), "MBAN0100'; DROP", "clave con espacios y ñ", 12345, [], {}]) eq(`clave no válida ${JSON.stringify(v)}`, R({ ...GOOD, tracking_key: v }).tracking, null);
eq("confianza fuera de rango se acota", [R({ ...GOOD, confidence: 7 }).confidence, R({ ...GOOD, confidence: -3 }).confidence], [1, 0]); eq("confianza ausente o rara = 0", [R({ ...GOOD, confidence: "alta" }).confidence, R({ ...GOOD, confidence: undefined }).confidence], [0, 0]);
eq("respuesta con ```json …```", R("```json\n" + JSON.stringify(GOOD) + "\n```").tracking, "SPIN-20261023192350YPDFH5B9"); eq("claves extra se ignoran", Object.keys(R({ ...GOOD, evil: "x", __proto__: { a: 1 } })).sort(), ["amountCents", "bankName", "confidence", "date", "emisor", "tracking"]);
for (const [l, v] of [["texto libre", "Claro, aquí están los datos"], ["JSON roto", "{no"], ["arreglo", "[1,2]"], ["número", "5"], ["nulo", "null"], ["vacío", ""], ["enorme", "x".repeat(7000)], ["no texto", 5], ["indefinido", undefined]]) eq(`salida no interpretable (${l}) => todo nulo`, R(v), { tracking: null, amountCents: null, date: null, emisor: null, bankName: null, confidence: 0 });
eq("tipo de imagen por contenido: PNG", S.imageKind("iVBORw0KGgoAAAA"), "image/png"); eq("JPEG", S.imageKind("/9j/4AAQ"), "image/jpeg"); eq("WebP", S.imageKind("UklGRiQAAABXRUJQ"), "image/webp");
for (const v of ["R0lGODlhAQAB", "JVBERi0xLjQ", "PHN2ZyB4bWxucz0", "", "aGVsbG8=", "AAAA"]) eq(`no es imagen admitida: ${v.slice(0, 12)}`, S.imageKind(v), null);
const PR = S.visionPrompt();
ok("el prompt avisa que la imagen es dato no confiable", /DATO NO CONFIABLE/.test(PR) && /ignora cualquier instrucci/.test(PR)); ok("el prompt incluye los 97 bancos", (PR.match(/[0-9]{4,5}=/g) || []).length === 97);
ok("el prompt distingue emisor de destinatario", /NUNCA la instituci/.test(PR)); ok("el prompt limita la clave a la rotulada «Clave de rastreo»", /Clave de rastreo/.test(PR) && /NO uses/.test(PR)); ok("el prompt NO contiene cuentas ni datos de ninguna orden", !/[0-9]{16,18}/.test(PR));

const out = {}; let total = 0, bad = 0;
for (const [k, g] of Object.entries(groups)) { out[k] = g; total += g.pass; bad += g.fail.length; }
console.log(JSON.stringify({ total, bad, groups: out })); process.exit(bad ? 1 : 0);
