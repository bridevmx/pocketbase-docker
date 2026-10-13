// Reactividad de la lista de carga: SDK de PocketBase + nanostores desde CDN.
// Recomendado: fija versiones (p. ej. .../npm/pocketbase@0.26.x/+esm) antes de producción.
import PocketBase from 'https://cdn.jsdelivr.net/npm/pocketbase/+esm'
import { atom, map, computed } from 'https://cdn.jsdelivr.net/npm/nanostores/+esm'

const raiz = document.getElementById('carga')
if (raiz) {
  const url = raiz.dataset.url
  const clave = 'carga:' + raiz.dataset.clave

  // La sesión viaja en la cookie pb_auth (la deja pocketpages-plugin-auth)
  const pb = new PocketBase(location.origin)
  pb.authStore.loadFromCookie(document.cookie)

  // --- estado (nanostores) ---
  const $marcados = map({})              // { "evento:insumo": true }
  const $conexion = atom('fuera')        // fuera | conectado
  const $total = atom(0)
  const $hechos = computed([$marcados, $total], (m, t) => ({
    hechos: Object.keys(m).filter((k) => m[k]).length,
    total: t,
  }))

  try { $marcados.set(JSON.parse(localStorage.getItem(clave) || '{}')) } catch (e) {}
  $marcados.listen((m) => { try { localStorage.setItem(clave, JSON.stringify(m)) } catch (e) {} })

  // --- vista ---
  const cajas = () => raiz.querySelectorAll('input[type=checkbox][data-clave]')
  function pintar() {
    const m = $marcados.get()
    const todas = cajas()
    $total.set(todas.length)
    todas.forEach((c) => {
      c.checked = !!m[c.dataset.clave]
      c.closest('li').classList.toggle('hecho', c.checked)
    })
  }
  raiz.addEventListener('change', (ev) => {
    const c = ev.target
    if (c.matches('input[data-clave]')) {
      $marcados.setKey(c.dataset.clave, c.checked)
      c.closest('li').classList.toggle('hecho', c.checked)
    }
  })
  $hechos.subscribe(({ hechos, total }) => {
    const el = document.getElementById('progreso')
    if (el) el.textContent = total ? hechos + ' de ' + total + ' cargados' : ''
  })
  $conexion.subscribe((e) => {
    const el = document.getElementById('conexion')
    if (!el) return
    el.dataset.estado = e
    el.textContent = e === 'conectado' ? 'en vivo' : 'sin tiempo real'
  })

  // --- refrescar el HTML del servidor ---
  async function recargar() {
    try {
      const r = await fetch(url, { credentials: 'same-origin' })
      if (r.ok) { raiz.innerHTML = await r.text(); pintar() }
    } catch (e) { /* sin red: se queda lo que ya hay */ }
  }
  let t
  const pronto = () => { clearTimeout(t); t = setTimeout(recargar, 400) }

  // Las vistas SQL no emiten eventos: se escuchan las tablas base y se vuelve a consultar.
  const tablas = ['eventos', 'evento_lineas', 'reservas_activos', 'movimientos_inventario', 'receta_insumos', 'servicios']
  Promise.all(tablas.map((n) => pb.collection(n).subscribe('*', pronto)))
    .then(() => $conexion.set('conectado'))
    .catch(() => $conexion.set('fuera'))

  pintar()
}
