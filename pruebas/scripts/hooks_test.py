import sys, json
sys.path.insert(0, ".")
from pbapi import call
ids = json.load(open("seed_ids.json"))
s, r = call("POST", "/api/collections/users/auth-with-password", {"identity": "asist@local.test", "password": "Prueba12345"}); A = r["token"]
def t(label, s, esperado, r=None):
    print(("OK   " if s in esperado else "FALLA"), label, "->", s, ("| " + r["message"] if r and s != 200 and "message" in r else ""))
# Hook 2
s, r = call("POST", "/api/collections/reservas_activos/records", {"evento": ids["e2"], "activo": ids["a1"], "cantidad": 1}, A); t("reservar 1 mampara en F-2 (traslape con F-1 que tiene 2 de 2)", s, [400], r)
_, r0 = call("GET", f"/api/collections/reservas_activos/records?filter=evento='{ids['e3']}'", token=A); rid = r0["items"][0]["id"]
s, r = call("PATCH", f"/api/collections/reservas_activos/records/{rid}", {"cantidad": 2}, A); t("subir F-3 (otro dia) a 2 mamparas", s, [200], r)
s, r = call("PATCH", f"/api/collections/reservas_activos/records/{rid}", {"cantidad": 3}, A); t("subir F-3 a 3 mamparas (solo hay 2)", s, [400], r)
# Hook 1
s, r = call("POST", "/api/collections/clientes/records", {"nombre": "C2"}, A); cl = r["id"]
s, r = call("POST", "/api/collections/eventos/records", {"folio": "F-5", "cliente": cl, "estado": "cotizacion", "montaje_inicio": "2026-11-01 10:00:00.000Z", "desmontaje_fin": "2026-11-01 20:00:00.000Z", "porcentaje_anticipo": 50}, A); e5 = r["id"]
s, r = call("POST", "/api/collections/evento_lineas/records", {"evento": e5, "tipo": "decoracion", "cantidad": 2, "precio_unitario": 500, "es_opcional": False}, A)
s, r = call("PATCH", f"/api/collections/eventos/records/{e5}", {"estado": "apartado"}, A); t("apartar F-5 (total 1000) sin anticipo", s, [400], r)
s, r = call("POST", "/api/collections/pagos/records", {"evento": e5, "tipo": "anticipo", "monto": 500}, A)
s, r = call("PATCH", f"/api/collections/eventos/records/{e5}", {"estado": "apartado"}, A); t("apartar F-5 con anticipo de 500 (50%)", s, [200], r)
