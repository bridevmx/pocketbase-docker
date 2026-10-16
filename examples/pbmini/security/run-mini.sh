#!/usr/bin/env bash
# Pruebas de seguridad de pbmini (query, body, filtros/ACL, caché, archivos, registro).
# Uso: security/run-mini.sh /ruta/a/pocketbase
set -u
PB=${1:?ruta al binario pocketbase}; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$HERE"); fail=0; npass=0
W=$(mktemp -d); PORT=8095; B=http://127.0.0.1:$PORT; PID=
stop(){ [[ -n $PID ]] && kill $PID 2>/dev/null && wait $PID 2>/dev/null; PID=; }
trap 'stop; rm -rf "$W" "$W.bad.js"' EXIT
setup(){ # $1 = routes.js ; $2 = "data" para crear colecciones
  stop; rm -rf "$W"/*; mkdir -p "$W/outside" "$W/pb_data" "$W/pb_public/sub" "$W/pb_hooks"
  cp -r "$ROOT/pb_hooks/lib" "$ROOT/pb_hooks/views" "$W/pb_hooks/"; cp "$ROOT/pb_hooks/main.pb.js" "$W/pb_hooks/"; cp "$1" "$W/pb_hooks/routes.js"
  echo TOP-SECRET-OUTSIDE > "$W/outside/secret.txt"; echo ENV=hunter2 > "$W/pb_public/.env"; echo pub > "$W/pb_public/pub.txt"; echo sub > "$W/pb_public/sub/a.txt"
  echo "<h1>idx</h1>" > "$W/pb_public/index.html"; ln -s "$W/outside/secret.txt" "$W/pb_public/link.txt"; ln -s "$W/outside" "$W/pb_public/dirlink"
  "$PB" superuser upsert su@x.io 'Sup3rS3cret!!' --dir="$W/pb_data" >/dev/null 2>&1
  (cd "$W" && PBMINI_STORE_MAX=500 "$PB" serve --http=127.0.0.1:$PORT --dir="$W/pb_data" --publicDir="$W/pb_public" --hooksDir="$W/pb_hooks" >"$W/log" 2>&1 </dev/null) &
  PID=$!; sleep 4
  if [[ ${2:-} == data ]]; then python3 -I "$HERE/setup-data.py" $PORT "$W.env.sh" || { echo "FAIL setup de datos"; exit 2; }; . "$W.env.sh"; fi; }
ok(){ echo "ok   $1"; npass=$((npass+1)); }
ko(){ echo "FAIL $1"; fail=1; }
# chk <debe-contener|-> <no-debe-contener|-> <código> <ruta> [args curl]
chk(){ local want=$1 leak=$2 code=$3 path=$4; shift 4; local out c
  out=$(curl -sg --path-as-is -m8 -w '\n%{http_code}' "$@" "$B$path"); c=${out##*$'\n'}
  if [[ $c != "$code" ]]; then ko "${path:0:70} esperado $code, obtuvo $c"
  elif [[ $leak != - ]] && grep -q -- "$leak" <<<"$out"; then ko "${path:0:70} FILTRA '$leak'"
  elif [[ $want != - ]] && ! grep -q -- "$want" <<<"$out"; then ko "${path:0:70} no contiene '$want'"
  else ok "${path:0:70} ($c)"; fi; }
hdr(){ # hdr <regex> <ruta> [args]  (GET real, no HEAD)
  local re=$1 path=$2; shift 2
  if curl -sg -m8 -D- -o /dev/null "$@" "$B$path" | tr -d '\r' | grep -qiE -- "$re"; then ok "header /$re/ en ${path:0:50}"; else ko "falta header /$re/ en ${path:0:50}"; fi; }
nohdr(){ local re=$1 path=$2; shift 2
  if curl -sg -m8 -D- -o /dev/null "$@" "$B$path" | tr -d '\r' | grep -qiE -- "$re"; then ko "no debía haber header /$re/ en ${path:0:50}"; else ok "sin header /$re/ en ${path:0:50}"; fi; }
body(){ curl -sg -m8 "$@"; }
eq(){ [[ $1 == "$2" ]] && ok "$3" || ko "$3 (esperado: $2 | obtuvo: $1)"; }
ne(){ [[ $1 != "$2" ]] && ok "$3" || ko "$3 (iguales: $1)"; }

echo "################ A. archivos, rutas, params, redirect, errores, límites"; setup "$HERE/mini/routes.js" data
chk 'pub' - 200 /assets/pub.txt; chk sub - 200 /assets/sub/a.txt
for p in /assets/.env /assets/link.txt /assets/dirlink/secret.txt /assets/sub /assets/..%2foutside%2fsecret.txt /assets/%2e%2e/outside/secret.txt /assets/sub/..%2f..%2foutside%2fsecret.txt '/assets/..\outside\secret.txt' '/assets/pub.txt%00.png' /assets/%252e%252e%252foutside/secret.txt /assets/sub/.%2e/pub.txt; do chk - 'TOP-SECRET\|hunter2' 404 "$p"; done
chk - - 200 /u/abcdefghijklmno; chk - - 404 /u/abc; chk - - 404 /u/%2e%2e; chk - - 404 '/u/ABCDEFGHIJKLMNO'
chk - - 200 /blog/hola-mundo; chk - - 404 /blog/Hola; chk - - 404 '/blog/a%2fb'
chk - - 401 /me; chk - - 401 /admin/; chk - - 403 /admin/ -H "Authorization: $TOKA"
chk - '<script>' 200 '/hi?name=%3Cscript%3Ealert(1)%3C/script%3E'; chk '&lt;script' - 200 '/hi?name=%3Cscript%3E'
for to in https://evil.example //evil.example '%2f%5cevil.example' 'javascript:alert(1)'; do chk - - 500 "/go?to=$to"; done
chk - - 400 '/go?to=/ok%0d%0aSet-Cookie:x=1'; chk - - 400 '/go?to=/ok%00'   # CRLF/NUL: el parser los rechaza antes del handler
chk - - 302 '/go?to=/dashboard'; chk - hunter2 500 /boom
head -c 5000 /dev/zero | tr '\0' a > "$W/big"; chk - - 413 /form -X POST --data-binary @"$W/big"; chk - - 200 /form -X POST; chk - - 400 /form -X POST -d ok   # sin esquema de body, campos no declarados se rechazan
for i in 1 2 3; do curl -s -o /dev/null "$B/rl"; done; chk - - 429 /rl
chk - - 429 /rl -H 'X-Forwarded-For: 9.9.9.9' -H 'X-Real-IP: 8.8.8.8'   # spoof de IP no evade el límite
for h in content-security-policy referrer-policy x-content-type-options permissions-policy; do hdr "^$h:" /u/abcdefghijklmno; done

echo "################ B. QUERY STRING (parser estricto)"
chk '"page":2' - 200 '/search?page=2'; chk '"page":1' - 200 /search; chk '"sort":"title"' - 200 /search
chk '"tag":\["a-b","c"\]' - 200 '/search?tag=a-b&tag=c'
chk '"page":2' - 200 '/search?p%61ge=2'            # clave codificada = misma clave
chk '"page":3' - 200 '/search?page=%33'
for q in 'page=1&page=2' 'page=1;sort=title' 'page=%zz' 'page=%00' 'page=%E0%A4%A' 'page=abc' 'page=-1' 'page=0' 'page=101' 'page=007' 'page=1.5' 'page=1e2' 'page=+1' 'page=%201' 'page=' 'PAGE=2' 'unknown=1' '__proto__=x' 'constructor=y' 'prototype=1' '%5f%5fproto%5f%5f[polluted]=1' 'page[]=1' 'page[0]=1' 'sort=bad' 'sort=title&sort=-title' 'sort=title%00' 'tag=A' 'tag=a&tag=b&tag=c&tag=d&tag=e&tag=f&tag=g&tag=h&tag=i&tag=j&tag=k' 'page=1&&sort=title' 'page=1&' '&page=1' 'page=1%26sort%3Dtitle&sort=-title' '=1' '%00=1' 'page=1&'"$(printf 'k=1&%.0s' $(seq 1 40))"; do chk - - 400 "/search?$q"; done
chk - - 414 "/search?page=$(printf '1%.0s' $(seq 1 2100))"
chk '"keys":\["id"\]' - 200 '/track?id=abcdefghijklmno&utm_source=x&fbclid=y'      # unknownQuery:"ignore"
chk - - 400 '/track?id=abcdefghijklmno&utm_source=%zz'; chk - - 400 '/track?id=bad'; chk - - 400 '/track?id=abcdefghijklmno&id=abcdefghijklmno'
chk - - 400 '/hi?name=a&name=b'; chk - - 400 "/hi?name=$(printf 'A%.0s' $(seq 1 60))"; chk - - 400 '/hi?evil=1'
chk - - 400 '/blog/hola?x=1'                                                          # rutas sin esquema: query no vacía rechazada

echo "################ C. BODY (esquema, mass-assignment, pollution)"
J=(-X POST -H 'Content-Type: application/json')
chk '"n":5' - 200 /body "${J[@]}" -d '{"n":5}'; chk '"keys":\["n","note","ok"\]' - 200 /body "${J[@]}" -d '{"n":5,"note":"hola","ok":true}'
chk '"n":7' - 200 /body -X POST -d 'n=7'                                               # form-urlencoded
for d in '{}' '{"n":"x"}' '{"n":-1}' '{"n":1001}' '{"n":1.5}' '{"n":5,"extra":1}' '{"n":{"a":1}}' '{"n":[1]}' '{"n":5,"note":"%s"}' '{"n":5,"ok":"yes"}' '{"__proto__":{"admin":true},"n":1}' '{"n":5,"constructor":{"prototype":{"x":1}}}' '{"n":null}' '{"n":5,"note":"a\u0000b"}'; do
  d=${d/\%s/$(printf 'x%.0s' $(seq 1 30))}; chk - - 400 /body "${J[@]}" -d "$d"; done
chk - - 400 /body -X POST -d 'n=5&admin=1'; chk - - 400 /body -X POST -d 'n=5&n=6'

echo "################ D. FILTROS / DB (consultas preparadas + reglas + hidden)"
chk '"title":"hello"' 'S-1\|TOPSECRET' 200 '/posts?title=hello'
for t in "x' || published = false || title='y" "x' || @collection._superusers.email ~ 'su' || title='" "'" '%' '\' "hello' && secret ~ 'S"; do chk '\[\]' 'TOPSECRET\|private-draft' 200 "/posts?title=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$t")"; done
chk - - 400 '/posts?sort=secret'; chk - - 400 '/posts?sort=@random'; chk - - 400 '/posts?sort=title;DROP'; chk '"title"' - 200 '/posts?title=hello&sort=-title'
chk - 'TOPSECRET\|private-draft\|S-1\|S-2' 200 /posts-all; chk 'hello' - 200 /posts-all; chk 'world' - 200 /posts-all
chk '"title":"hello"' 'S-1\|"secret"' 200 "/posts-one/$PUBID"; chk 'null' 'TOPSECRET\|private' 200 "/posts-one/$PRIVID"      # viewRule aplicada
chk - - 500 /posts-badsort                                                             # sort sobre campo hidden: abortado
for s in -secret '@collection.users.email' 'title,secret' 'created' 'nope'; do chk - - 500 "/posts-undeclared-sort?s=$s"; done
chk - - 200 '/posts-undeclared-sort?s=title'; chk - - 200 '/posts-undeclared-sort?s=-created'
chk '\[\]' 'VAULT' 200 /vault; chk 'VAULT-NOTE' - 200 /vault-su -H "Authorization: $TOKSU"   # listRule null => sólo superuser
chk - - 403 /vault-su -H "Authorization: $TOKA"
chk 'A-DOC' 'B-DOC' 200 /mine -H "Authorization: $TOKA"; chk 'B-DOC' 'A-DOC' 200 /mine -H "Authorization: $TOKB"; chk - - 401 /mine
grep -q 'sort sobre campo inexistente u oculto' "$W/log" && ok "log registra intento de sort sobre hidden" || ko "log sin el intento de sort hidden"
! grep -q 'TOPSECRET' <(curl -sg "$B/posts-all") && ok "ninguna respuesta incluye el secreto" || ko "secreto filtrado"

echo "################ E. CACHÉ HTTP y de servidor"
ID1=abcdefghijklmno; ID2=abcdefghijklmnp
hdr '^cache-control: public, max-age=60' /pub/$ID1; hdr '^etag: "[0-9a-f]{32}"' /pub/$ID1
b1=$(body "$B/pub/$ID1"); b2=$(body "$B/pub/$ID1"); eq "$b2" "$b1" "hit de caché: el handler no se reejecuta"
ne "$(body "$B/pub/$ID2")" "$b1" "otra clave => otra entrada"
ET=$(curl -sg -D- -o /dev/null "$B/pub/$ID1" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
chk - - 304 /pub/$ID1 -H "If-None-Match: $ET"; chk - - 200 /pub/$ID1 -H 'If-None-Match: "otro"'
# claves no influyentes: Host / X-Forwarded-* / idioma / UA / orden y codificación de query
for hv in 'Host: evil.example' 'X-Forwarded-Host: evil.example' 'X-Forwarded-For: 6.6.6.6' 'Accept-Language: xx' 'User-Agent: zzz' 'Origin: https://evil.example'; do eq "$(body -H "$hv" "$B/pub/$ID1")" "$b1" "cabecera '${hv%%:*}' no altera ni envenena la caché"; done
q1=$(body "$B/pub/$ID1?n=1&m=true"); eq "$(body "$B/pub/$ID1?m=true&n=1")" "$q1" "orden de query normalizado"; eq "$(body "$B/pub/$ID1?n=%31&m=true")" "$q1" "codificación normalizada"
chk - - 400 "/pub/$ID1?n=01"; chk - - 400 "/pub/$ID1?n=1&n=1"; chk - - 404 /pub/BADID
hdr '^cache-control: no-store' "/pub/$ID1?n=01"; hdr '^cache-control: no-store' /pub/BADID; hdr '^cache-control: no-store' /nocache; hdr '^cache-control: no-store' /u/$ID1
# credenciales => jamás público ni servido desde caché, y la respuesta es anónima
c1=$(body -H 'Cookie: s=1' "$B/pub/$ID1"); ne "$c1" "$b1" "con Cookie se reejecuta el handler (no sirve caché compartida)"
hdr '^cache-control: no-store' /pub/$ID1 -H 'Cookie: s=1'; hdr '^cache-control: no-store' /pub/$ID1 -H "Authorization: $TOKA"
chk '"who":null' - 200 /pub/$ID1 -H "Authorization: $TOKA"                             # la ruta cacheable no ve la identidad
chk '"hits"' - 200 /nocache; ne "$(body "$B/nocache")" "$(body "$B/nocache")" "ruta sin cache: siempre reejecuta"
hdr '^cache-control: no-store' /me -H "Authorization: $TOKA"; hdr '^cache-control: no-store' /vault-su -H "Authorization: $TOKSU"
hdr '^cache-control: public, max-age=300' /assets/pub.txt; hdr '^cache-control: no-store' /assets/.env; hdr '^last-modified:' /assets/pub.txt
hdr '^cache-control: public, max-age=30' /hdrcache; hdr '^etag:' /hdrcache
# acotación: inundar claves distintas no crece sin límite ni desaloja entradas legítimas
python3 -I - "$PORT" <<'PY'
import http.client, sys, string, random
c = http.client.HTTPConnection("127.0.0.1", int(sys.argv[1]), timeout=10)
al = string.ascii_lowercase + string.digits
for i in range(900):
    c.request("GET", "/flood/" + "".join(random.choice(al) for _ in range(15))); c.getresponse().read()
PY
n=$(body "$B/storelen" | sed 's/[^0-9]//g'); [[ $n -le 505 ]] && ok "store acotado tras 900 claves ($n <= 500+margen)" || ko "store creció a $n"
eq "$(body "$B/pub/$ID1")" "$b1" "la entrada legítima sigue cacheada tras la inundación"

echo "################ F. Rutas mal declaradas deben abortar el arranque"
bad(){ printf 'module.exports = (app) => { %s };\n' "$2" > "$W.bad.js"; setup "$W.bad.js"
  if grep -q 'pbmini: ' "$W/log" && ! kill -0 $PID 2>/dev/null; then ok "rechazada: $1"; else ko "aceptada: $1"; fi; }
bad "sin auth" 'app.get("/x", {}, (c) => c.text("x"));'
bad "sin opts" 'app.get("/x", (c) => c.text("x"));'
bad "auth inválido" 'app.get("/x", {auth:"admin"}, (c) => c.text("x"));'
bad "comodín '/' accidental" 'app.get("/", {auth:"public"}, (c) => c.text("x"));'
bad "prefijo con barra final" 'app.get("/files/", {auth:"public"}, (c) => c.text("x"));'
bad "prefijo /api/" 'app.get("/api/x", {auth:"public"}, (c) => c.text("x"));'
bad "duplicada" 'app.get("/x", {auth:"public"}, (c) => c.text("x")); app.get("/x", {auth:"public"}, (c) => c.text("y"));'
bad "tipo de parámetro desconocido" 'app.get("/x/{id}", {auth:"public", params:{id:"nope"}}, (c) => c.text("x"));'
bad "param tipado ausente del patrón" 'app.get("/x", {auth:"public", params:{id:"id"}}, (c) => c.text("x"));'
bad "campo query __proto__ (clave propia)" 'app.get("/x", {auth:"public", query:JSON.parse("{\"__proto__\":\"int\"}")}, (c) => c.text("x"));'
bad "campo query 'constructor'" 'app.get("/x", {auth:"public", query:{constructor:"int"}}, (c) => c.text("x"));'
bad "tipo de query desconocido" 'app.get("/x", {auth:"public", query:{a:"any"}}, (c) => c.text("x"));'
bad "enum vacío" 'app.get("/x", {auth:"public", query:{a:{enum:[]}}}, (c) => c.text("x"));'
bad "body en GET" 'app.get("/x", {auth:"public", body:{a:"int"}}, (c) => c.text("x"));'
bad "cache con auth:user" 'app.get("/x", {auth:"user", cache:{maxAge:10}}, (c) => c.text("x"));'
bad "cache en POST" 'app.post("/x", {auth:"public", cache:{maxAge:10}}, (c) => c.text("x"));'
bad "cache maxAge absurdo" 'app.get("/x", {auth:"public", cache:{maxAge:999999}}, (c) => c.text("x"));'
bad "cache en prefix" 'app.get("/x/", {auth:"public", prefix:true, cache:{maxAge:10}}, (c) => c.text("x"));'
bad "cache.server con query libre" 'app.get("/x", {auth:"public", cache:{maxAge:10,server:true}, query:{q:{type:"string",max:100}}}, (c) => c.text("x"));'
bad "cache.server con param sin tipo" 'app.get("/x/{id}", {auth:"public", cache:{maxAge:10,server:true}}, (c) => c.text("x"));'
bad "cache.server con wildcard" 'app.get("/x/{p...}", {auth:"public", cache:{maxAge:10,server:true}, params:{p:{type:"string",max:10}}}, (c) => c.text("x"));'
bad "consulta sobre colección de sistema" 'app.get("/x", {auth:"public", queries:{q:{collection:"_superusers", filter:"id != ''"}}}, (c) => c.text("x"));'
bad "consulta con filtro no string" 'app.get("/x", {auth:"public", queries:{q:{collection:"posts", filter:42}}}, (c) => c.text("x"));'
bad "consulta con placeholder roto" 'app.get("/x", {auth:"public", queries:{q:{collection:"posts", filter:"title = {:t"}}}, (c) => c.text("x"));'
bad "consulta con sort inválido" 'app.get("/x", {auth:"public", queries:{q:{collection:"posts", filter:"id != 1", sort:["title; DROP"]}}}, (c) => c.text("x"));'
bad "consulta con rule inválida" 'app.get("/x", {auth:"public", queries:{q:{collection:"posts", filter:"id != 1", rule:"all"}}}, (c) => c.text("x"));'

echo "################ G. Lint de rutas de aplicación"
"$HERE/lint.sh" "$ROOT/pb_hooks/routes.js" >/dev/null && ok "lint: routes.js de ejemplo limpio" || ko "lint: routes.js de ejemplo con primitivas peligrosas"
printf 'module.exports=(a)=>{a.get("/x",{auth:"public"},(c)=>c.json($app.findRecordsByFilter("posts","id != \x27\x27")))}\n' > "$W.bad.js"
"$HERE/lint.sh" "$W.bad.js" >/dev/null 2>&1 && ko "lint no detectó \$app" || ok "lint detecta \$app en rutas"

echo; echo "resultado: $npass ok, estado=$fail"; exit $fail
