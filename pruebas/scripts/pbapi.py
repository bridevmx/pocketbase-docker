import json, urllib.request, urllib.error
BASE = "http://127.0.0.1:8095"
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
                {"identity": "prueba@local.test", "password": "PruebaPB12345"})
    assert s == 200, r
    return r["token"]
