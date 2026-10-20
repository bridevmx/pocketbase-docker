// Envío simple de avisos desde CUALQUIER parte del proyecto (hooks, cron, otros módulos, rutas). Despacha a los canales habilitados (hoy: Telegram).
//   require(`${__hooks}/lib/notify.js`).send($app, { user: idUsuario }, "texto")
//   require(`${__hooks}/lib/notify.js`).send($app, { group: "staff" }, { title: "Aviso", text: "…", key: "aviso-1" })
//   require(`${__hooks}/lib/notify.js`).send($app, { ops: true }, "algo falló")           // chats de operadores
// En rutas: ctx.notify({ user: "me" }, "texto") (no desde GET ni rutas públicas). Lanza si no hay canal o el mensaje es inválido: en hooks va dentro de try/catch (un aviso nunca debe romper un guardado).
const NAME = /^[a-z0-9][a-z0-9_]{0,31}$/;
const ID = /^[a-z0-9]{15}$/;
const cfg = () => require(`${__hooks}/lib/config.js`).load();
const channels = () => { const c = cfg(), out = []; if (c.telegram.enabled) out.push("telegram"); return out; };

// Valida el destino: exactamente uno de {user}, {group} u {ops:true}.
function target(to, e) {
  if (to === null || typeof to !== "object" || Array.isArray(to)) throw new Error("pbmini notify: el destino debe ser { user } | { group } | { ops: true }");
  const k = Object.keys(to);
  if (k.length !== 1) throw new Error("pbmini notify: el destino debe tener exactamente una clave: user, group u ops");
  if (k[0] === "user") {
    if (to.user === "me") { if (!e || !e.auth || e.hasSuperuserAuth()) throw new Error("pbmini notify: { user: \"me\" } requiere un usuario autenticado"); return { user: e.auth.id }; }
    if (typeof to.user !== "string" || !ID.test(to.user)) throw new Error("pbmini notify: user debe ser el id de un usuario");
    return { user: to.user };
  }
  if (k[0] === "group") { if (typeof to.group !== "string" || !NAME.test(to.group)) throw new Error("pbmini notify: nombre de grupo inválido"); return { group: to.group }; }
  if (k[0] === "ops") { if (to.ops !== true) throw new Error("pbmini notify: ops debe ser true"); return { ops: true }; }
  throw new Error(`pbmini notify: destino desconocido: ${k[0]}`);
}
const message = (m) => (typeof m === "string" ? { text: m } : m);

function send(app, to, msg, opt) {
  const ch = channels();
  if (!ch.length) throw new Error("pbmini notify: ningún canal habilitado (telegram.enabled en pbmini.config.js)");
  const t = target(to, null), m = message(msg), out = {};
  ch.forEach((c) => { out[c] = require(`${__hooks}/lib/${c}.js`).send(app, t, m, opt); });
  return out;
}
// ctx.notify(destino, mensaje, opt): mismas reglas que ctx.telegram (no GET, no rutas públicas); { user: "me" } = usuario autenticado.
function ctxSend(e, route, to, msg, opt) {
  if (route.method === "GET") throw new Error("pbmini: ctx.notify no se permite en GET (podría dispararse con un enlace)");
  if (route.auth === "public") throw new Error("pbmini: ctx.notify no se permite en rutas públicas (auth: \"user\" o \"superuser\")");
  const ch = channels();
  if (!ch.length) throw new Error("pbmini notify: ningún canal habilitado (telegram.enabled en pbmini.config.js)");
  const t = target(to, e), m = message(msg), out = {};
  ch.forEach((c) => { out[c] = require(`${__hooks}/lib/${c}.js`).send($app, t, m, opt); });
  return out;
}
module.exports = { send, ctxSend, channels };
