// Arnés de prueba: NO es PocketPages. Imita lo mínimo (EJS + SDK síncrono) para ejercitar plantillas y lib.js.
const fs = require('fs'), path = require('path'), cp = require('child_process')
const PB = 'http://127.0.0.1:8095'
const PAGES = path.resolve(__dirname, '../../app/pb_hooks/pages')

function http(method, url, token, body) {
  const a = ['-s', '-g', '-X', method, '-w', '\n%{http_code}', '-H', 'Content-Type: application/json']
  if (token) a.push('-H', 'Authorization: ' + token)
  if (body) a.push('-d', JSON.stringify(body))
  a.push(PB + url)
  const out = cp.execFileSync('curl', a, { encoding: 'utf8' })
  const i = out.lastIndexOf('\n')
  const status = +out.slice(i + 1), json = out.slice(0, i) ? JSON.parse(out.slice(0, i)) : {}
  if (status >= 400) throw Object.assign(new Error(json.message || 'error'), { status, response: json })
  return json
}
const qs = (o) => Object.keys(o || {}).filter((k) => o[k] !== undefined).map((k) => k + '=' + encodeURIComponent(o[k])).join('&')
function cliente(token) {
  return { collection: (c) => ({
    getFullList: (o) => http('GET', `/api/collections/${c}/records?perPage=500&${qs(o)}`, token).items,
    getOne: (id, o) => http('GET', `/api/collections/${c}/records/${id}?${qs(o)}`, token),
    create: (d) => http('POST', `/api/collections/${c}/records`, token, d),
    update: (id, d) => http('PATCH', `/api/collections/${c}/records/${id}`, token, d),
  }) }
}

class Redirect { constructor(to, flash) { this.to = to; this.flash = flash } }
function compile(src) {
  let pre = ''
  src = src.replace(/<script server>([\s\S]*?)<\/script>/, (_, c) => { pre = c; return '' })
  let code = pre + '\n;let __o="";\n', pos = 0
  const re = /<%([-=#]?)([\s\S]*?)%>/g; let m
  while ((m = re.exec(src))) {
    code += '__o+=' + JSON.stringify(src.slice(pos, m.index)) + ';\n'
    if (m[1] === '-') code += '__o+=(' + m[2] + ');\n'
    else if (m[1] === '=') code += '__o+=__esc(' + m[2] + ');\n'
    else if (m[1] === '') code += m[2] + '\n'
    pos = re.lastIndex
  }
  code += '__o+=' + JSON.stringify(src.slice(pos)) + ';\nreturn __o'
  return new Function('ctx', '__esc', 'with(ctx){' + code + '}')
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function buscarPrivado(desdeDir, nombre) {
  let d = desdeDir
  for (;;) {
    for (const n of [nombre, nombre + '.ejs', nombre + '.js']) { const p = path.join(d, '_private', n); if (fs.existsSync(p)) return p }
    if (d === PAGES) throw new Error('no encuentro ' + nombre)
    d = path.dirname(d)
  }
}
function render(archivo, base, extra) {
  const dir = path.dirname(archivo)
  const ctx = Object.assign({}, base, extra, {
    include: (n, datos) => render(buscarPrivado(dir, n), base, datos),
    resolve: (n) => { const p = buscarPrivado(dir, n); const m = { exports: {} }; new Function('module', 'exports', 'require', fs.readFileSync(p, 'utf8'))(m, m.exports, require); return m.exports },
  })
  return compile(fs.readFileSync(archivo, 'utf8'))(ctx, esc)
}
function layouts(archivo) {
  const out = []; let d = path.dirname(archivo)
  for (;;) { const p = path.join(d, '+layout.ejs'); if (fs.existsSync(p)) out.push(p); if (d === PAGES) break; d = path.dirname(d) }
  return out
}
function ruta(url) { // resolución mínima de rutas
  const segs = url.split('/').filter(Boolean); const params = {}
  function dirs(d) { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory() && x.name[0] !== '_') }
  function buscar(d, i) {
    if (i === segs.length) { for (const f of ['index.ejs']) if (fs.existsSync(path.join(d, f))) return path.join(d, f)
      for (const g of dirs(d).filter((x) => /^\(.*\)$/.test(x.name))) { const r = buscar(path.join(d, g.name), i); if (r) return r } return null }
    const f = path.join(d, segs[i] + '.ejs'); if (i === segs.length - 1 && fs.existsSync(f)) return f
    for (const x of dirs(d)) {
      if (x.name === segs[i]) { const r = buscar(path.join(d, x.name), i + 1); if (r) return r }
      else if (/^\[.*\]$/.test(x.name)) { const r = buscar(path.join(d, x.name), i + 1); if (r) { params[x.name.slice(1, -1)] = segs[i]; return r } }
      else if (/^\(.*\)$/.test(x.name)) { const r = buscar(path.join(d, x.name), i); if (r) return r }
    }
    return null
  }
  return { archivo: buscar(PAGES, 0), params }
}

// sesión simulada
let token = null, usuario = null
function pedir(metodo, urlCompleta, form) {
  const u = new URL(urlCompleta, 'http://x')
  const { archivo, params: pr } = ruta(u.pathname)
  if (!archivo) return { status: 404 }
  const params = Object.assign({}, Object.fromEntries(u.searchParams), pr)
  const auth = usuario ? { get: (k) => usuario[k], id: usuario.id } : null
  const redirect = (to, f) => { throw new Redirect(to, f && f.message) }
  // middleware
  const ruta0 = u.pathname
  if (!auth && ruta0 !== '/login' && !ruta0.startsWith('/assets/')) return { status: 302, location: '/login', flash: 'Ingresa para continuar' }
  const base = {
    auth, params, request: { method: metodo, url: { pathname: u.pathname }, token }, redirect,
    body: () => form || {}, pb: ({ request }) => cliente(request.token),
    signInWithPassword: (id, pw) => { const r = http('POST', '/api/collections/users/auth-with-password', null, { identity: id, password: pw }); token = r.token; usuario = r.record; return r.record },
    signOut: () => { token = null; usuario = null }, dbg() {}, console,
  }
  try {
    let html = render(archivo, base)
    for (const l of layouts(archivo)) html = render(l, Object.assign({}, base, { auth: usuario ? base.auth : null }), { slot: html })
    return { status: 200, html }
  } catch (e) {
    if (e instanceof Redirect) return { status: 302, location: e.to, flash: e.flash }
    throw e
  }
}
module.exports = { pedir, http, cliente }

if (require.main === module) {
  const log = (t, r) => console.log('\n=== ' + t + ' -> ' + r.status + (r.location ? ' ' + r.location + ' [' + (r.flash || '') + ']' : ''))
  const txt = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
  let r = pedir('GET', '/calendario'); log('sin sesión /calendario', r)
  r = pedir('POST', '/login', { identity: 'dueno@local.test', password: 'mala' }); log('login mal', r); console.log(txt(r.html).slice(0, 200))
  r = pedir('POST', '/login', { identity: 'asist@local.test', password: 'Prueba12345' }); log('login asist', r)
  r = pedir('GET', '/'); log('/', r)
  r = pedir('GET', '/calendario?mes=2026-10'); log('calendario 2026-10', r); console.log(txt(r.html).slice(0, 1500))
  fs.writeFileSync(path.join(__dirname, 'cal.html'), r.html)
  r = pedir('GET', '/calendario?mes=2026-13'); log('mes inválido (cae al actual)', r); console.log(txt(r.html).slice(0, 150))
  r = pedir('GET', '/carga?dias=14'); log('carga 14d', r); console.log(txt(r.html).slice(0, 1500))
  r = pedir('GET', '/xapi/carga?dias=14'); log('xapi carga (sin layout)', r); console.log(r.html.includes('<html'), r.html.length)
  const ids = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/seed_ids.json')))
  console.log('ids', JSON.stringify(ids).slice(0, 300))
}
