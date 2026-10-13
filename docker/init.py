"""Arranque inicial: espera a PocketBase, crea el esquema si no existe y el primer usuario dueno."""
import json, os, subprocess, sys, time
import urllib.request, urllib.error

BASE = os.environ["PB_URL"]

def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            t = r.read().decode()
            return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, {"raw": t}

for _ in range(60):
    try:
        if call("GET", "/api/health")[0] == 200: break
    except Exception: pass
    time.sleep(1)
else:
    sys.exit("PocketBase no respondio a tiempo")

s, r = call("POST", "/api/collections/_superusers/auth-with-password",
            {"identity": os.environ["PB_EMAIL"], "password": os.environ["PB_PASS"]})
if s != 200: sys.exit(f"login de superusuario fallo: {r}")
token = r["token"]

if call("GET", "/api/collections/eventos", token=token)[0] == 404:
    print("init: creando esquema...")
    env = {**os.environ, "PB_URL": BASE}
    subprocess.run([sys.executable, "-I", "/app/esquema/crear_esquema.py"], check=True, env=env)
else:
    print("init: esquema ya existe")

# Si no defines OWNER_*, el dueno usa las mismas credenciales que el superusuario.
email = os.environ.get("OWNER_EMAIL") or os.environ["PB_EMAIL"]
pw = os.environ.get("OWNER_PASSWORD") or os.environ["PB_PASS"]
if email and pw:
    s, r = call("GET", f"/api/collections/users/records?filter=email%3D%22{email}%22&perPage=1", token=token)
    if s == 200 and not r.get("items"):
        s, r = call("POST", "/api/collections/users/records", {
            "email": email, "password": pw, "passwordConfirm": pw, "emailVisibility": True, "verified": True,
            "nombre": os.environ.get("OWNER_NAME", "Dueno"), "rol": "dueno"}, token)
        print("init: usuario dueno", "creado" if s == 200 else f"fallo {r}")
    else:
        print("init: usuario dueno ya existe o no se pudo consultar")
