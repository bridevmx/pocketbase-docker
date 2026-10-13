import sys, json
sys.path.insert(0, ".")
from pbapi import call, login
ids = json.load(open("seed_ids.json"))
def tok(em):
    s, r = call("POST", "/api/collections/users/auth-with-password", {"identity": em, "password": "Prueba12345"}); return r["token"]
D, A = tok("dueno@local.test"), tok("asist@local.test")
def t(label, s, esperado): print(("OK  " if s in esperado else "FALLA"), label, "->", s, "(esperado", "/".join(map(str, esperado)) + ")")
_, r = call("GET", "/api/collections/pagos/records?perPage=1", token=A); pago = r["items"][0]["id"]
s, r = call("GET", "/api/collections/clientes/records"); t("anonimo lista clientes (items vacios)", s, [200]); print("     items:", len(r["items"]))
s, r = call("GET", "/api/collections/v_saldos_evento/records"); print("     anonimo ve saldos:", len(r["items"]), "filas")
s, r = call("POST", "/api/collections/pagos/records", {"evento": ids["e2"], "tipo": "abono", "monto": 0}, A); t("asistente crea pago con monto 0", s, [400])
s, r = call("POST", "/api/collections/pagos/records", {"evento": ids["e2"], "tipo": "abono", "monto": 250}, A); t("asistente crea pago de 250", s, [200]); nuevo = r.get("id")
s, r = call("PATCH", f"/api/collections/pagos/records/{nuevo}", {"monto": 1}, A); t("asistente edita pago", s, [404])
s, r = call("DELETE", f"/api/collections/pagos/records/{nuevo}", token=A); t("asistente borra pago", s, [404])
s, r = call("POST", "/api/collections/insumos/records", {"nombre": "x", "activo": True}, A); t("asistente crea insumo", s, [400])
s, r = call("PATCH", f"/api/collections/insumos/records/{ids['g']}", {"costo_unitario": 99}, A); t("asistente cambia costo de insumo", s, [404])
s, r = call("GET", "/api/collections/insumos/records", token=A); t("asistente lista insumos", s, [200]); print("     items:", len(r["items"]))
s, r = call("DELETE", f"/api/collections/pagos/records/{nuevo}", token=D); t("dueno borra pago", s, [204, 200])
s, r = call("GET", "/api/collections/v_saldos_evento/records", token=A); t("asistente lee v_saldos_evento", s, [200]); print("     items:", len(r["items"]))
