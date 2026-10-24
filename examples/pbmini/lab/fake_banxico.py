"""Banxico CEP FALSO para el laboratorio (solo 127.0.0.1). Imita /cep/ (cookie) y /cep/valida.do (formulario) con la forma medida del sitio real:
 - la respuesta va en Latin-1 (las etiquetas con acento llegan rotas si se leen como UTF-8),
 - «Operación no encontrada» cuando NINGÚN dato coincide: en el sitio real la consulta incluye fecha, emisor, receptor, cuenta y monto, así que un dato distinto también es «no encontrada»
   (modo `strict`; con `loose=True` la operación se devuelve igual para poder probar las comprobaciones propias del módulo),
 - fallos a demanda: captcha, mantenimiento, error del servidor, lentitud, basura, respuesta enorme, marca ERR.
Registra cada llamada (para comprobar también la AUSENCIA de llamadas)."""
import re, threading, time, http.server, urllib.parse

ROW = '<tr{c}><td>{k}</td><td>{v}</td></tr>'


class FakeBanxico:
    def __init__(self):
        self.lock = threading.Lock()
        self.ops = {}                 # clave de rastreo -> operación
        self.calls = []               # {method, path, form, cookie, t}
        self.mode, self.delay, self.require_cookie = None, 0.0, False
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a): pass
            def _send(self, st, body, ctype="text/html; charset=ISO-8859-1", cookie=None):
                b = body if isinstance(body, bytes) else body.encode("latin-1", "replace")
                self.send_response(st); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
                if cookie: self.send_header("Set-Cookie", cookie)
                self.end_headers(); self.wfile.write(b)
            def do_GET(self):
                with outer.lock: outer.calls.append({"method": "GET", "path": self.path, "form": None, "cookie": self.headers.get("Cookie"), "t": time.time()})
                if self.path.startswith("/cep/"): return self._send(200, "<html><body>CEP</body></html>", cookie="JSESSIONID=LABSESSION123; Path=/cep; HttpOnly")
                self._send(404, "no")
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0); text = self.rfile.read(n).decode("utf-8", "replace")
                form = {k: v[0] for k, v in urllib.parse.parse_qs(text, keep_blank_values=True).items()}
                with outer.lock: outer.calls.append({"method": "POST", "path": self.path, "form": form, "cookie": self.headers.get("Cookie"), "xrw": self.headers.get("X-Requested-With"), "ctype": self.headers.get("Content-Type"), "ua": self.headers.get("User-Agent"), "t": time.time()})
                if outer.delay: time.sleep(outer.delay)
                if self.path != "/cep/valida.do": return self._send(404, "no")
                if outer.require_cookie and "JSESSIONID=LABSESSION123" not in (self.headers.get("Cookie") or ""): return self._send(200, "<html>Sesión inválida</html>")
                m = outer.mode
                if m == "500": return self._send(500, "error")
                if m == "503": return self._send(503, "mantenimiento")
                if m == "captcha": return self._send(200, '<html><div id="captchaImage"><img src="stickyImg"></div>El texto de la imagen de seguridad no ha sido ingresado.</html>')
                if m == "maint": return self._send(200, "<html><h1>Sitio en mantenimiento</h1></html>")
                if m == "err": return self._send(200, "<html><meta name=\"meta:stats=ERR\"/>No se ingresó correctamente la información</html>")
                if m == "garbage": return self._send(200, b"\x00\x01\x02 no es html \xff\xfe")
                if m == "empty": return self._send(200, "")
                if m == "huge": return self._send(200, "x" * 500000)
                if m == "redirect": self.send_response(302); self.send_header("Location", "http://127.0.0.1:1/x"); self.send_header("Content-Length", "0"); self.end_headers(); return
                op = outer.ops.get(form.get("criterio", ""))
                if op is None: return self._send(200, outer.not_found())
                if not op.get("loose"):
                    for k in ("fecha", "emisor", "receptor", "cuenta"):
                        if op.get(k) is not None and op[k] != form.get(k): return self._send(200, outer.not_found())
                    if op.get("monto") is not None and abs(float(op["monto"]) - float(form.get("monto") or -1)) > 0.001: return self._send(200, outer.not_found())
                self._send(200, outer.found(op))

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); self.srv.handle_error = lambda *a: None; self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    # --- HTML ---------------------------------------------------------------------------------------------------------------------------------
    def not_found(self):
        return ('<html><body><div class="info"><h4>Información del estado del pago</h4>'
                '<strong>Operación no encontrada. El SPEI no ha recibido una orden de pago que cumpla con el criterio de búsqueda especificado.</strong></div></body></html>')

    def found(self, op):
        rows = [("Número de Referencia", op.get("reference", "1234567")), ("Clave de Rastreo", op.get("tracking")), ("Instituci&oacute;n emisora del pago", op.get("issuing", "BBVA MEXICO")),
                ("Instituci&oacute;n receptora del pago", op.get("receiving", "BANORTE")), ("Estado del pago en Banxico", op.get("status", "Liquidado")), ("Fecha y hora de recepción", op.get("received", "")),
                ("Fecha y hora de procesamiento", op.get("processed", "")), ("Cuenta Beneficiaria", op.get("account")), ("Monto", op.get("amount_text", "{:,.2f}".format(float(op.get("monto", 0)))))]
        if op.get("drop"): rows = [r for r in rows if r[0] not in op["drop"]]
        return "<html><body><table>" + "".join(ROW.format(k=k, v=v, c=(' class="columna-cuenta"' if k.startswith("Cuenta") else ' class="columna-monto"' if k == "Monto" else "")) for k, v in rows if v is not None) + "</table></body></html>"

    # --- control desde las pruebas ---------------------------------------------------------------------------------------------------------
    def add(self, tracking, **op):
        op["tracking"] = tracking; self.ops[tracking] = op; return op   # la clave se busca EXACTA (medido en Banxico real: distingue mayúsculas y el guion cuenta)
    def remove(self, tracking): self.ops.pop(tracking, None)
    def clear(self):
        with self.lock: self.calls.clear()
        self.mode, self.delay, self.require_cookie = None, 0.0, False
    def posts(self):
        with self.lock: return [c for c in self.calls if c["method"] == "POST"]
    def stop(self):
        self.srv.shutdown(); self.srv.server_close()
