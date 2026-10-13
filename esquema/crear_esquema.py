"""Crea el esquema completo (11 colecciones + 4 vistas) en una instancia vacía de PocketBase 0.40.
Uso: PB_URL=http://127.0.0.1:8090 PB_EMAIL=... PB_PASS=... python3 crear_esquema.py
Solo para una instancia nueva: falla si las colecciones ya existen."""
import json, sys
import urllib.request, urllib.error
import os
BASE = os.environ.get("PB_URL", "http://127.0.0.1:8095")
def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read().decode()
            return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, {"raw": t}
def login():
    s, r = call("POST", "/api/collections/_superusers/auth-with-password",
                {"identity": os.environ.get("PB_EMAIL", "prueba@local.test"), "password": os.environ.get("PB_PASS", "PruebaPB12345")})
    assert s == 200, r
    return r["token"]

T = login()
STAFF = '@request.auth.id != ""'
DUENO = '@request.auth.rol = "dueno"'
ids = {}

def txt(n, **k): return {"name": n, "type": "text", **k}
def num(n, **k): return {"name": n, "type": "number", **k}
def boo(n): return {"name": n, "type": "bool"}
def dat(n, **k): return {"name": n, "type": "date", **k}
def sel(n, vals, **k): return {"name": n, "type": "select", "values": vals, "maxSelect": 1, **k}
def rel(n, col, **k): return {"name": n, "type": "relation", "collectionId": ids[col], "maxSelect": 1, **k}
def fil(n, multi=False): return {"name": n, "type": "file", "maxSelect": 10 if multi else 1, "maxSize": 5242880}

def mk(name, fields, indexes=(), rules=None):
    rules = rules or {}
    # created/updated: PocketBase no los agrega solo al crear colecciones por API
    fields = list(fields) + [{"name": "created", "type": "autodate", "onCreate": True, "onUpdate": False},
                             {"name": "updated", "type": "autodate", "onCreate": True, "onUpdate": True}]
    body = {"name": name, "type": "base", "fields": fields, "indexes": list(indexes),
            "listRule": rules.get("list", STAFF), "viewRule": rules.get("view", STAFF),
            "createRule": rules.get("create", STAFF), "updateRule": rules.get("update", STAFF),
            "deleteRule": rules.get("delete", DUENO)}
    s, r = call("POST", "/api/collections", body, T)
    print(name, s, "" if s == 200 else json.dumps(r)[:600])
    if s == 200: ids[name] = r["id"]
    return s

# users: agregar nombre y rol
s, u = call("GET", "/api/collections/users", token=T)
ids["users"] = u["id"]
fields = u["fields"] + [txt("nombre"), sel("rol", ["dueno", "asistente"])]
s, r = call("PATCH", "/api/collections/users", {"fields": fields}, T)
print("users", s, "" if s == 200 else json.dumps(r)[:400])

OWNER_ONLY = {"create": DUENO, "update": DUENO, "delete": DUENO}
mk("clientes", [txt("nombre", required=True), txt("telefono"), txt("instagram"), txt("notas")],
   ["CREATE INDEX idx_clientes_tel ON clientes (telefono)"])
mk("insumos", [txt("nombre", required=True), sel("categoria", ["globo","helio","dulce","papeleria","empaque","otro"]),
   txt("marca"), txt("color"), txt("tamano"), sel("unidad_base", ["pieza","g","ml","m"]),
   num("costo_unitario", min=0), num("stock_minimo", min=0), boo("caduca"), boo("activo"), fil("foto")], rules=OWNER_ONLY)
mk("activos", [txt("nombre", required=True), sel("categoria", ["base","mampara","arco","cilindro","otro"]),
   num("cantidad_total", min=0), num("costo_reposicion", min=0), boo("activo"), fil("foto")], rules=OWNER_ONLY)
mk("servicios", [txt("nombre", required=True), sel("tipo", ["decoracion_globos","pinata","mesa_dulces","renta","montaje","traslado","otro"]),
   txt("descripcion"), sel("unidad_venta", ["pieza","metro","persona","evento"]), num("precio_base", min=0), boo("activo"), fil("fotos", True)], rules=OWNER_ONLY)
mk("receta_insumos", [rel("servicio", "servicios", required=True, cascadeDelete=True), rel("insumo", "insumos", required=True),
   num("cantidad_por_unidad", min=0)], ["CREATE UNIQUE INDEX idx_receta_ins ON receta_insumos (servicio, insumo)"], OWNER_ONLY)
mk("receta_activos", [rel("servicio", "servicios", required=True, cascadeDelete=True), rel("activo", "activos", required=True),
   num("cantidad", min=0)], ["CREATE UNIQUE INDEX idx_receta_act ON receta_activos (servicio, activo)"], OWNER_ONLY)
mk("eventos", [txt("folio", required=True), rel("cliente", "clientes", required=True), txt("titulo"), txt("tema"), num("invitados", min=0),
   dat("montaje_inicio", required=True), dat("evento_inicio"), dat("desmontaje_fin", required=True),
   txt("direccion"), {"name": "mapa_url", "type": "url"}, fil("referencias", True), txt("notas_diseno"),
   sel("estado", ["cotizacion","apartado","realizado","cancelado"], required=True), dat("vigencia_hasta"),
   num("porcentaje_anticipo", min=0, max=100), txt("token_publico")],
   ["CREATE UNIQUE INDEX idx_eventos_folio ON eventos (folio)",
    "CREATE UNIQUE INDEX idx_eventos_token ON eventos (token_publico) WHERE token_publico != ''",
    "CREATE INDEX idx_eventos_estado_montaje ON eventos (estado, montaje_inicio)"])
mk("evento_lineas", [rel("evento", "eventos", required=True, cascadeDelete=True), rel("servicio", "servicios"),
   sel("tipo", ["decoracion","renta","montaje","desmontaje","traslado","cargo_urgente","descuento","otro"], required=True),
   txt("descripcion"), num("cantidad"), num("precio_unitario"), boo("es_opcional"), num("orden")],
   ["CREATE INDEX idx_lineas_evento ON evento_lineas (evento)"])
mk("reservas_activos", [rel("evento", "eventos", required=True, cascadeDelete=True), rel("activo", "activos", required=True), num("cantidad", min=0)],
   ["CREATE UNIQUE INDEX idx_reservas ON reservas_activos (evento, activo)", "CREATE INDEX idx_reservas_activo ON reservas_activos (activo)"])
mk("pagos", [rel("evento", "eventos", required=True, cascadeDelete=True),
   sel("tipo", ["anticipo","abono","liquidacion","deposito_garantia","devolucion_deposito","reembolso"], required=True),
   num("monto", min=0), dat("fecha"), sel("metodo", ["efectivo","transferencia","tarjeta","otro"]), fil("comprobante"), txt("nota")],
   ["CREATE INDEX idx_pagos_evento ON pagos (evento)"],
   {"create": STAFF + ' && @request.body.monto > 0', "update": DUENO, "delete": DUENO})
mk("movimientos_inventario", [rel("insumo", "insumos", required=True),
   sel("tipo", ["compra","consumo_evento","merma","ajuste"], required=True), num("cantidad"), dat("fecha"),
   rel("evento", "eventos"), num("costo_unitario"), txt("nota")],
   ["CREATE INDEX idx_mov_insumo ON movimientos_inventario (insumo)", "CREATE INDEX idx_mov_evento ON movimientos_inventario (evento)"],
   {"update": DUENO, "delete": DUENO})

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
