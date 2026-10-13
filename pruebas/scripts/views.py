import json, sys
sys.path.insert(0, "/tmp/claude-0/-home-claude/e2610404-02b2-5d10-a051-0d49ef1434bb/scratchpad/scripts")
from pbapi import call, login
T = login()
STAFF = '@request.auth.id != ""'
V = {}
V["v_stock_insumos"] = """
SELECT i.id AS id, i.nombre AS nombre, i.stock_minimo AS stock_minimo,
  CAST(COALESCE(SUM(m.cantidad), 0) AS REAL) AS stock_actual,
  CAST(CASE WHEN COALESCE(SUM(m.cantidad), 0) < i.stock_minimo THEN 1 ELSE 0 END AS INT) AS bajo_minimo
FROM insumos i LEFT JOIN movimientos_inventario m ON m.insumo = i.id
WHERE i.activo = 1 GROUP BY i.id"""
V["v_saldos_evento"] = """
SELECT e.id AS id, e.folio AS folio, e.estado AS estado,
  CAST(COALESCE((SELECT SUM(l.cantidad * l.precio_unitario) FROM evento_lineas l WHERE l.evento = e.id AND l.es_opcional = 0), 0) AS REAL) AS total,
  CAST(COALESCE((SELECT SUM(CASE WHEN p.tipo = 'reembolso' THEN -p.monto ELSE p.monto END) FROM pagos p WHERE p.evento = e.id AND p.tipo IN ('anticipo','abono','liquidacion','reembolso')), 0) AS REAL) AS pagado,
  CAST(COALESCE((SELECT SUM(CASE WHEN p.tipo = 'devolucion_deposito' THEN -p.monto ELSE p.monto END) FROM pagos p WHERE p.evento = e.id AND p.tipo IN ('deposito_garantia','devolucion_deposito')), 0) AS REAL) AS deposito_retenido
FROM eventos e"""
V["v_disponibilidad_activos"] = """
SELECT (e.id || '_' || a.id) AS id, e.id AS evento, a.id AS activo, a.cantidad_total AS cantidad_total,
  CAST(a.cantidad_total - COALESCE((SELECT SUM(r.cantidad) FROM reservas_activos r JOIN eventos o ON o.id = r.evento
    WHERE r.activo = a.id AND o.id <> e.id AND o.estado = 'apartado'
      AND o.montaje_inicio < e.desmontaje_fin AND o.desmontaje_fin > e.montaje_inicio), 0) AS REAL) AS libres
FROM eventos e CROSS JOIN activos a"""
V["v_lista_de_carga"] = """
SELECT (e.id || '_' || i.id) AS id, e.id AS evento, e.montaje_inicio AS montaje_inicio, i.id AS insumo, i.nombre AS nombre,
  CAST(SUM(l.cantidad * ri.cantidad_por_unidad) AS REAL) AS cantidad_necesaria
FROM eventos e JOIN evento_lineas l ON l.evento = e.id AND l.es_opcional = 0
JOIN receta_insumos ri ON ri.servicio = l.servicio JOIN insumos i ON i.id = ri.insumo
WHERE e.estado = 'apartado' GROUP BY e.id, i.id"""
for n, q in V.items():
    s, r = call("POST", "/api/collections", {"name": n, "type": "view", "viewQuery": q.strip(), "listRule": STAFF, "viewRule": STAFF}, T)
    print(n, s)
    if s == 200: print("  ", [(f["name"], f["type"]) for f in r["fields"]])
    else: print("  ", json.dumps(r)[:700])
