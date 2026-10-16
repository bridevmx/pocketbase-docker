"""Fuzzer GUIADO por las definiciones de ruta. Lee la tabla de rutas real (`pocketbase pbmini:routes`) y, por cada ruta y campo,
genera entradas inválidas a partir del TIPO declarado (límites, casi-patrones, tipos cruzados, duplicados, claves peligrosas...).
Oráculos (no dependen de lo que haga cada ruta):
  1. Matriz de autenticación: lo que declara `auth` es lo que ocurre (anónimo / usuario A / usuario B / superusuario), sin ejecutar el manejador.
  2. Entrada inválida => 400/404/413/414 (nunca 2xx/3xx y NUNCA 5xx).
  3. Entrada válida generada (GET) => nunca 5xx ni fugas de canarios.
  4. Mezclas aleatorias con semilla fija (reproducibles).
Todas las peticiones inválidas se envían con un superusuario (o sin credenciales en rutas públicas): si el manejador llegara a ejecutarse
por un fallo de validación, el oráculo lo detecta; las que no llegan al manejador no tienen efectos secundarios."""
import json, random, re, urllib.parse

SEED = 20261016
BAD_OK = (400, 404, 413, 414, 431)
# rutas cuyo manejador falla A PROPÓSITO con una entrada válida (fixtures del laboratorio)
INTENTIONAL_5XX = {"GET /boom", "GET /err", "GET /todos/getmut", "GET /mailer", "GET /ses/logout", "GET /pg/nofilter", "GET /posts-badsort", "GET /posts-undeclared-sort", "GET /go"}
SKIP_VALID = {"GET /rl", "GET /flood/{id}"}   # tienen límites/efectos propios que otras pruebas ya miden


def build(L, ctx, A, routes_table):
    Case, raw, port, LEAKS = L.Case, L.raw, ctx["port"], L.LEAKS
    cases, cnt = [], [0]
    TOK = {"A": ctx["TOKA"], "B": ctx["TOKB"], "SU": ctx["TOKSU"]}
    J = {"Content-Type": "application/json"}
    table = routes_table(ctx)

    def add(cat, obj, meta, fn):
        cnt[0] += 1; cases.append(Case(f"VF{cnt[0]:03d}", cat, obj, meta, None, run=fn))

    # ---------------------------------------------------------------- generación de valores válidos / inválidos por tipo
    def valid(spec):
        t = spec.get("type")
        if t == "int": return str(spec.get("min", 0))
        if t == "bool": return "true"
        if t == "enum": return spec["enum"][0]
        if t == "id": return "abcdefghijklmno"
        if t == "slug": return "a-b"
        if t == "uuid": return "123e4567-e89b-12d3-a456-426614174000"
        if t == "string":
            for c in ("a", "abc", "hello", "x1", "abc-123", "test", "2024-01-01", "a@b.io"):
                if len(c) > spec.get("max", 100): continue
                if spec.get("pattern") and not _re(spec["pattern"], c): continue
                return c
        return None

    def _re(pat, v):
        try: return re.search(pat, v) is not None
        except re.error: return True

    def invalid(spec, json_body):
        t, out = spec.get("type"), []
        if t == "int":
            lo, hi = spec.get("min", 0), spec.get("max", 2147483647)
            if json_body: out += [str(lo - 1), str(hi + 1), "abc", "0x10", "+1", "NaN", "Infinity", "--1", "\"5\"", "1.5", "true", "null", "[]", "{}", str(2 ** 70), "\"\"", "1,5"]   # 1e2 y -0 son JSON válidos
            else: out += [str(lo - 1), str(hi + 1), "abc", "1.5", "1e2", "0x10", " 1", "1 ", "+1", "-0", "٣", "9" * 30, "", "null", "NaN", "Infinity", "1,5", "1%00", "--1"]
        elif t == "bool":
            out += ["yes", "1", "0", "TRUE", "True", "", "true ", "truee", "null"]
            if json_body: out += ["1", "0", "\"true\"", "null", "[]"]
        elif t == "string":
            mx = spec.get("max", 100)
            if mx < 5000: out += ["x" * (mx + 1)]
            out += ["\x00", "\x1f", "a\nb", "a\x7fb", "\x00" * 4]
            if not spec.get("allowEmpty"): out += [""]
            if spec.get("pattern"):
                out += [v for v in ("!!!@@@", "‮", "../..", "<script>", " ", "'\"") if not _re(spec["pattern"], v)]
            if json_body: out += ["5", "true", "[]", "{}", "null", "[\"a\"]"]
        elif t == "enum":
            e0 = spec["enum"][0]
            out += ["", e0.upper() if e0.upper() != e0 else e0 + "X", e0 + "x", " " + e0, e0 + " ", "__proto__", "constructor", e0 + "\x00"]
            if json_body: out += ["1", "null", "[]", "{}", "true"]
        elif t == "id":
            out += ["abcdefghijklm", "abcdefghijklmnop", "ABCDEFGHIJKLMNO", "abcdefghijklmn\x00", "../abcdefghij", "abcde-ghijklmno", "", " " * 15, "a" * 100]
            if json_body: out += ["5", "null", "[]"]
        elif t == "slug":
            out += ["A-b", "a--b", "-a", "a-", "a_b", "a b", "a" * 200, "", "a/b", "a.b", "Ａ"]
            if json_body: out += ["5", "null"]
        elif t == "uuid":
            out += ["123e4567-e89b-12d3-a456-42661417400", "123e4567e89b12d3a456426614174000", "G23e4567-e89b-12d3-a456-426614174000", "", "123E4567-E89B-12D3-A456-426614174000"]
            if json_body: out += ["5", "null"]
        return out

    # ---------------------------------------------------------------- construcción de peticiones a partir de una ruta
    def base(r):
        """(path, query, body) válidos mínimos, o None si no se puede generar un valor para algún campo obligatorio/parámetro."""
        path = r["pattern"]; params = {}
        for p in r["params"]:
            v = "a/b" if p["wildcard"] else (valid(p["spec"]) if p["spec"] else "a")
            if v is None: return None
            params[p["name"]] = v
        q, b = {}, {}
        for name, spec in r["query"].items():
            if spec.get("required"):
                v = valid(spec)
                if v is None: return None
                q[name] = v
        for name, spec in r["body"].items():
            if spec.get("required"):
                v = valid(spec)
                if v is None: return None
                b[name] = v
        return params, q, b

    def mkpath(r, params):
        p = r["pattern"]
        for name, v in params.items():
            p = p.replace("{" + name + "...}", "/".join(urllib.parse.quote(x, safe="") for x in v.split("/"))).replace("{" + name + "}", urllib.parse.quote(v, safe=""))
        return "/" if p == "/{$}" else p

    def body_json(r, b):
        out = {}
        for k, v in b.items():
            spec = r["body"][k]; t = spec.get("type")
            out[k] = int(v) if t == "int" else (v == "true") if t == "bool" else v
        return out

    def send(r, params, q, b, hdr=None, raw_query=None, raw_body=None, jsonbody=True):
        path = mkpath(r, params)
        qs = raw_query if raw_query is not None else urllib.parse.urlencode(q)
        if qs: path += "?" + qs
        h = dict(hdr or {})
        if r["method"] == "GET": return raw(port, "GET", path, h)
        if raw_body is not None: h = {**J, **h}; return raw(port, r["method"], path, h, raw_body)
        if r["body"] or True:
            h = {**J, **h}; return raw(port, r["method"], path, h, json.dumps(body_json(r, b)))

    def leaked(resp):
        blob = resp.body + "".join(resp.hdrlines)
        return [k for k in LEAKS if k in blob]
    def auth_hdr(r): return {} if r["auth"] == "public" else {"Authorization": TOK["SU"]}

    # ---------------------------------------------------------------- 1. matriz de autenticación (una prueba por ruta)
    def matrix(r):
        def f(_):
            bs = base(r)
            if bs is None: return None, "OMITIDO: no se pudo generar un valor válido para un parámetro/campo obligatorio"
            params, q, b = bs; ignore = r["unknownQuery"] == "ignore" and r["method"] == "GET"
            bad, seen = [], {}
            for who, hdr in (("anon", {}), ("A", {"Authorization": TOK["A"]}), ("B", {"Authorization": TOK["B"]}), ("SU", {"Authorization": TOK["SU"]})):
                if r["method"] == "GET": resp = send(r, params, {**q, "__fz__": "1"}, b, hdr)
                else: resp = send(r, params, q, {**b, "__fz__": 1}, hdr, raw_body=json.dumps({**body_json(r, b), "__fz__": 1}))
                seen[who] = resp.status
                if leaked(resp): bad.append(f"{who}→FUGA {leaked(resp)}")
                if resp.status >= 500 and not ignore: bad.append(f"{who}→{resp.status}")
            acc = bool(r.get("access"))
            for who, got in seen.items():
                if r["auth"] == "public":
                    if got in (401, 403): bad.append(f"{who}→{got} en una ruta pública")
                elif who == "anon":
                    if got != 401: bad.append(f"anon→{got} (esperado 401)")
                elif r["auth"] == "superuser" and who in ("A", "B"):
                    if got != 403: bad.append(f"{who}→{got} (esperado 403)")
                elif got in (401, 403) and not (acc and who != "SU"): bad.append(f"{who}→{got} con credenciales válidas")
                # superado el control de acceso, la validación debe rechazar el campo desconocido ANTES de ejecutar el manejador
                allowed = r["auth"] == "public" or who == "SU" or (r["auth"] == "user" and who in ("A", "B") and not acc)
                if allowed and not ignore and got != 400: bad.append(f"{who}→{got} (esperado 400: la validación rechaza antes de ejecutar)")
            return not bad, "; ".join(bad) or f"anon={seen['anon']} A={seen['A']} B={seen['B']} SU={seen['SU']}"
        return f
    for r in table:
        add("F1 · Matriz de autenticación", f"{r['key']} (auth:{r['auth']}) con anónimo, usuario A, usuario B y superusuario", "Lo declarado en `auth` es lo que ocurre; sin 5xx ni fugas", matrix(r))

    # ---------------------------------------------------------------- 2. entradas inválidas por campo
    def fields_case(r):
        def f(_):
            bs = base(r)
            if bs is None: return None, "OMITIDO: no se pudo generar un valor válido base"
            params, q, b = bs; hdr = auth_hdr(r); bad, n = [], 0
            def check(resp, label):
                nonlocal n
                n += 1
                loc = resp.header("location") or ""
                if resp.status in (301, 307, 308) and loc.startswith("/") and not loc.startswith("//") and ".." not in loc and "//" not in loc: pass   # Go limpia la ruta (../, //, /.) y redirige a la forma canónica
                elif resp.status not in BAD_OK: bad.append(f"{label}→{resp.status}")
                if leaked(resp): bad.append(f"{label}→FUGA")
            for p in r["params"]:
                if not p["spec"] and not p["wildcard"]: continue
                variants = invalid(p["spec"], False) if p["spec"] else []
                if p["wildcard"]: variants += ["../x", "a/../b", ".hidden/x", "a//b", "a/.", "%2e%2e/x"]
                for v in variants:
                    pr = {**params, p["name"]: v}
                    try: resp = send(r, pr, q, b, hdr)
                    except Exception as e: bad.append(f"param {p['name']}={v[:12]!r}: {type(e).__name__}"); continue
                    if v in ("",) and not p["wildcard"]: continue   # ruta distinta (sin segmento): la sirve otra ruta o 404 nativo
                    check(resp, f"param {p['name']}={v[:14]!r}")
            for kind, fields in (("query", r["query"]), ("body", r["body"])):
                for name, spec in fields.items():
                    is_json = kind == "body"
                    for v in invalid(spec, is_json):
                        if kind == "query":
                            try: resp = send(r, params, {**q, name: v}, b, hdr)
                            except Exception: continue
                            if r["method"] != "GET": continue
                            check(resp, f"query {name}={v[:14]!r}")
                        else:
                            doc = json.dumps({**body_json(r, b), name: "__RAW__"}).replace("\"__RAW__\"", v if v and (v[0] in "[{\"" or v in ("true", "false", "null") or re.fullmatch(r"-?[0-9.eE+]+|NaN|Infinity", v or "x")) else json.dumps(v))
                            try: resp = send(r, params, q, b, hdr, raw_body=doc)
                            except Exception: continue
                            check(resp, f"body {name}={v[:14]!r}")
                    if kind == "query" and r["method"] == "GET" and not spec.get("multi"):
                        resp = send(r, params, q, b, hdr, raw_query=f"{name}={valid(spec)}&{name}={valid(spec)}") if valid(spec) is not None else None
                        if resp is not None: check(resp, f"query duplicado {name}")
                    if kind == "body" and r["method"] != "GET": pass
            # campos desconocidos (mass assignment / contaminación de prototipo) y estructuras de cuerpo raras
            if r["method"] == "GET":
                if r["unknownQuery"] != "ignore":
                    for extra in ("__fz__=1", "__proto__=1", "constructor=1", "proto[x]=1", "a=1&b=2", "%5f%5fproto%5f%5f=1", "x[]=1", ";a=1", "&&", "="):
                        check(send(r, params, q, b, hdr, raw_query=urllib.parse.urlencode(q) + ("&" if q else "") + extra), f"query extra {extra[:12]!r}")
            else:
                for label, doc in (("raíz arreglo", "[]"), ("raíz null", "null"), ("raíz número", "5"), ("raíz texto", "\"x\""), ("basura final", json.dumps(body_json(r, b)) + " x"), ("dos documentos", json.dumps(body_json(r, b)) * 2),
                                   ("campo __proto__", json.dumps({**body_json(r, b)})[:-1] + (", " if b else "") + "\"__proto__\": {\"a\": 1}}"), ("campo constructor", json.dumps({**body_json(r, b)})[:-1] + (", " if b else "") + "\"constructor\": 1}"),
                                   ("campo desconocido", json.dumps({**body_json(r, b), "__fz__": 1})), ("anidado profundo", "[" * 3000 + "]" * 3000), ("BOM + JSON", "﻿" + json.dumps(body_json(r, b))), ("JSON truncado", json.dumps(body_json(r, b))[:-1] or "{")):
                    if label == "campo desconocido" or label.startswith("campo") or label in ("raíz arreglo", "raíz null", "raíz número", "raíz texto", "basura final", "dos documentos", "anidado profundo", "BOM + JSON", "JSON truncado"):
                        try: resp = send(r, params, q, b, hdr, raw_body=doc.encode("utf-8"))
                        except Exception: continue
                        check(resp, f"cuerpo {label}")
                for req in (k for k, s in r["body"].items() if s.get("required")):
                    d = body_json(r, b); d.pop(req, None); check(send(r, params, q, b, hdr, raw_body=json.dumps(d)), f"falta {req}")
            for req in (k for k, s in r["query"].items() if s.get("required")):
                qq = {k: v for k, v in q.items() if k != req}; check(send(r, params, qq, b, hdr), f"falta query {req}")
            return not bad, "; ".join(bad[:5]) + (f" (+{len(bad) - 5} más)" if len(bad) > 5 else "") if bad else f"{n} entradas inválidas rechazadas (400/404) sin 5xx ni fugas"
        return f
    for r in table:
        if r["params"] or r["query"] or r["body"] or r["method"] != "GET":
            add("F2 · Entradas inválidas guiadas por tipo", f"{r['key']}: {len(r['params'])} parámetros, {len(r['query'])} query, {len(r['body'])} campos de cuerpo", "Toda entrada fuera de contrato se rechaza (400/404) y nunca llega al manejador", fields_case(r))

    # ---------------------------------------------------------------- 3. entradas válidas (solo GET): nunca 5xx ni fugas
    def smoke(r):
        def f(_):
            bs = base(r)
            if bs is None: return None, "OMITIDO: no se pudo generar un valor válido"
            params, q, b = bs
            variants = [(params, q)]
            for name, spec in r["query"].items():
                v = valid(spec)
                if v is not None: variants.append((params, {**q, name: v}))
            for name, spec in r["query"].items():
                if spec.get("type") == "int": variants += [(params, {**q, name: str(spec["min"])}), (params, {**q, name: str(spec["max"])})]
            bad = []
            for pr, qq in variants:
                resp = send(r, pr, qq, {}, auth_hdr(r))
                if resp.status >= 500: bad.append(f"{urllib.parse.urlencode(qq)[:40]!r}→{resp.status}")
                if leaked(resp): bad.append(f"FUGA {leaked(resp)}")
            return not bad, "; ".join(bad[:4]) or f"{len(variants)} peticiones válidas generadas sin 5xx ni fugas"
        return f
    for r in table:
        if r["method"] == "GET" and r["key"] not in INTENTIONAL_5XX and r["key"] not in SKIP_VALID and r["pattern"] not in ("/healthz",):
            add("F3 · Entradas válidas generadas", f"{r['key']}: valores válidos y en los límites del contrato", "Nunca 5xx ni fuga de canarios", smoke(r))

    # ---------------------------------------------------------------- 4. mezclas aleatorias con semilla fija
    def mixed(_):
        rnd = random.Random(SEED); bad = []; n = 0
        cands = [r for r in table if (r["params"] or r["query"] or r["body"]) and base(r) is not None and r["key"] not in INTENTIONAL_5XX]
        for _i in range(400):
            r = rnd.choice(cands); params, q, b = base(r)
            fields = [("param", p["name"], p["spec"]) for p in r["params"] if p["spec"]] + [("query", k, s) for k, s in r["query"].items()] + [("body", k, s) for k, s in r["body"].items()]
            if not fields: continue
            picks = rnd.sample(fields, min(len(fields), rnd.choice((1, 2, 3)))); pr, qq, bb = dict(params), dict(q), body_json(r, b)
            for kind, name, spec in picks:
                v = rnd.choice(invalid(spec, kind == "body") or ["\x00"])
                if kind == "param": pr[name] = v
                elif kind == "query": qq[name] = v
                else: bb[name] = v
            if r["method"] != "GET" and any(k == "body" for k, _n, _s in picks): continue   # los cuerpos mezclados ya se cubren por campo
            try: resp = send(r, pr, qq, {}, auth_hdr(r)) if r["method"] == "GET" else send(r, pr, qq, b, auth_hdr(r))
            except Exception: continue
            n += 1
            if resp.status >= 500: bad.append(f"{r['key']} {picks[0][1]}→{resp.status}")
            if leaked(resp): bad.append(f"{r['key']} FUGA")
        return not bad, "; ".join(bad[:5]) or f"{n} peticiones mezcladas (semilla {SEED}) sin 5xx ni fugas"
    add("F4 · Mezclas aleatorias", "400 peticiones con 1-3 campos inválidos a la vez sobre rutas elegidas al azar", f"Reproducible (semilla {SEED}); sin 5xx ni fugas", mixed)
    return cases
