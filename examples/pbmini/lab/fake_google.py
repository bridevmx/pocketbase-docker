"""Google AI Studio FALSO para el laboratorio (solo 127.0.0.1). Imita POST /v1beta/models/{modelo}:generateContent con las restricciones REALES medidas:
 - la clave debe ir en la cabecera x-goog-api-key (aquí se RECHAZA una clave en la URL: las URL acaban en logs),
 - Gemma no admite `systemInstruction` (400 «Developer instruction is not enabled»),
 - los modelos fallan a veces (500/429), responden cortados (MAX_TOKENS), vacíos o bloqueados.
`plan[modelo]` es una lista de acciones que se consume una por llamada ("ok" cuando se acaba). Registra cada llamada."""
import json, re, threading, time, http.server


class FakeGoogle:
    def __init__(self, key):
        self.key, self.lock = key, threading.Lock()
        self.calls, self.plan, self.content, self.delay = [], {}, {}, 0.0
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a): pass
            def _send(self, st, obj=None, raw=None):
                b = raw if raw is not None else json.dumps(obj).encode()
                self.send_response(st); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0); text = self.rfile.read(n).decode("utf-8", "replace")
                m = re.match(r"^/v1beta/models/([a-z0-9._-]+):generateContent$", self.path)
                rec = {"path": self.path, "model": m.group(1) if m else None, "key": self.headers.get("x-goog-api-key"), "text": text, "t": time.time()}
                try: rec["body"] = json.loads(text)
                except Exception: rec["body"] = None
                with outer.lock:
                    outer.calls.append(rec); act = (outer.plan.get(rec["model"]) or []).pop(0) if outer.plan.get(rec["model"]) else "ok"
                if not m: return self._send(404, {"error": {"message": "not found"}})
                if "key=" in self.path or "?" in self.path: return self._send(400, {"error": {"message": "API key in URL is not accepted by this lab"}})
                if rec["key"] != outer.key: return self._send(403, {"error": {"code": 403, "message": "API key not valid", "status": "PERMISSION_DENIED"}})
                b = rec["body"]
                if not isinstance(b, dict) or "systemInstruction" in b or "system_instruction" in b: return self._send(400, {"error": {"code": 400, "message": "Developer instruction is not enabled for this model"}})
                parts = ((b.get("contents") or [{}])[0].get("parts") or [])
                if not parts or "text" not in parts[0]: return self._send(400, {"error": {"message": "contents"}})
                if outer.delay or act == "slow": time.sleep(outer.delay or 8)
                if act == "500": return self._send(500, {"error": {"code": 500, "message": "Internal error encountered.", "status": "INTERNAL"}})
                if act == "429": return self._send(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})
                if act == "garbage": return self._send(200, raw=b"\x00 no json \xff")
                if act == "nocand": return self._send(200, {"promptFeedback": {"blockReason": "SAFETY"}})
                if act == "maxtokens": return self._send(200, {"candidates": [{"content": {"parts": [{"text": '{"a": "cor'}]}, "finishReason": "MAX_TOKENS"}]})
                if act == "blocked": return self._send(200, {"candidates": [{"finishReason": "SAFETY"}]})
                if act == "empty": return self._send(200, {"candidates": [{"content": {"parts": []}, "finishReason": "STOP"}]})
                content = outer.content.get(rec["model"], outer.content.get("*", "{}"))
                ps = [{"text": "pensando…", "thought": True}, {"text": content}] if act == "thought" else [{"text": content}]
                self._send(200, {"candidates": [{"content": {"role": "model", "parts": ps}, "finishReason": "STOP"}], "usageMetadata": {"totalTokenCount": 10}})

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); self.srv.handle_error = lambda *a: None; self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def clear(self):
        with self.lock: self.calls.clear(); self.plan.clear()
        self.content, self.delay = {}, 0.0
    def stop(self): self.srv.shutdown(); self.srv.server_close()
