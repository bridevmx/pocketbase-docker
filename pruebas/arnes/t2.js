const { pedir, http } = require('./run.js')
const ids = require('../scripts/seed_ids.json')
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
pedir('POST', '/login', { identity: 'asist@local.test', password: 'Prueba12345' })
for (const k of ['e1', 'e2', 'e3', 'e4']) {
  const r = pedir('GET', '/eventos/' + ids[k]); console.log('\n##', k, r.status); console.log(txt(r.html).replace(/^.*Agenda/, '').slice(0, 900))
}
// estado de cada evento
const sup = http('POST', '/api/collections/_superusers/auth-with-password', null, { identity: 'prueba@local.test', password: 'PruebaPB12345' }).token
for (const k of ['e1','e2','e3','e4']) { const e = http('GET', '/api/collections/eventos/records/' + ids[k], sup); const s = http('GET','/api/collections/v_saldos_evento/records/'+ids[k], sup); console.log(k, e.estado, e.porcentaje_anticipo, s.total, s.pagado) }
