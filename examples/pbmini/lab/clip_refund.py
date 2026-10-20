"""Reembolso REAL de un pago de Clip con su API (POST /refunds). Mueve dinero: por eso lo ejecuta una persona, nunca un agente.
  python clip_refund.py <receipt_no> <pesos> [--type receipt|transaction] [--confirm]
Sin --confirm solo IMPRIME la petición (con el token oculto) y no llama a Clip. Con --confirm envía el reembolso y consulta su estado.
Lee CLIP_API_TOKEN del .env de la raíz del repositorio (nunca se imprime). Documentación: developer.clip.mx/reference/post_refunds
  - Authorization: Basic <token>; cuerpo { reference: { type: "receipt"|"transaction", id }, amount, reason }; cabecera opcional idempotency-key (Clip la recuerda 1 minuto).
  - Beta: el monto debe ser IGUAL al del pago original (reembolso total). Dentro de las primeras 24 h es una cancelación; después, un reembolso con su propio id y recibo.
  - El saldo (ventas del día aún no depositadas menos reembolsos del día) debe cubrir el monto (AI1400)."""
import json, os, sys, time, urllib.request, urllib.error, uuid
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

def load_env(path=os.path.join(REPO, ".env")):
    env = {}
    for ln in open(path, encoding="utf-8"):
        if "=" in ln and not ln.lstrip().startswith("#"):
            k, v = ln.split("=", 1); env[k.strip()] = v.split(" #")[0].strip()
    return env

UA = "pbmini-clip-refund/1.0"   # Cloudflare (api.payclip.com) bloquea el User-Agent por defecto de Python (error 1010); con uno propio pasa
def call(method, url, token, body=None, idem=None):
    h = {"Authorization": token, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA}
    if idem: h["idempotency-key"] = idem
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read() or b"{}"
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw[:300].decode("utf-8", "replace")}

def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]; flags = [x for x in sys.argv[1:] if x.startswith("--")]
    typ = "receipt"
    global UA
    if "--ua" in sys.argv:
        i = sys.argv.index("--ua"); UA = sys.argv[i + 1]; a = [x for x in a if x != UA]
    if "--type" in sys.argv:
        i = sys.argv.index("--type"); typ = sys.argv[i + 1]; a = [x for x in a if x != typ]
    if len(a) != 2 or typ not in ("receipt", "transaction"): sys.exit(__doc__)
    ref_id, pesos = a[0], float(a[1])
    env = load_env(); token = env.get("CLIP_API_TOKEN", ""); base = (env.get("CLIP_API_URL") or "https://api.payclip.com").rstrip("/")
    if not token.startswith("Basic "): sys.exit("falta CLIP_API_TOKEN (Basic …) en el .env")
    body = {"reference": {"type": typ, "id": ref_id}, "amount": round(pesos, 2), "reason": "Reembolso de prueba pbmini"}
    idem = "refund-" + ref_id[:50]
    print(f"POST {base}/refunds\n  Authorization: Basic ****\n  idempotency-key: {idem}\n  {json.dumps(body, ensure_ascii=False)}")
    if "--confirm" not in flags:
        print("\n(simulacro: NO se envió nada. Añade --confirm para reembolsar de verdad.)"); return
    st, resp = call("POST", base + "/refunds", token, body, idem)
    print(f"\nrespuesta {st}: {json.dumps(resp, ensure_ascii=False)[:600]}")
    rid = resp.get("id") if isinstance(resp, dict) else None
    if st in (200, 201) and rid:
        time.sleep(1); st2, r2 = call("GET", f"{base}/refunds/{rid}", token)
        print(f"estado del reembolso {st2}: {json.dumps(r2, ensure_ascii=False)[:600]}")
    elif st == 403 and isinstance(resp, dict) and resp.get("cloudflare_error"):
        print("\nLo bloqueó Cloudflare por la firma del cliente (no es un error de la API de Clip). No se hizo ningún reembolso. Prueba otro User-Agent con --ua \"texto\".")
    elif st in (404, 409, 400):
        print("\nSi Clip no encuentra el pago con este tipo de referencia, prueba --type transaction con el id de transacción del panel de Clip (el recibo del checkout puede no aceptarse).")

if __name__ == "__main__": main()
