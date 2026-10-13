// Catálogos y formularios: definición de campos, lectura de formularios y utilidades de altas.
// Se carga en las plantillas con: const C = resolve('crud')

function opts(pares) {
  return pares.map(function (p) { return typeof p === 'string' ? [p, p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, ' ')] : p })
}

var UNIDADES = opts(['pieza', 'g', 'ml', 'm'])

// dueno: solo el rol "dueno" puede crear/editar (reglas de la colección)
var ENT = {
  clientes: {
    col: 'clientes', plural: 'Clientes', singular: 'cliente', orden: 'nombre', buscar: ['nombre', 'telefono', 'instagram'],
    campos: [
      { n: 'nombre', label: 'Nombre', tipo: 'text', req: true },
      { n: 'telefono', label: 'Teléfono', tipo: 'text' },
      { n: 'instagram', label: 'Instagram', tipo: 'text' },
      { n: 'notas', label: 'Notas', tipo: 'text' }
    ],
    resumen: function (r) { return [r.telefono, r.instagram].filter(Boolean).join(' · ') }
  },
  servicios: {
    col: 'servicios', plural: 'Servicios', singular: 'servicio', orden: 'nombre', buscar: ['nombre', 'descripcion'], dueno: true, recetas: true,
    campos: [
      { n: 'nombre', label: 'Nombre', tipo: 'text', req: true },
      { n: 'tipo', label: 'Tipo', tipo: 'select', opts: opts([['decoracion_globos', 'Decoración con globos'], 'pinata', ['mesa_dulces', 'Mesa de dulces'], 'renta', 'montaje', 'traslado', 'otro']) },
      { n: 'descripcion', label: 'Descripción', tipo: 'text' },
      { n: 'unidad_venta', label: 'Se vende por', tipo: 'select', opts: opts(['pieza', 'metro', 'persona', 'evento']) },
      { n: 'precio_base', label: 'Precio base (MXN)', tipo: 'number' },
      { n: 'activo', label: 'Activo', tipo: 'bool', def: true }
    ],
    resumen: function (r, L) { return [r.tipo ? r.tipo.replace(/_/g, ' ') : '', r.precio_base ? L.mxn(r.precio_base) + ' / ' + (r.unidad_venta || '') : ''].filter(Boolean).join(' · ') }
  },
  insumos: {
    col: 'insumos', plural: 'Insumos', singular: 'insumo', orden: 'nombre', buscar: ['nombre', 'marca', 'color'], dueno: true,
    campos: [
      { n: 'nombre', label: 'Nombre', tipo: 'text', req: true },
      { n: 'categoria', label: 'Categoría', tipo: 'select', opts: opts(['globo', 'helio', 'dulce', ['papeleria', 'Papelería'], 'empaque', 'otro']) },
      { n: 'marca', label: 'Marca', tipo: 'text' },
      { n: 'color', label: 'Color', tipo: 'text' },
      { n: 'tamano', label: 'Tamaño', tipo: 'text' },
      { n: 'unidad_base', label: 'Unidad', tipo: 'select', opts: UNIDADES },
      { n: 'costo_unitario', label: 'Costo por unidad (MXN)', tipo: 'number' },
      { n: 'stock_minimo', label: 'Stock mínimo', tipo: 'number' },
      { n: 'caduca', label: 'Caduca', tipo: 'bool' },
      { n: 'activo', label: 'Activo', tipo: 'bool', def: true }
    ],
    resumen: function (r) { return [r.categoria, r.marca, r.color, r.tamano].filter(Boolean).join(' · ') }
  },
  activos: {
    col: 'activos', plural: 'Estructuras y activos', singular: 'activo', orden: 'nombre', buscar: ['nombre'], dueno: true,
    campos: [
      { n: 'nombre', label: 'Nombre', tipo: 'text', req: true },
      { n: 'categoria', label: 'Categoría', tipo: 'select', opts: opts(['base', 'mampara', 'arco', 'cilindro', 'otro']) },
      { n: 'cantidad_total', label: 'Piezas que tienes', tipo: 'number' },
      { n: 'costo_reposicion', label: 'Costo de reposición (MXN)', tipo: 'number' },
      { n: 'activo', label: 'Activo', tipo: 'bool', def: true }
    ],
    resumen: function (r) { return [r.categoria, r.cantidad_total + ' pzas'].filter(Boolean).join(' · ') }
  }
}

var CAMPOS_EVENTO = [
  { n: 'titulo', label: 'Título', tipo: 'text' },
  { n: 'tema', label: 'Tema', tipo: 'text' },
  { n: 'invitados', label: 'Invitados', tipo: 'number' },
  { n: 'montaje_inicio', label: 'Inicio de montaje', tipo: 'date', req: true },
  { n: 'evento_inicio', label: 'Inicio del evento', tipo: 'date' },
  { n: 'desmontaje_fin', label: 'Fin de desmontaje', tipo: 'date', req: true },
  { n: 'direccion', label: 'Dirección', tipo: 'text' },
  { n: 'mapa_url', label: 'Liga de mapa', tipo: 'text' },
  { n: 'notas_diseno', label: 'Notas de diseño', tipo: 'text' },
  { n: 'porcentaje_anticipo', label: '% de anticipo', tipo: 'number', def: 50 },
  { n: 'vigencia_hasta', label: 'Cotización vigente hasta', tipo: 'date' }
]

var TIPOS_LINEA = opts(['decoracion', 'renta', 'montaje', 'desmontaje', 'traslado', ['cargo_urgente', 'Cargo urgente'], 'descuento', 'otro'])
var TIPOS_PAGO = opts(['anticipo', 'abono', 'liquidacion', ['deposito_garantia', 'Depósito en garantía'], ['devolucion_deposito', 'Devolución de depósito'], 'reembolso'])
var ESTADOS = opts([['cotizacion', 'Cotización'], 'apartado', 'realizado', 'cancelado'])
var TIPOS_MOV = opts(['compra', ['consumo_evento', 'Consumo de evento'], 'merma', 'ajuste'])

// ---------- formularios ----------

function str(v) {
  return v === undefined || v === null ? '' : String(v).trim()
}

function marcado(v) {
  return v !== undefined && v !== null && v !== '' && v !== false && v !== 'false' && v !== 0 && v !== '0'
}

// body() convierte textos numéricos a número: aquí se vuelve a tipar según el campo.
function valorCampo(c, f, L) {
  var v = f[c.n]
  if (c.tipo === 'number') return v === undefined || v === null || v === '' ? 0 : Number(v)
  if (c.tipo === 'bool') return marcado(v)
  if (c.tipo === 'date') return v ? L.desdeInput(String(v)) : ''
  return str(v)
}

function armar(campos, f, L) {
  var d = {}
  campos.forEach(function (c) { d[c.n] = valorCampo(c, f, L) })
  return d
}

// valor para mostrar en el input
function paraInput(c, r, L) {
  if (!r) return c.def === undefined ? '' : c.def
  var v = r[c.n]
  if (c.tipo === 'date') return L.haciaInput(v)
  return v === undefined || v === null ? '' : v
}

function limpiarBusqueda(q) {
  return String(q || '').replace(/["\\]/g, '').trim().slice(0, 60)
}

function filtroBusqueda(campos, q) {
  q = limpiarBusqueda(q)
  if (!q) return ''
  return campos.map(function (n) { return n + ' ~ "' + q + '"' }).join(' || ')
}

// ---------- eventos ----------

function pad(n, w) {
  var s = String(n)
  while (s.length < w) s = '0' + s
  return s
}

// EV-2026-0001, consecutivo por año (el índice único evita duplicados)
function siguienteFolio(c, anio) {
  var pref = 'EV-' + anio + '-'
  var r = c.collection('eventos').getList(1, 1, { filter: 'folio ~ "' + pref + '"', sort: '-folio', skipTotal: true })
  var n = 0
  if (r.items.length) n = parseInt(String(r.items[0].folio).slice(pref.length), 10) || 0
  return pref + pad(n + 1, 4)
}

function validarFechas(d) {
  if (!d.montaje_inicio || !d.desmontaje_fin) return 'Indica el inicio del montaje y el fin del desmontaje'
  if (d.desmontaje_fin <= d.montaje_inicio) return 'El desmontaje debe terminar después de que empieza el montaje'
  return ''
}

var TIPO_LINEA_DE_SERVICIO = {
  decoracion_globos: 'decoracion', pinata: 'decoracion', mesa_dulces: 'decoracion',
  renta: 'renta', montaje: 'montaje', traslado: 'traslado', otro: 'otro'
}

// Arma una línea de cotización; si eligió un servicio, completa descripción y precio.
function armarLinea(c, f, eventoId, orden) {
  var servicio = str(f.servicio)
  var s = servicio ? c.collection('servicios').getOne(servicio) : null
  var tipo = str(f.tipo) || (s ? TIPO_LINEA_DE_SERVICIO[s.tipo] || 'otro' : 'otro')
  var descripcion = str(f.descripcion) || (s ? s.nombre : '')
  var precio = f.precio_unitario === undefined || f.precio_unitario === '' ? (s ? s.precio_base : 0) : Number(f.precio_unitario)
  var cant = f.cantidad === undefined || f.cantidad === '' ? 1 : Number(f.cantidad)
  var d = {
    evento: eventoId, tipo: tipo, descripcion: descripcion, cantidad: cant,
    precio_unitario: precio, es_opcional: marcado(f.es_opcional), orden: orden
  }
  if (servicio) d.servicio = servicio
  return d
}

// Cantidad con signo para el libro de movimientos: compra suma, consumo/merma restan, ajuste va como se capture.
function cantidadMovimiento(tipo, valor) {
  var n = Number(valor) || 0
  if (tipo === 'compra') return Math.abs(n)
  if (tipo === 'consumo_evento' || tipo === 'merma') return -Math.abs(n)
  return n
}

module.exports = {
  ENT: ENT, CAMPOS_EVENTO: CAMPOS_EVENTO, TIPOS_LINEA: TIPOS_LINEA, TIPOS_PAGO: TIPOS_PAGO, ESTADOS: ESTADOS,
  TIPOS_MOV: TIPOS_MOV, UNIDADES: UNIDADES, opts: opts, str: str, marcado: marcado,
  armar: armar, paraInput: paraInput, limpiarBusqueda: limpiarBusqueda, filtroBusqueda: filtroBusqueda,
  siguienteFolio: siguienteFolio, validarFechas: validarFechas, armarLinea: armarLinea,
  cantidadMovimiento: cantidadMovimiento
}
