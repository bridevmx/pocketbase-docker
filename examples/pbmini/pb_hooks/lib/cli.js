// Comandos de consola (corren en un proceso aparte del `serve`; PocketBase carga también los hooks, así que
// si alguna página es inválida el registro aborta antes de llegar aquí: es el comportamiento fail-closed deseado).
//   ./pocketbase pbmini:routes                          tabla de rutas como JSON entre marcadores (la usan el fuzzer guiado y los tipos)
//   ./pocketbase pbmini:new page|endpoint <ruta> [métodos]   crea pages/<ruta>.js (+ .html si es page); métodos: get,post,put,patch,delete
//   ./pocketbase pbmini:new schema <nombre>              crea pages/_schemas/<nombre>.js
//   ./pocketbase pbmini:new config                       crea pb_hooks/pbmini.config.js copiando pbmini.config.example.js (todo apagado; nunca sobrescribe)
//   ./pocketbase pbmini:new tgaction <nombre>            crea pb_hooks/telegram/actions/<nombre>.js (acción de un botón de Telegram)
//   ./pocketbase pbmini:clip <subcomando>               pagos con Clip: status | show | reconcile | purge | check | review | refund | refunded (ver clip() abajo)
//   ./pocketbase pbmini:telegram status                  estado del módulo (configuración, variables, webhook registrado, cola y vínculos; sin mostrar secretos)
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
  if (kind === "config") { // una sola fuente de verdad: la plantilla comentada pbmini.config.example.js
    if (args.length !== 1) fail("uso: pbmini:new config (sin argumentos)");
    const src = `${__hooks}/pbmini.config.example.js`, dst = `${__hooks}/pbmini.config.js`;
    if (!exists(src)) fail("falta pb_hooks/pbmini.config.example.js (la plantilla)");
    if (exists(dst)) fail(`ya existe ${dst} (no se sobrescribe nada)`);
    $os.writeFile(dst, $os.readFile(src), 0o644);
    console.log("creado " + dst + " (todo apagado: actívalo editando el archivo y reinicia)"); return;
  }
  if (kind === "tgaction") {
    const nm = args[1];
    if (args.length !== 2 || !nm || !/^[a-z0-9][a-z0-9_]{0,31}$/.test(nm)) fail("uso: pbmini:new tgaction <nombre> (minúsculas, dígitos y _; máx. 32)");
    const dir = `${__hooks}/telegram/actions`, file = `${dir}/${nm}.js`;
    if (exists(file)) fail(`ya existe ${file}`);
    $os.mkdirAll(dir, 0o755);
    $os.writeFile(file, '/** @type {import("../../types/pbmini").TelegramAction} */\nmodule.exports = {\n  // Corre cuando el DUEÑO del botón lo pulsa (una sola vez, antes de caducar): ctx.telegram("me", { text, buttons: [[{ text: "OK", action: "' + nm + '" }]] }).\n  // `app` es $app; devuelve el texto que verá el usuario (hasta 200 caracteres).\n  run(app, { user, args }) {\n    return "Listo";\n  },\n};\n', 0o644);
    console.log("creado " + file); return;
  }
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
  if (kind !== "page" && kind !== "endpoint") fail("uso: pbmini:new page|endpoint <ruta> [métodos] | pbmini:new schema <nombre> | pbmini:new config | pbmini:new tgaction <nombre>");
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
// pbmini:telegram status  -> diagnóstico sin secretos: qué falta, si el webhook apunta a esta app, cuánto hay en cola
function telegram(args) {
  if ((args || [])[0] !== "status") fail("uso: pbmini:telegram status");
  const c = require(`${__hooks}/lib/config.js`).load().telegram, out = { enabled: c.enabled };
  if (c.enabled) {
    const T = require(`${__hooks}/lib/telegram.js`), e = T.env();
    out.collection = c.collection; out.login = c.login.enabled; out.groups = Object.keys(c.groups); out.operators = e.ops.length;
    out.env = { TELEGRAM_BOT_TOKEN: "ok", TELEGRAM_WEBHOOK_SECRET: "ok", TELEGRAM_WEBHOOK_URL: e.hook || "(sin definir: el webhook se registra a mano)", TELEGRAM_BOT_USERNAME: e.user || "(se obtiene con getMe)", TELEGRAM_MINIAPP_URL: e.mini || "(sin definir)" };
    const me = T.api("getMe", {}); out.getMe = me.ok ? "@" + me.json.result.username : `FALLO (${me.status}) ${me.desc}`;
    const wi = T.api("getWebhookInfo", {}); out.webhook = wi.ok ? { url: wi.json.result.url || "(ninguno)", pendientes: wi.json.result.pending_update_count, ultimoError: wi.json.result.last_error_message || null } : `FALLO (${wi.status}) ${wi.desc}`;
    const count = (coll, f) => { try { return $app.countRecords(coll, $dbx.exp(f)); } catch (_) { return "n/d"; } };
    out.cola = { pendientes: count(T.COLL.OUTBOX, "state = 'pending'"), muertos: count(T.COLL.OUTBOX, "state = 'dead'") };
    out.vinculos = { activos: count(T.COLL.CHATS, "status = 'active'"), bloqueados: count(T.COLL.CHATS, "status = 'blocked'") };
  }
  console.log(JSON.stringify(out, null, 2));
}

// pbmini:clip <subcomando> [args]  (argumentos POSICIONALES; las operaciones que mueven dinero o datos exigen la palabra `confirm`)
//   status | show <id|referencia> | reconcile | purge [dry] | check [pesos] [wait] | review <id> paid|failed [recibo] confirm | refund <id> confirm | refunded <id> confirm
function clip(args) {
  args = (args || []).map(String);
  const sub = args[0], conf = require(`${__hooks}/lib/config.js`).load().clip, T = require(`${__hooks}/lib/clip.js`);
  const out = (o) => console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2)), die = (m, code) => { console.log("pbmini:clip: " + m); $os.exit(code || 1); };
  if (!conf.enabled) die("el módulo está apagado (clip.enabled en pbmini.config.js)");
  const en = T.env(), confirm = args[args.length - 1] === "confirm", rest = confirm ? args.slice(0, -1) : args;
  const need = () => { if (!confirm) die("esta operación requiere la palabra `confirm` al final (nada se ha cambiado)", 2); };
  const show = (r) => ({ id: r.id, reference: r.getString("reference"), status: r.getString("status"), amount: r.getInt("amount"), currency: r.getString("currency"), clip_id: r.getString("clip_id"), user: r.getString("user"), subject: r.getString("subject_kind") + ":" + r.getString("subject_id"),
    receipt_no: r.getString("receipt_no"), note: r.getString("note"), created: r.getString("created"), paid_at: r.getString("paid_at"), closed_at: r.getString("closed_at"), activated_at: r.getString("activated_at"), refund_id: r.getString("refund_id"), refunded_at: r.getString("refunded_at") });
  if (sub === "status") {
    const count = (st) => { try { return $app.countRecords(T.COLL, $dbx.exp("status = {:s}", { s: st })); } catch (_) { return "n/d"; } }, by = {};
    Object.keys(T.TRANSITIONS).forEach((st) => { by[st] = count(st); });
    return out({ enabled: true, publicUrl: en.pub, webhook: en.pub + conf.webhook.path + "?token=<…>", api: en.api, env: { CLIP_API_TOKEN: "ok", CLIP_WEBHOOK_TOKEN: "ok", CLIP_WEBHOOK_TOKEN_PREV: en.prev ? "ok (rotación en curso)" : "(sin definir)" }, collection: conf.collection, methods: conf.methods, amount: conf.amount, reconcile: conf.reconcile, retention: conf.retention, readRules: conf.readRules, payments: by });
  }
  if (sub === "show") { if (rest.length !== 2) die("uso: pbmini:clip show <id|referencia>"); let r = null; try { r = /^[a-z0-9]{15}$/.test(rest[1]) ? $app.findRecordById(T.COLL, rest[1]) : $app.findFirstRecordByData(T.COLL, "reference", rest[1]); } catch (_) {} if (!r) die("pago no encontrado"); return out(show(r)); }
  if (sub === "reconcile") { const r = T.reconcile($app); out(r); if (r.review > 0) $os.exit(1); return; }
  if (sub === "purge") { out(T.purge($app, { dryRun: rest[1] === "dry" })); return; }
  if (sub === "review") {
    if (rest.length < 3 || rest.length > 4) die("uso: pbmini:clip review <id> paid|failed [recibo] confirm"); need();
    try { out(T.reviewResolve($app, rest[1], rest[2], "cli", rest[3])); } catch (err) { die(String(err.message || err)); } return;
  }
  if (sub === "refund") { if (rest.length !== 2) die("uso: pbmini:clip refund <id> confirm"); need(); try { out(T.refund($app, rest[1], "cli")); } catch (err) { die(String(err.message || err)); } return; }
  if (sub === "refunded") { if (rest.length !== 2) die("uso: pbmini:clip refunded <id> confirm (solo registra un reembolso ya hecho en el panel de Clip)"); need(); try { out(T.markRefunded($app, rest[1], "cli")); } catch (err) { die(String(err.message || err)); } return; }
  if (sub === "check") { // crea un link REAL de prueba (mínimo $1) y comprueba la forma de la respuesta; no guarda nada. Con `wait` espera tu pago (hasta 10 min).
    const pesos = rest[1] && rest[1] !== "wait" ? rest[1] : "1", cents = T.toCents(pesos);
    if (cents === null || cents < conf.amount.min || cents > conf.amount.max) die(`monto inválido (${pesos}): entre ${conf.amount.min / 100} y ${conf.amount.max / 100} pesos`);
    const id = $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"), ref = T.makeReference(conf.referencePrefix, en.token, id);
    let made; try { made = T.createCheckout({ amountCents: cents, description: "Prueba pbmini", reference: ref, urls: { success: en.pub + "/", error: en.pub + "/", default: en.pub + "/" }, webhookUrl: `${en.pub}${conf.webhook.path}?token=${encodeURIComponent(en.hook)}` }); } catch (err) { die("Clip no creó el link: " + T.redact(err.message || err)); }
    out({ ok: "Clip aceptó las credenciales", id: made.id, referencia: ref, pagar_en: made.url, vence: made.expiresAt });
    const report = (remote) => [["estado COMPLETADO", remote.status === "paid", remote.rawStatus || "sin estado"], ["referencia propia", remote.reference === ref, `Clip: ${remote.reference || "ninguna"}`], ["monto", remote.amountCents === cents, `Clip: ${remote.amountCents} · esperado: ${cents} centavos`],
      ["moneda MXN", remote.currency === "MXN", remote.currency || "ninguna"], ["receipt_no presente", remote.status === "paid" && !!remote.receiptNo, remote.receiptNo || (remote.status === "paid" ? "falta" : "solo aparece al completarse")]];
    let remote = T.getCheckout(made.id);
    if (rest[rest.length - 1] === "wait") { const end = Date.now() + 600000; while (remote.status !== "paid" && Date.now() < end) { sleep(3000); remote = T.getCheckout(made.id); } }
    const rep = report(remote); rep.forEach((x) => console.log(`${x[1] ? "OK " : "-- "} ${x[0]}: ${x[2]}`));
    if (rest[rest.length - 1] === "wait" && rep.some((x) => !x[1])) $os.exit(1); return;
  }
  die("uso: pbmini:clip status | show <id|referencia> | reconcile | purge [dry] | check [pesos] [wait] | review <id> paid|failed [recibo] confirm | refund <id> confirm | refunded <id> confirm");
}
function spei(args) {
  args = (args || []).map(String);
  const sub = args[0], conf = require(`${__hooks}/lib/config.js`).load().spei, T = require(`${__hooks}/lib/spei.js`);
  const out = (o) => console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2)), die = (m, code) => { console.log("pbmini:spei: " + m); $os.exit(code || 1); };
  if (!conf.enabled) die("el módulo está apagado (spei.enabled en pbmini.config.js)");
  const confirm = args[args.length - 1] === "confirm", rest = confirm ? args.slice(0, -1) : args;
  const need = () => { if (!confirm) die("esta operación requiere la palabra `confirm` al final (nada se ha cambiado)", 2); };
  const tail = (n) => "…" + String(n).slice(-4); // nunca se imprimen cuentas completas
  const show = (r) => ({ id: r.id, status: r.getString("status"), amount: r.getInt("amount"), base_amount: r.getInt("base_amount"), user: r.getString("user"), subject: r.getString("subject_kind") + ":" + r.getString("subject_id"), account: tail(r.getString("account")) + " " + r.getString("account_label"),
    customer_bank: r.getString("customer_bank"), emisor: r.getString("emisor"), tracking: r.getString("tracking"), last_tracking: r.getString("last_tracking"), source: r.getString("source"), reports: r.getInt("reports"), tries: r.getInt("tries"), next_try: r.getString("next_try"),
    banxico: { status: r.getString("bx_status"), amount: r.getInt("bx_amount"), processed: r.getString("bx_processed"), account: r.getString("bx_account_tail") }, note: r.getString("note"), created: r.getString("created"), expires_at: r.getString("expires_at"), paid_at: r.getString("paid_at"), closed_at: r.getString("closed_at"), activated_at: r.getString("activated_at") });
  let en; try { en = T.env(); } catch (err) { die(String(err.message || err)); }
  if (sub === "status") {
    const count = (st) => { try { return $app.countRecords(T.COLL, $dbx.exp("status = {:s}", { s: st })); } catch (_) { return "n/d"; } }, by = {};
    Object.keys(T.core.TRANSITIONS).forEach((st) => { by[st] = count(st); });
    let accs = []; try { accs = T.accounts().map((a) => ({ label: a.label, bank: a.bank + " " + a.bankName, kind: a.kind, account: tail(a.account) })); } catch (err) { die(String(err.message || err)); }
    return out({ enabled: true, banxico: en.bx, accounts: accs, uniqueCents: conf.uniqueCents.enabled, vision: conf.vision.enabled ? conf.vision.provider : "apagada", orderTtlHours: conf.orderTtlHours, orders: by });
  }
  if (sub === "show") { if (rest.length !== 2) die("uso: pbmini:spei show <id>"); let r = null; try { r = $app.findRecordById(T.COLL, rest[1]); } catch (_) { /* no existe */ } if (!r) die("no existe esa orden"); return out(show(r)); }
  if (sub === "reconcile") { const r = T.reconcile($app); out(r); if (r.review > 0 || r.stuck > 0) $os.exit(1); return; }
  if (sub === "purge") { out(T.purge($app, { dryRun: rest[1] === "dry" })); return; }
  if (sub === "review") { // un operador resuelve una anomalía tras comprobarla en la banca en línea
    if (rest.length !== 3) die("uso: pbmini:spei review <id> paid|failed confirm"); need();
    try { out(T.reviewResolve($app, rest[1], rest[2], "cli")); } catch (err) { die(String(err.message || err)); } return;
  }
  if (sub === "check") { // consulta a Banxico SIN crear ni tocar ninguna orden: pbmini:spei check <clave> <código-banco-emisor> <pesos> [dd-mm-aaaa] [n.º de cuenta]
    if (rest.length < 4 || rest.length > 6) die("uso: pbmini:spei check <clave-de-rastreo> <código-banco-emisor> <pesos> [dd-mm-aaaa] [n.º de cuenta del archivo, desde 1]");
    const tracking = T.core.trackingKey(rest[1]), cents = T.core.bxCents(rest[3]), date = rest[4] ? T.core.parseDate(rest[4]) : T.core.mxDate(Date.now()), accs = T.accounts(), a = accs[(rest[5] ? Number(rest[5]) : 1) - 1];
    if (!tracking) die("clave de rastreo inválida (8 a 30 caracteres [A-Za-z0-9_.-])"); if (cents === null || cents < 1) die("monto inválido"); if (!date) die("fecha inválida (dd-mm-aaaa)"); if (!a) die("n.º de cuenta fuera del archivo de cuentas");
    const bx = T.bxQuery({ tracking, date, emisor: rest[2], receptor: a.bank, account: a.account, amountCents: cents });
    if (bx.error) { console.log("-- Banxico no respondió con una tabla: " + bx.error); $os.exit(1); }
    if (!bx.found) { console.log("-- Banxico: operación NO encontrada con esos datos (la clave se busca exacta: mayúsculas y guiones cuentan; el monto, el emisor, la cuenta y la fecha deben coincidir)"); $os.exit(1); }
    return out({ encontrada: true, estado: bx.status, monto: bx.amountCents / 100, cuenta: tail(bx.account), procesada: bx.processedMs ? new Date(bx.processedMs).toISOString() : null, clave: bx.tracking, emisor: bx.issuing, receptor: bx.receiving });
  }
  die("uso: pbmini:spei status | show <id> | reconcile | purge [dry] | review <id> paid|failed confirm | check <clave> <banco> <pesos> [fecha] [n.º cuenta]");
}
module.exports = { routes, create, access, telegram, clip, spei };
