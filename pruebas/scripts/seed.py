import sys, json
sys.path.insert(0, ".")
from pbapi import call, login
SU = login()
def must(s, r, what):
    assert s == 200, (what, s, json.dumps(r)[:500]); return r
# usuarios
for em, rol in [("dueno@local.test", "dueno"), ("asist@local.test", "asistente")]:
    s, r = call("POST", "/api/collections/users/records", {"email": em, "password": "Prueba12345", "passwordConfirm": "Prueba12345", "nombre": rol, "rol": rol}, SU)
    print("user", em, s, "" if s == 200 else json.dumps(r)[:300])
s, r = call("POST", "/api/collections/users/auth-with-password", {"identity": "dueno@local.test", "password": "Prueba12345"})
T = must(s, r, "login dueno")["token"]
def add(col, body):
    s, r = call("POST", f"/api/collections/{col}/records", body, T)
    return must(s, r, col)["id"]
c1 = add("clientes", {"nombre": "Cliente Prueba", "telefono": "5550001"})
g = add("insumos", {"nombre": "Globo R12 morado", "categoria": "globo", "unidad_base": "pieza", "stock_minimo": 50, "costo_unitario": 1.2, "activo": True})
d = add("insumos", {"nombre": "Dulce mix", "categoria": "dulce", "unidad_base": "g", "stock_minimo": 1000, "costo_unitario": 0.05, "activo": True})
a1 = add("activos", {"nombre": "Mampara circular", "categoria": "mampara", "cantidad_total": 2, "activo": True})
s1 = add("servicios", {"nombre": "Arco organico", "tipo": "decoracion_globos", "unidad_venta": "metro", "precio_base": 500, "activo": True})
s2 = add("servicios", {"nombre": "Mesa de dulces", "tipo": "mesa_dulces", "unidad_venta": "persona", "precio_base": 60, "activo": True})
add("receta_insumos", {"servicio": s1, "insumo": g, "cantidad_por_unidad": 40})
add("receta_insumos", {"servicio": s2, "insumo": d, "cantidad_por_unidad": 200})
def ev(folio, estado, ini, fin):
    return add("eventos", {"folio": folio, "cliente": c1, "estado": estado, "montaje_inicio": ini, "desmontaje_fin": fin, "porcentaje_anticipo": 50})
e1 = ev("F-1", "apartado", "2026-10-17 10:00:00.000Z", "2026-10-17 22:00:00.000Z")
e2 = ev("F-2", "apartado", "2026-10-17 15:00:00.000Z", "2026-10-17 23:00:00.000Z")
e3 = ev("F-3", "apartado", "2026-10-18 10:00:00.000Z", "2026-10-18 20:00:00.000Z")
e4 = ev("F-4", "cotizacion", "2026-10-17 11:00:00.000Z", "2026-10-17 21:00:00.000Z")
def ln(e, srv, tipo, cant, precio, opc=False):
    add("evento_lineas", {"evento": e, **({"servicio": srv} if srv else {}), "tipo": tipo, "cantidad": cant, "precio_unitario": precio, "es_opcional": opc})
ln(e1, s1, "decoracion", 3, 500); ln(e1, s2, "decoracion", 100, 60); ln(e1, None, "montaje", 1, 300, True); ln(e2, s1, "decoracion", 1, 500)
for e, n in [(e1, 2), (e3, 1), (e4, 2)]:
    add("reservas_activos", {"evento": e, "activo": a1, "cantidad": n})
for tipo, m in [("anticipo", 3600), ("deposito_garantia", 150), ("reembolso", 100), ("devolucion_deposito", 150)]:
    add("pagos", {"evento": e1, "tipo": tipo, "monto": m, "metodo": "efectivo"})
add("movimientos_inventario", {"insumo": g, "tipo": "compra", "cantidad": 200})
add("movimientos_inventario", {"insumo": g, "tipo": "consumo_evento", "cantidad": -160, "evento": e1})
add("movimientos_inventario", {"insumo": d, "tipo": "compra", "cantidad": 30000})
json.dump({"e1": e1, "e2": e2, "e3": e3, "e4": e4, "a1": a1, "g": g, "d": d}, open("seed_ids.json", "w"))
names = {e1: "F-1", e2: "F-2", e3: "F-3", e4: "F-4"}
for v in ["v_stock_insumos", "v_saldos_evento", "v_disponibilidad_activos", "v_lista_de_carga"]:
    s, r = call("GET", f"/api/collections/{v}/records?perPage=50", token=T)
    print(v, s)
    for it in r["items"]:
        it = {k: (names.get(x, x) if isinstance(x, str) else x) for k, x in it.items() if k not in ("collectionId", "collectionName")}
        print("  ", it)
