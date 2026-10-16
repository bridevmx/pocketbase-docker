#!/usr/bin/env python3
"""Crea colecciones/usuarios de prueba vía REST y escribe tokens/ids en un env.sh. Uso: setup-data.py PORT OUT"""
import json, sys, urllib.request
port, out = sys.argv[1], sys.argv[2]; B = f"http://127.0.0.1:{port}"
def call(method, path, body=None, tok=None):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if tok: req.add_header("Authorization", tok)
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return json.load(r)
    except urllib.error.HTTPError as e: sys.exit(f"setup fallo {method} {path}: {e.code} {e.read()[:200]}")
su = call("POST", "/api/collections/_superusers/auth-with-password", {"identity": "su@x.io", "password": "Sup3rS3cret!!"})["token"]
txt = lambda n, **k: dict(name=n, type="text", **k)
call("POST", "/api/collections", dict(name="posts", type="base", listRule="published = true", viewRule="published = true",
     fields=[txt("title"), txt("slug"), txt("secret", hidden=True), dict(name="published", type="bool"), dict(name="created", type="autodate", onCreate=True)]), su)
call("POST", "/api/collections", dict(name="vault", type="base", listRule=None, viewRule=None, fields=[txt("note")]), su)
call("POST", "/api/collections", dict(name="mine", type="base", listRule="owner = @request.auth.id", viewRule="owner = @request.auth.id",
     fields=[txt("owner"), txt("doc"), dict(name="created", type="autodate", onCreate=True)]), su)
ids = {}
for t, sl, s, pub in (("hello", "hello", "S-1", True), ("world", "world", "S-2", True), ("private-draft", "private-draft", "TOPSECRET-DRAFT", False), ("<script>alert(1)</script>", "xss-post", "S-3", True)):
    ids[t] = call("POST", "/api/collections/posts/records", dict(title=t, slug=sl, secret=s, published=pub), su)["id"]
call("POST", "/api/collections/vault/records", dict(note="VAULT-NOTE"), su)
tok = {}
for u in ("a", "b"):
    rec = call("POST", "/api/collections/users/records", dict(email=f"{u}@x.io", password="Passw0rd!!", passwordConfirm="Passw0rd!!", verified=True), su)
    tok[u] = call("POST", "/api/collections/users/auth-with-password", dict(identity=f"{u}@x.io", password="Passw0rd!!"))["token"]
    call("POST", "/api/collections/mine/records", dict(owner=rec["id"], doc=f"{u.upper()}-DOC"), su)
open(out, "w").write(f"TOKSU='{su}'\nTOKA='{tok['a']}'\nTOKB='{tok['b']}'\nPUBID='{ids['hello']}'\nPRIVID='{ids['private-draft']}'\n")
