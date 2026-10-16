// Tareas programadas por archivo: pb_hooks/cron/<id>.js  =>  module.exports = { schedule: "*/5 * * * *", run(app) { ... } }
// Registra cada una con cronAdd("pbmini_<id>", ...) al arrancar. El id y la expresión se validan (fail-closed). Se pueden ver y lanzar a mano en
// Ajustes > Crons del panel, o con POST /api/crons/pbmini_<id> (superusuario). `run` recibe `app` ($app): no uses `$app` en el archivo (el lint lo marca).
const ID = /^[a-z0-9][a-z0-9_]{0,31}$/;
const FIELD = "(?:\\*|[0-9]{1,2}(?:-[0-9]{1,2})?)(?:/[0-9]{1,2})?";
const EXPR = new RegExp("^" + FIELD + "(?:," + FIELD + "){0,15}(?: " + FIELD + "(?:," + FIELD + "){0,15}){4}$");
const MACROS = ["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"];
const BOUNDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]; // minuto, hora, día del mes, mes, día de la semana
const fail = (m) => { throw new Error("pbmini cron: " + m); };
function inRange(expr) { // la forma ya cumple EXPR; aquí se validan los valores (PocketBase acepta "61 25 * * *" y nunca lo ejecutaría)
  return expr.split(" ").every((f, i) => f.split(",").every((part) => {
    const m = /^(\*|([0-9]{1,2})(?:-([0-9]{1,2}))?)(?:\/([0-9]{1,2}))?$/.exec(part), [lo, hi] = BOUNDS[i];
    if (!m) return false;
    if (m[4] !== undefined && Number(m[4]) < 1) return false;
    if (m[1] === "*") return true;
    const a = Number(m[2]), b = m[3] === undefined ? a : Number(m[3]);
    return a >= lo && b <= hi && a <= b;
  }));
}
const exists = (f) => { try { $os.stat(f); return true; } catch (_) { return false; } };

function jobs() { // [{id, schedule}] validados
  const dir = `${__hooks}/cron`, out = [];
  if (!exists(dir)) return out;
  $os.readDir(dir).map((d) => ({ name: d.name(), dir: d.isDir(), type: Number(d.type()) })).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
    if (e.name.charAt(0) === ".") return;
    if (e.dir || e.type !== 0) fail(`cron/${e.name}: solo archivos .js regulares`);
    const m = /^(.+)\.js$/.exec(e.name);
    if (!m || !ID.test(m[1])) fail(`cron/${e.name}: el nombre debe ser <id>.js (minúsculas, dígitos y _; máx. 32)`);
    const mod = require(`${dir}/${e.name}`);
    if (!mod || typeof mod !== "object") fail(`cron/${e.name} debe exportar un objeto`);
    Object.keys(mod).forEach((k) => { if (k !== "schedule" && k !== "run") fail(`cron/${e.name}: clave desconocida "${k}"`); });
    if (typeof mod.run !== "function") fail(`cron/${e.name}: run debe ser una función`);
    if (typeof mod.schedule !== "string" || mod.schedule.length > 100 || !((EXPR.test(mod.schedule) && inRange(mod.schedule)) || MACROS.indexOf(mod.schedule) >= 0)) fail(`cron/${e.name}: schedule inválido (5 campos "m h dom mon dow" o un macro como @hourly)`);
    out.push({ id: m[1], schedule: mod.schedule });
  });
  return out;
}
// Cuerpo de cada ejecución (VM aislada del cron): errores al registro, nunca tumban el proceso.
function run(id) {
  try { require(`${__hooks}/cron/${id}.js`).run($app); } catch (err) { $app.logger().error("pbmini cron falló", "job", id, "error", String(err)); }
}
module.exports = { jobs, run };
