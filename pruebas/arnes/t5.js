const { pedir, http } = require('./run.js')
const ids = require('../scripts/seed_ids.json')
const err = (h) => (h.match(/<p class="error">([^<]*)</g) || []).join(' | ')
const sup = http('POST', '/api/collections/_superusers/auth-with-password', null, { identity: 'prueba@local.test', password: 'PruebaPB12345' }).token
const l = http('POST', '/api/collections/evento_lineas/records', sup, { evento: ids.e4, tipo: 'decoracion', descripcion: 'tmp', cantidad: 1, precio_unitario: 1000, orden: 99 })
pedir('POST', '/login', { identity: 'asist@local.test', password: 'Prueba12345' })
let r = pedir('POST', '/eventos/' + ids.e4, { accion: 'apartar' }); console.log('apartar sin anticipo:', r.status, r.location || '', err(r.html || ''))
r = pedir('POST', '/eventos/' + ids.e4, { accion: 'pago', tipo: 'anticipo', monto: '0', metodo: 'efectivo' }); console.log('pago 0:', err(r.html || ''))
r = pedir('GET', '/eventos/zzzzzzzzzzzzzzz'); console.log('inexistente:', err(r.html))
r = pedir('POST', '/eventos/' + ids.e4, { accion: 'pago', tipo: 'anticipo', monto: '500', metodo: 'efectivo' }); console.log('anticipo 500:', r.status, r.flash)
r = pedir('POST', '/eventos/' + ids.e4, { accion: 'apartar' }); console.log('apartar con anticipo:', r.status, r.location || '', err(r.html || ''))
r = pedir('POST', '/login', { identity: 'x@y.z', password: 'm' }); 
// limpiar
for (const p of http('GET', '/api/collections/pagos/records?filter=' + encodeURIComponent('evento="' + ids.e4 + '"'), sup).items) http('DELETE', '/api/collections/pagos/records/' + p.id, sup)
http('DELETE', '/api/collections/evento_lineas/records/' + l.id, sup)
http('PATCH', '/api/collections/eventos/records/' + ids.e4, sup, { estado: 'cotizacion' })
console.log('estado e4 restaurado:', http('GET', '/api/collections/eventos/records/' + ids.e4, sup).estado)
