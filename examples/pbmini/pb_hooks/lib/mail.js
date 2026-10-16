// Correo con plantillas: pb_hooks/mails/<nombre>.html (cuerpo, autoescapado) + <nombre>.subject.txt (asunto con {variables}).
//  - Un solo destinatario, validado con una expresión estricta (sin CR/LF, comas ni <>: nada de inyección de cabeceras).
//  - Remitente SIEMPRE el de Ajustes > Correo; el asunto sale de la plantilla (sin saltos de línea, ≤150).
//  - Límites por destinatario y globales por hora (anti mail-bombing), en el almacén compartido; no se permite desde GET.
const cfg = () => require(`${__hooks}/lib/config.js`).load().mail;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ADDR = /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?){0,6}\.[A-Za-z]{2,24}$/;
const VAR = /\{([a-z_][a-z0-9_]*)\}/g;
const fail = (m) => { throw new Error("pbmini mail: " + m); };
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function httpError(status, msg) { const err = new Error(msg); err.pbminiStatus = status; return err; }

let _tpl = null; // por runtime: nombre -> {html, subject}
function templates() {
  if (_tpl) return _tpl;
  const out = Object.create(null), dir = `${__hooks}/mails`;
  if (exists(dir)) {
    const ents = $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1));
    ents.forEach((e) => {
      if (e.name.charAt(0) === ".") return;
      if (e.dir || e.type !== 0) fail(`mails/${e.name}: solo archivos regulares`);
      const m = /^([a-z0-9][a-z0-9_-]{0,63})\.(html|subject\.txt)$/.exec(e.name);
      if (!m) fail(`mails/${e.name}: use <nombre>.html y <nombre>.subject.txt (minúsculas, dígitos, _ -)`);
      (out[m[1]] = out[m[1]] || {})[m[2] === "html" ? "html" : "subject"] = `${dir}/${e.name}`;
    });
    Object.keys(out).forEach((n) => {
      if (!out[n].html || !out[n].subject) fail(`mails/${n}: faltan ${n}.html o ${n}.subject.txt`);
      const subj = toString($os.readFile(out[n].subject));
      if (subj.length > 300 || /[\r\n]./.test(subj.replace(/\r?\n$/, ""))) fail(`mails/${n}.subject.txt: debe ser una sola línea de hasta 300 caracteres`);
    });
  }
  return (_tpl = out);
}
const validate = () => { templates(); cfg(); }; // registro: aborta si hay plantillas o configuración inválidas

function bump(key, limit) { // contador por hora en el almacén compartido (cadenas); false => excedido
  const store = $app.store(), k = "pbmini:m:" + key + ":" + Math.floor(Date.now() / 3600000);
  const n = (Number(store.get(k)) || 0) + 1;
  if (n > limit) return false;
  store.set(k, String(n)); return true;
}
function send(e, route, name, opt) {
  if (route.method === "GET") throw new Error("pbmini: ctx.mail no se permite en GET (podría dispararse con un enlace)");
  if (typeof name !== "string" || !NAME.test(name) || !templates()[name]) throw new Error(`pbmini: plantilla de correo desconocida: ${name}`);
  if (!opt || typeof opt !== "object") throw new Error("pbmini: ctx.mail requiere {to, data}");
  Object.keys(opt).forEach((k) => { if (k !== "to" && k !== "data") throw new Error(`pbmini: opción de correo desconocida: ${k}`); });
  const to = opt.to;
  if (typeof to !== "string" || to.length > 254 || !ADDR.test(to) || /\.\./.test(to)) throw new Error("pbmini: destinatario inválido");
  const data = opt.data === undefined ? {} : opt.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("pbmini: data debe ser un objeto");
  const c = cfg();
  if (!bump("g", c.maxPerHour) || !bump("r:" + $security.sha256(to.toLowerCase()), c.maxPerRecipientPerHour)) throw httpError(429, "too many emails");
  const t = templates()[name];
  const subject = toString($os.readFile(t.subject)).replace(/\r?\n$/, "").replace(VAR, (m, n) => (hasOwn(data, n) ? String(data[n]) : m)).replace(/[\x00-\x1f\x7f  ]/g, " ").slice(0, 150);
  const html = $template.loadFiles(t.html).render(data); // autoescape de html/template
  const meta = $app.settings().meta;
  if (!meta.senderAddress) throw new Error("pbmini: configura el remitente en Ajustes > Correo");
  $app.newMailClient().send(new MailerMessage({ from: { address: meta.senderAddress, name: meta.senderName }, to: [{ address: to }], subject, html }));
  return true;
}
module.exports = { send, validate, templates };
