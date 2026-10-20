"""Clip FALSO para el laboratorio (solo 127.0.0.1). Imita la API oficial de links de pago (POST /v2/checkout, GET /v2/checkout/{id}) con validación ESTRICTA del cuerpo
y registra cada llamada (para comprobar también la AUSENCIA de llamadas). Se controla desde las pruebas: complete/cancel/expire/tamper, fail_next, slow, down, garbage."""
import json, re, threading, time, uuid, http.server, datetime

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class FakeClip:
    def __init__(self, token, host="https://pago.clip.mx"):
        self.token, self.host, self.lock = token, host, threading.Lock()
        self.links, self.calls = {}, []          # id -> estado del link; lista de llamadas {method, path, body, auth, t}
        self.fail_codes, self.delay, self.reply_delay, self.garbage_mode, self.receipts = [], 0.0, 0.0, None, 0
        self.refunds, self.refund_idem, self.refund_mode, self.refund_error, self.nref = {}, {}, None, [], 0
        self.expires_default = datetime.timedelta(days=3)
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a): pass
            def _send(self, st, obj=None, raw=None):
                b = raw if raw is not None else json.dumps(obj).encode()
                self.send_response(st); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
            def _record(self, body_text):
                rec = {"method": self.command, "path": self.path, "body_text": body_text, "auth": self.headers.get("Authorization"), "t": time.time(), "ctype": self.headers.get("Content-Type"), "idem": self.headers.get("Idempotency-Key")}
                try: rec["body"] = json.loads(body_text) if body_text else None
                except Exception: rec["body"] = None
                with outer.lock: outer.calls.append(rec)
                return rec
            def _gate(self):
                if outer.delay: time.sleep(outer.delay)
                with outer.lock: code = outer.fail_codes.pop(0) if outer.fail_codes else None
                if code:
                    msgs = {401: {"message": "Invalid credentials", "code": "011"}, 403: {"message": "Forbidden region"}, 412: {"code_message": "Too many requests", "code": "031"}, 500: {"message": "Internal error", "code": "101"}, 400: {"message": "Bad request", "code": "001"}}
                    self._send(code, msgs.get(code, {"message": "error"})); return True
                return False
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0); text = self.rfile.read(n).decode("utf-8", "replace"); rec = self._record(text)
                if self._gate(): return
                if self.headers.get("Authorization") != outer.token: return self._send(401, {"message": "Invalid credentials", "code": "011"})
                if self.path == "/refunds": return self._refund(rec)
                if self.path != "/v2/checkout": return self._send(404, {"message": "not found"})
                b = rec["body"]
                bad = outer.validate_create(b)
                if bad: return self._send(400, {"message": bad, "code": "002"})
                lid = str(uuid.uuid4()); exp = (datetime.datetime.utcnow() + outer.expires_default).strftime("%Y-%m-%dT%H:%M:%S.000Z")
                with outer.lock: outer.links[lid] = {"body": b, "status": "CHECKOUT_CREATED", "amount": b["amount"], "currency": b["currency"], "reference": b["metadata"]["external_reference"], "receipt": None, "expires_at": exp}
                resp = {"payment_request_id": lid, "payment_request_url": f"{outer.host}/v3/{lid}", "status": "CHECKOUT_CREATED", "qr_image_url": f"https://qr.payclip.com/{lid}?version=v3", "expires_at": exp}
                g = outer.garbage_mode
                if g == "json": return self._send(200, raw=b"{not json")
                if g == "no_id": resp.pop("payment_request_id")
                if g == "bad_id": resp["payment_request_id"] = "not-a-uuid"
                if g == "http_url": resp["payment_request_url"] = f"http://pago.clip.mx/v3/{lid}"
                if g == "js_url": resp["payment_request_url"] = "javascript:alert(1)"
                if g == "evil_host": resp["payment_request_url"] = f"https://evil.example.com/v3/{lid}"
                if g == "no_url": resp.pop("payment_request_url")
                if g == "long_url": resp["payment_request_url"] = f"{outer.host}/v3/{lid}/" + "a" * 600
                if g == "userinfo_url": resp["payment_request_url"] = f"https://pago.clip.mx@evil.example.com/v3/{lid}"
                if g == "empty": return self._send(200, {})
                if g == "array": return self._send(200, ["x"])
                if g == "id_number": resp["payment_request_id"] = 12345
                self._send(200, resp)
            def _refund(self, rec):
                b = rec["body"]
                with outer.lock: err = outer.refund_error.pop(0) if outer.refund_error else None
                if err: return self._send(err[0], {"message": "refund error", "code": err[1]})
                ref = (b or {}).get("reference") if isinstance(b, dict) else None
                if not isinstance(ref, dict) or ref.get("type") != "receipt" or not isinstance(ref.get("id"), str): return self._send(400, {"message": "invalid reference", "code": "AI1001"})
                a = b.get("amount")
                if isinstance(a, bool) or not isinstance(a, (int, float)) or a < 0.01: return self._send(400, {"message": "invalid amount", "code": "AI1001"})
                if not isinstance(b.get("reason"), str) or len(b["reason"]) > 200: return self._send(400, {"message": "invalid reason", "code": "AI1001"})
                key = rec.get("idem")
                with outer.lock:
                    if key and key in outer.refund_idem: return self._send(201, outer.refund_idem[key])
                    link = next((l for l in outer.links.values() if l["receipt"] == ref["id"] and l["status"] == "CHECKOUT_COMPLETED"), None)
                    if not link: return self._send(400, {"message": "transaction not found", "code": "AI1300"})
                    if a > link["amount"] + 1e-9: return self._send(400, {"message": "amount greater", "code": "AI1801"})
                    if link.get("refunded", 0) + a > link["amount"] + 1e-9: return self._send(400, {"message": "already refunded", "code": "AI1802"})
                    outer.nref += 1; rid = str(uuid.uuid4())
                    mode = outer.refund_mode
                    # forma REAL medida (2026-10-20): 201, amount como TEXTO, y dentro de las primeras 24 h es una CANCELACIÓN que conserva el recibo y la transacción originales
                    resp = {"id": rid, "transaction_id": str(uuid.uuid4()), "status": "declined" if mode == "decline" else ("pending" if mode == "unknown" else "approved"), "status_message": "declined by issuer" if mode == "decline" else "Cancelled", "amount": ("%g" % a), "receipt_no": link["receipt"], "created_at": "2026-10-20T00:14:39.232339473Z", "currency": "MXN", "reference": ref, "reason": b["reason"]}
                    if mode not in ("decline", "unknown"): link["refunded"] = link.get("refunded", 0) + a
                    outer.refunds[rid] = resp
                    if key and resp['status'] == 'approved': outer.refund_idem[key] = resp   # solo los reembolsos aprobados se recuerdan
                self._send(201, resp)
            def do_GET(self):
                rec = self._record("")
                if self._gate(): return
                if self.headers.get("Authorization") != outer.token: return self._send(401, {"message": "Invalid credentials", "code": "011"})
                m = re.match(r"^/v2/checkout/([^/?]+)$", self.path)
                if not m: return self._send(404, {"message": "not found"})
                lid = m.group(1)
                if not UUID.match(lid): return self._send(400, {"message": "invalid id", "code": "003"})
                with outer.lock: l = outer.links.get(lid)
                if not l: return self._send(404, {"message": "not found"})
                body = {"payment_request_id": lid, "status": l["status"], "amount": l["amount"], "currency": l["currency"], "metadata": {"external_reference": l["reference"]}}
                if l["status"] == "CHECKOUT_COMPLETED" and l["receipt"]: body["receipt_no"] = l["receipt"]
                if outer.garbage_mode == "get_json": return self._send(200, raw=b"{no")
                if outer.reply_delay: time.sleep(outer.reply_delay)   # el estado se lee AHORA pero la respuesta llega tarde (lecturas viejas)
                self._send(200, body)
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); self.srv.daemon_threads = True; self.srv.handle_error = lambda *a: None
        self.port = self.srv.server_address[1]; threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    # ---- validación estricta del cuerpo de crear (lo que Clip exige) ----
    def validate_create(self, b):
        if not isinstance(b, dict): return "body must be an object"
        a = b.get("amount")
        if isinstance(a, bool) or not isinstance(a, (int, float)) or a < 1: return "amount must be a number >= 1"
        if round(a * 100) != a * 100 and abs(a * 100 - round(a * 100)) > 1e-6: return "amount allows at most 2 decimals"
        if b.get("currency") != "MXN": return "currency must be MXN"
        d = b.get("purchase_description")
        if not isinstance(d, str) or not (1 <= len(d) <= 250): return "purchase_description must be 1..250 characters"
        r = b.get("redirection_url")
        if not isinstance(r, dict) or any(not isinstance(r.get(k), str) or not r.get(k).startswith(("https://", "http://127.0.0.1")) for k in ("success", "error", "default")): return "redirection_url requires success, error and default"
        m = b.get("metadata")
        if not isinstance(m, dict) or not isinstance(m.get("external_reference"), str) or not (1 <= len(m["external_reference"]) <= 36): return "metadata.external_reference must be 1..36 characters"
        if not isinstance(b.get("webhook_url"), str) or not b["webhook_url"].startswith(("https://", "http://127.0.0.1")): return "webhook_url must be a URL"
        o = b.get("custom_payment_options")
        if o is not None:
            if not isinstance(o, dict): return "custom_payment_options must be an object"
            t = o.get("payment_method_types")
            if t is not None and (not isinstance(t, list) or any(x not in ("credit", "debit", "cash") for x in t)): return "invalid payment_method_types"
            s = o.get("installments_msi")
            if s is not None and (not isinstance(s, list) or any(x not in (3, 6, 9, 12, 18, 24) for x in s)): return "invalid installments_msi"
        ex = b.get("expires_at")
        if ex is not None and not isinstance(ex, str): return "invalid expires_at"
        return None

    # ---- controles desde las pruebas ----
    def complete(self, lid, receipt=None):
        with self.lock:
            self.receipts += 1; l = self.links[lid]; l["status"] = "CHECKOUT_COMPLETED"; l["receipt"] = None if receipt == "none" else (receipt or f"RCP{self.receipts:05d}ab")
    def set_status(self, lid, status):
        with self.lock: self.links[lid]["status"] = status
    def cancel(self, lid): self.set_status(lid, "CHECKOUT_CANCELLED")
    def expire(self, lid): self.set_status(lid, "CHECKOUT_EXPIRED")
    def tamper(self, lid, **kw):
        with self.lock: self.links[lid].update({k: v for k, v in kw.items()})
    def fail_next(self, *codes):
        with self.lock: self.fail_codes.extend(codes)
    def posts(self):
        with self.lock: return [c for c in self.calls if c["method"] == "POST" and c["path"] != "/refunds"]
    def refund_posts(self):
        with self.lock: return [c for c in self.calls if c["method"] == "POST" and c["path"] == "/refunds"]
    def gets(self, lid=None):
        with self.lock: return [c for c in self.calls if c["method"] == "GET" and (lid is None or c["path"].endswith(lid))]
    def clear(self):
        with self.lock: self.calls.clear(); self.fail_codes.clear()
        self.delay, self.reply_delay, self.garbage_mode = 0.0, 0.0, None
    def stop(self): self.srv.shutdown(); self.srv.server_close()
