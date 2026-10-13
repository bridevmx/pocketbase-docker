import sys, json
sys.path.insert(0, ".")
from pbapi import call, login
T = login()
for i, expr in enumerate(["(e.id || '_' || a.id)", "printf('%s_%s', e.id, a.id)", "CAST(e.id || '_' || a.id AS TEXT)", "e.id||'_'||a.id"]):
    q = f"SELECT {expr} AS id, e.id AS evento FROM eventos e CROSS JOIN activos a"
    s, r = call("POST", "/api/collections", {"name": f"tmp_v{i}", "type": "view", "viewQuery": q}, T)
    print(expr, "->", s, "" if s == 200 else r["data"]["viewQuery"]["message"][:120])
    if s == 200: call("DELETE", f"/api/collections/{r['id']}", token=T)
