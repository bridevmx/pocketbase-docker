import json, sys
sys.path.insert(0, "/tmp/claude-0/-home-claude/e2610404-02b2-5d10-a051-0d49ef1434bb/scratchpad/scripts")
from pbapi import call, login
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
json.dump(ids, open("/tmp/claude-0/-home-claude/e2610404-02b2-5d10-a051-0d49ef1434bb/scratchpad/scripts/ids.json", "w"))
