"""Enrutador de modelos FALSO (formato OpenAI chat/completions) para el laboratorio (solo 127.0.0.1). Valida la forma de la petición como lo haría un proveedor real y devuelve lo que la prueba configure
(`content`), o un fallo a demanda. Registra cada llamada para comprobar qué se le envía (y qué NO)."""
import json, re, threading, time, http.server


class FakeOmni:
    def __init__(self, key, model):
        self.key, self.model, self.lock = key, model, threading.Lock()
        self.calls, self.content, self.mode, self.delay = [], None, None, 0.0
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a): pass
            def _send(self, st, obj=None, raw=None):
                b = raw if raw is not None else json.dumps(obj).encode()
                self.send_response(st); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0); text = self.rfile.read(n).decode("utf-8", "replace")
                rec = {"path": self.path, "auth": self.headers.get("Authorization"), "ctype": self.headers.get("Content-Type"), "text": text, "t": time.time()}
                try: rec["body"] = json.loads(text)
                except Exception: rec["body"] = None
                with outer.lock: outer.calls.append(rec)
                if outer.delay: time.sleep(outer.delay)
                if self.path != "/v1/chat/completions": return self._send(404, {"error": "not found"})
                if rec["auth"] != "Bearer " + outer.key: return self._send(401, {"error": {"message": "invalid api key"}})
                b = rec["body"]
                bad = outer.validate(b)
                if bad: return self._send(400, {"error": {"message": bad}})
                m = outer.mode
                if m == "500": return self._send(500, {"error": {"message": "internal"}})
                if m == "429": return self._send(429, {"error": {"message": "rate limited"}})
                if m == "garbage": return self._send(200, raw=b"\x00 no json \xff")
                if m == "nochoices": return self._send(200, {"id": "x"})
                if m == "emptychoices": return self._send(200, {"choices": []})
                if m == "nullcontent": return self._send(200, {"choices": [{"message": {"content": None}}]})
                if m == "parts": return self._send(200, {"choices": [{"message": {"content": [{"type": "text", "text": outer.content or ""}]}}]})
                if m == "length": return self._send(200, {"choices": [{"message": {"content": "{\"tracking_key\": \"SPIN-2"}, "finish_reason": "length"}]})
                if m == "huge": return self._send(200, {"choices": [{"message": {"content": "x" * 200000}}]})
                self._send(200, {"id": "chatcmpl-lab", "object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", "content": outer.content}, "finish_reason": "stop"}]})

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); self.srv.handle_error = lambda *a: None; self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def validate(self, b):
        if not isinstance(b, dict): return "body"
        if b.get("model") != self.model: return "model"
        msgs = b.get("messages")
        if not isinstance(msgs, list) or len(msgs) != 2 or msgs[0].get("role") != "system" or msgs[1].get("role") != "user": return "messages"
        parts = msgs[1].get("content")
        if not isinstance(parts, list) or [p.get("type") for p in parts] != ["text", "image_url"]: return "content parts"
        if not re.match(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$", parts[1].get("image_url", {}).get("url", "")): return "image url"
        return None

    def set(self, content=None, mode=None, delay=0.0): self.content, self.mode, self.delay = content, mode, delay
    def clear(self):
        with self.lock: self.calls.clear()
        self.content, self.mode, self.delay = None, None, 0.0
    def stop(self): self.srv.shutdown(); self.srv.server_close()
