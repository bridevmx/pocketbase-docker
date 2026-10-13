// Lógica de las páginas: fechas, calendario, lista de carga y consultas.
// CommonJS sin dependencias ni async, para el JSVM de PocketBase.
// Se carga en las plantillas con: const L = resolve('lib')
// Las consultas reciben un cliente del SDK (pb({ request })), así las API Rules
// y los hooks de PocketBase se aplican con el usuario que inició sesión.

// Zona horaria del negocio: México, UTC-6 (sin horario de verano desde 2022).
var OFFSET_MS = -6 * 3600 * 1000

var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
var DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

// ---------- fechas ----------

function dos(n) {
  return (n < 10 ? '0' : '') + n
}

// "2026-10-17 16:00:00.000Z" (formato de PocketBase, UTC) -> milisegundos
function aMs(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '')
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

// milisegundos -> "2026-10-17 16:00:00.000Z"
function aPB(ms) {
  var d = new Date(ms)
  return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate()) + ' ' +
    dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes()) + ':' + dos(d.getUTCSeconds()) + '.000Z'
}

function local(ms) {
  var d = new Date(ms + OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}

function ymd(y, m, d) {
  return y + '-' + dos(m) + '-' + dos(d)
}

// fecha local "AAAA-MM-DD" de un valor de PocketBase
function fechaLocal(s) {
  var p = local(aMs(s))
  return ymd(p.y, p.m, p.d)
}

function horaLocal(s) {
  var p = local(aMs(s))
  return dos(p.h) + ':' + dos(p.mi)
}

function hoyLocal(ahoraMs) {
  var p = local(ahoraMs)
  return ymd(p.y, p.m, p.d)
}

function partes(f) {
  var p = f.split('-')
  return { y: +p[0], m: +p[1], d: +p[2] }
}

function sumarDias(f, n) {
  var p = partes(f)
  var d = new Date(Date.UTC(p.y, p.m - 1, p.d + n))
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

// 0 = domingo
function diaSemana(f) {
  var p = partes(f)
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
}

// instante UTC (ms) en que empieza el día local f
function inicioDiaMs(f) {
  var p = partes(f)
  return Date.UTC(p.y, p.m - 1, p.d) - OFFSET_MS
}

function mesDe(f) {
  return f.slice(0, 7)
}

function mesValido(ym) {
  return typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym)
}

function mesMas(ym, delta) {
  var p = ym.split('-')
  var d = new Date(Date.UTC(+p[0], +p[1] - 1 + delta, 1))
  return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1)
}

function nombreMes(ym) {
  var p = ym.split('-')
  return MESES[+p[1] - 1] + ' ' + p[0]
}

// "sáb 17 oct"
function etiquetaDia(f) {
  var p = partes(f)
  return DIAS_CORTOS[diaSemana(f)] + ' ' + p.d + ' ' + MESES_CORTOS[p.m - 1]
}

// ---------- formato ----------

function mxn(n) {
  n = Number(n) || 0
  var neg = n < 0
  var s = Math.abs(Math.round(n * 100) / 100).toFixed(2).split('.')
  var ent = s[0]
  var out = ''
  while (ent.length > 3) {
    out = ',' + ent.slice(-3) + out
    ent = ent.slice(0, -3)
  }
  out = ent + out
  return (neg ? '-' : '') + '$' + out + (s[1] === '00' ? '' : '.' + s[1])
}

function cantidad(n, unidad) {
  n = Number(n) || 0
  var r = function (x) { return Math.round(x * 100) / 100 }
  if (unidad === 'g') return n >= 1000 ? r(n / 1000) + ' kg' : r(n) + ' g'
  if (unidad === 'ml') return n >= 1000 ? r(n / 1000) + ' L' : r(n) + ' ml'
  if (unidad === 'm') return r(n) + ' m'
  return r(n) + (r(n) === 1 ? ' pza' : ' pzas')
}

// Mensajes genéricos de PocketBase (en inglés) -> español. Los de los hooks ya vienen en español.
var GENERICOS = {
  'Failed to create record': 'No se pudo guardar. Revisa los datos o tus permisos.',
  'Failed to update record': 'No se pudo actualizar. Revisa los datos o tus permisos.',
  "The requested resource wasn't found": 'No se encontró (o no tienes permiso para verlo).',
  'Failed to load the requested resource': 'No se pudo cargar la información.',
  'Something went wrong while processing your request': 'Algo falló al procesar la solicitud.',
  'Failed to authenticate': 'Correo o contraseña incorrectos.'
}

function mensajeError(e) {
  if (!e) return 'Error desconocido'
  var r = e.response || {}
  var partesMsg = []
  if (r.message) {
    var m = String(r.message).replace(/\.$/, '')
    partesMsg.push(GENERICOS[m] || m)
  }
  var d = r.data || {}
  for (var k in d) {
    if (d[k] && d[k].message) partesMsg.push(k + ': ' + String(d[k].message).replace(/\.$/, ''))
  }
  return partesMsg.length ? partesMsg.join(' · ') : (e.message || String(e))
}

// ---------- calendario ----------

// Rejilla del mes (semanas de lunes a domingo) y rango UTC para consultar.
function rejilla(ym) {
  var p = ym.split('-')
  var primero = ymd(+p[0], +p[1], 1)
  var offset = (diaSemana(primero) + 6) % 7
  var inicio = sumarDias(primero, -offset)
  var diasMes = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate()
  var nSemanas = Math.ceil((offset + diasMes) / 7)
  var semanas = []
  for (var i = 0; i < nSemanas; i++) {
    var fila = []
    for (var j = 0; j < 7; j++) {
      var f = sumarDias(inicio, i * 7 + j)
      fila.push({ fecha: f, dia: +f.slice(8), enMes: mesDe(f) === ym, eventos: [] })
    }
    semanas.push(fila)
  }
  var fin = sumarDias(inicio, nSemanas * 7)
  return {
    ym: ym,
    nombre: nombreMes(ym),
    anterior: mesMas(ym, -1),
    siguiente: mesMas(ym, 1),
    semanas: semanas,
    desde: aPB(inicioDiaMs(inicio)),
    hasta: aPB(inicioDiaMs(fin))
  }
}

// ---------- consultas ----------

function idValido(id) {
  return typeof id === 'string' && /^[a-z0-9]{15}$/.test(id)
}

function filtroIds(campo, ids) {
  return ids.map(function (id) { return campo + ' = "' + id + '"' }).join(' || ')
}

function lotes(ids, n) {
  var out = []
  for (var i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n))
  return out
}

function listar(c, coleccion, opciones) {
  return c.collection(coleccion).getFullList(opciones || {})
}

// Filas de una colección/vista para una lista de eventos (en lotes para no alargar la URL)
function porEventos(c, coleccion, campo, ids, extra) {
  var filas = []
  lotes(ids, 40).forEach(function (lote) {
    var o = { filter: filtroIds(campo, lote) }
    for (var k in (extra || {})) o[k] = extra[k]
    filas = filas.concat(listar(c, coleccion, o))
  })
  return filas
}

// Eventos con alguna reserva mayor a las piezas libres en su horario.
function eventosConChoque(reservas, disponibilidad) {
  var libres = {}
  disponibilidad.forEach(function (d) { libres[d.evento + '|' + d.activo] = d.libres })
  var choque = {}
  reservas.forEach(function (r) {
    var l = libres[r.evento + '|' + r.activo]
    if (l !== undefined && r.cantidad > l) choque[r.evento] = true
  })
  return choque
}

function consultaCalendario(c, ym, ahoraMs) {
  var g = rejilla(ym)
  var evs = listar(c, 'eventos', {
    filter: 'estado != "cancelado" && montaje_inicio >= "' + g.desde + '" && montaje_inicio < "' + g.hasta + '"',
    sort: 'montaje_inicio',
    expand: 'cliente'
  })
  var ids = evs.map(function (e) { return e.id })
  var saldos = {}
  porEventos(c, 'v_saldos_evento', 'id', ids).forEach(function (s) { saldos[s.id] = s })
  var choque = eventosConChoque(
    porEventos(c, 'reservas_activos', 'evento', ids),
    porEventos(c, 'v_disponibilidad_activos', 'evento', ids)
  )
  var celdas = {}
  g.semanas.forEach(function (sem) { sem.forEach(function (celda) { celdas[celda.fecha] = celda }) })
  evs.forEach(function (e) {
    var celda = celdas[fechaLocal(e.montaje_inicio)]
    if (!celda) return
    var s = saldos[e.id]
    var cliente = e.expand && e.expand.cliente
    celda.eventos.push({
      id: e.id,
      folio: e.folio,
      titulo: e.titulo || e.tema || '',
      cliente: cliente ? cliente.nombre : '',
      estado: e.estado,
      hora: horaLocal(e.montaje_inicio),
      choque: !!choque[e.id],
      debe: s && e.estado !== 'realizado' ? Math.max(0, s.total - s.pagado) : 0
    })
  })
  return { rejilla: g, total: evs.length, hoy: hoyLocal(ahoraMs) }
}

function consultaEvento(c, id) {
  if (!idValido(id)) throw { message: 'Evento no válido', response: { message: 'Evento no válido' } }
  var e = c.collection('eventos').getOne(id, { expand: 'cliente' })
  var saldo = c.collection('v_saldos_evento').getOne(id)
  var filtro = 'evento = "' + id + '"'
  var lineas = listar(c, 'evento_lineas', { filter: filtro, sort: 'orden' })
  var pagos = listar(c, 'pagos', { filter: filtro, sort: 'fecha' })
  var reservas = listar(c, 'reservas_activos', { filter: filtro, expand: 'activo' })
  var disp = listar(c, 'v_disponibilidad_activos', { filter: filtro })
  var choque = {}
  disp.forEach(function (d) { choque[d.activo] = d.libres })
  var anticipoRequerido = Math.round(saldo.total * (e.porcentaje_anticipo || 0)) / 100
  return {
    evento: e,
    cliente: e.expand && e.expand.cliente ? e.expand.cliente : null,
    fecha: etiquetaDia(fechaLocal(e.montaje_inicio)),
    montaje: horaLocal(e.montaje_inicio),
    inicio: e.evento_inicio ? horaLocal(e.evento_inicio) : '',
    desmontaje: horaLocal(e.desmontaje_fin),
    saldo: saldo,
    pendiente: Math.max(0, saldo.total - saldo.pagado),
    anticipoRequerido: anticipoRequerido,
    faltaAnticipo: Math.max(0, anticipoRequerido - saldo.pagado),
    lineas: lineas.map(function (l) {
      return {
        descripcion: l.descripcion || l.tipo,
        tipo: l.tipo,
        cantidad: l.cantidad,
        precio: l.precio_unitario,
        importe: l.cantidad * l.precio_unitario,
        opcional: !!l.es_opcional
      }
    }),
    pagos: pagos,
    reservas: reservas.map(function (r) {
      var libres = choque[r.activo]
      return {
        nombre: r.expand && r.expand.activo ? r.expand.activo.nombre : r.activo,
        cantidad: r.cantidad,
        libres: libres,
        choque: libres !== undefined && r.cantidad > libres
      }
    })
  }
}

// Qué cargar para los eventos apartados de los próximos `dias` días, con faltantes de stock.
function consultaCarga(c, ahoraMs, dias) {
  dias = Math.max(1, Math.min(31, parseInt(dias, 10) || 7))
  var desdeF = hoyLocal(ahoraMs)
  var hastaF = sumarDias(desdeF, dias)
  var desde = aPB(inicioDiaMs(desdeF))
  var hasta = aPB(inicioDiaMs(hastaF))
  var evs = listar(c, 'eventos', {
    filter: 'estado = "apartado" && montaje_inicio >= "' + desde + '" && montaje_inicio < "' + hasta + '"',
    sort: 'montaje_inicio',
    expand: 'cliente'
  })
  var ids = evs.map(function (e) { return e.id })
  var filas = porEventos(c, 'v_lista_de_carga', 'evento', ids)
  var reservas = porEventos(c, 'reservas_activos', 'evento', ids, { expand: 'activo' })
  var disp = porEventos(c, 'v_disponibilidad_activos', 'evento', ids)
  var insumos = {}
  listar(c, 'insumos').forEach(function (i) { insumos[i.id] = i })
  var stock = {}
  listar(c, 'v_stock_insumos').forEach(function (s) { stock[s.id] = s })
  return agrupar({
    evs: evs, filas: filas, reservas: reservas, disp: disp, insumos: insumos, stock: stock,
    dias: dias, desdeF: desdeF, hastaF: hastaF
  })
}

function agrupar(x) {
  var choque = eventosConChoque(x.reservas, x.disp)
  var libres = {}
  x.disp.forEach(function (d) { libres[d.evento + '|' + d.activo] = d.libres })
  var totales = {}
  var eventos = x.evs.map(function (e) {
    var cliente = e.expand && e.expand.cliente
    var items = x.filas.filter(function (f) { return f.evento === e.id }).map(function (f) {
      var ins = x.insumos[f.insumo] || {}
      var unidad = ins.unidad_base || 'pieza'
      var t = totales[f.insumo] || (totales[f.insumo] = { id: f.insumo, nombre: f.nombre, unidad: unidad, necesaria: 0 })
      t.necesaria += f.cantidad_necesaria
      return {
        key: e.id + ':' + f.insumo,
        nombre: f.nombre,
        texto: cantidad(f.cantidad_necesaria, unidad)
      }
    })
    items.sort(function (a, b) { return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0 })
    var estructuras = x.reservas.filter(function (r) { return r.evento === e.id }).map(function (r) {
      var l = libres[r.evento + '|' + r.activo]
      return {
        key: e.id + ':a:' + r.activo,
        nombre: r.expand && r.expand.activo ? r.expand.activo.nombre : r.activo,
        texto: r.cantidad + (r.cantidad === 1 ? ' pieza' : ' piezas'),
        choque: l !== undefined && r.cantidad > l
      }
    })
    return {
      id: e.id,
      folio: e.folio,
      titulo: e.titulo || e.tema || '',
      cliente: cliente ? cliente.nombre : '',
      fecha: etiquetaDia(fechaLocal(e.montaje_inicio)),
      hora: horaLocal(e.montaje_inicio),
      choque: !!choque[e.id],
      estructuras: estructuras,
      insumos: items
    }
  })
  var lista = []
  for (var id in totales) {
    var t = totales[id]
    var s = x.stock[id] || { stock_actual: 0, stock_minimo: 0 }
    var falta = Math.max(0, t.necesaria - s.stock_actual)
    lista.push({
      id: id,
      nombre: t.nombre,
      necesaria: cantidad(t.necesaria, t.unidad),
      stock: cantidad(s.stock_actual, t.unidad),
      faltante: falta,
      faltanteTexto: falta > 0 ? cantidad(falta, t.unidad) : '',
      bajoMinimo: s.stock_actual < s.stock_minimo
    })
  }
  lista.sort(function (a, b) {
    if ((b.faltante > 0) !== (a.faltante > 0)) return b.faltante > 0 ? 1 : -1
    return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0
  })
  return {
    dias: x.dias,
    desdeF: x.desdeF,
    hastaF: x.hastaF,
    eventos: eventos,
    totales: lista,
    hayFaltantes: lista.some(function (t) { return t.faltante > 0 }),
    hayChoques: eventos.some(function (e) { return e.choque })
  }
}

module.exports = {
  aMs: aMs, aPB: aPB, fechaLocal: fechaLocal, horaLocal: horaLocal, hoyLocal: hoyLocal,
  sumarDias: sumarDias, mesDe: mesDe, mesValido: mesValido, nombreMes: nombreMes, etiquetaDia: etiquetaDia,
  rejilla: rejilla, mxn: mxn, cantidad: cantidad, mensajeError: mensajeError, idValido: idValido,
  consultaCalendario: consultaCalendario, consultaEvento: consultaEvento, consultaCarga: consultaCarga,
  agrupar: agrupar
}
