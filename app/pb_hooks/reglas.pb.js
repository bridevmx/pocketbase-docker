/// <reference path="../pb_data/types.d.ts" />

// Hook 2: no sobrerreservar estructuras
function validarReserva(e) {
  const evento = e.record.get("evento")
  const activo = e.record.get("activo")
  const cantidad = e.record.get("cantidad")
  const fila = new DynamicModel({ libres: 0 })
  $app.db()
    .newQuery("SELECT libres FROM v_disponibilidad_activos WHERE evento = {:ev} AND activo = {:ac}")
    .bind({ ev: evento, ac: activo })
    .one(fila)
  if (cantidad > fila.libres) {
    throw new BadRequestError("Solo quedan " + fila.libres + " piezas libres en ese horario")
  }
  e.next()
}
onRecordCreateRequest(validarReserva, "reservas_activos")
onRecordUpdateRequest(validarReserva, "reservas_activos")

// Hook 1: no apartar sin anticipo
onRecordUpdateRequest((e) => {
  const antes = e.record.original().get("estado")
  const ahora = e.record.get("estado")
  if (ahora === "apartado" && antes !== "apartado") {
    const fila = new DynamicModel({ total: 0, pagado: 0 })
    $app.db()
      .newQuery("SELECT total, pagado FROM v_saldos_evento WHERE id = {:id}")
      .bind({ id: e.record.id })
      .one(fila)
    const requerido = fila.total * e.record.get("porcentaje_anticipo") / 100
    if (fila.pagado < requerido) {
      throw new BadRequestError("Falta anticipo: se requieren " + requerido + " y hay " + fila.pagado)
    }
  }
  e.next()
}, "eventos")
