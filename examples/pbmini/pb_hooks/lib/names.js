// Reglas de nombres de carpetas y archivos de pages/ (las comparten el cargador pages.js y el generador pbmini:new).
const PLAIN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const plain = (s) => PLAIN.test(s) && s.indexOf("..") < 0;

// Carpeta => {seg, wild, param} o null si el nombre no está permitido. `[x]` => {x}, `[...x]` => {x...}.
function dirSegment(name) {
  let m;
  if ((m = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]{0,31})\]$/.exec(name))) return { seg: "{" + m[1] + "...}", wild: true, param: m[1] };
  if ((m = /^\[([A-Za-z_][A-Za-z0-9_]{0,31})\]$/.exec(name))) return { seg: "{" + m[1] + "}", wild: false, param: m[1] };
  if (plain(name)) return { seg: name, wild: false, param: null };
  return null;
}
// Archivo (distinto de index) => segmento plano, o null. Un [param] plano está prohibido: los parámetros son carpetas.
const fileSegment = (base) => (!/^\[.*\]$/.test(base) && plain(base) ? base : null);

module.exports = { PLAIN, dirSegment, fileSegment };
