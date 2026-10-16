#!/usr/bin/env bash
# Pruebas de seguridad de pbmini (query, body, filtros/ACL, caché, archivos, registro).
# Uso: security/run-mini.sh /ruta/a/pocketbase
set -u
PB=${1:?ruta al binario pocketbase}; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$HERE"); fail=0; npass=0
W=$(mktemp -d); PORT=8095; B=http://127.0.0.1:$PORT; PID=
stop(){ [[ -n $PID ]] && kill $PID 2>/dev/null && wait $PID 2>/dev/null; PID=; }
trap 'stop; rm -rf "$W" "$W.bad.js" "$W.pages" "$W.env.sh"' EXIT
setup(){ # $1 = routes.js ; $2 = "data" para crear colecciones ; $3 = directorio pages/ opcional
  stop; rm -rf "$W"/*; mkdir -p "$W/outside" "$W/pb_data" "$W/pb_public/sub" "$W/pb_hooks"
  cp -r "$ROOT/pb_hooks/lib" "$ROOT/pb_hooks/views" "$W/pb_hooks/"; cp "$ROOT/pb_hooks/main.pb.js" "$W/pb_hooks/"; cp "$1" "$W/pb_hooks/routes.js"; [[ -n ${3:-} ]] && cp -a "$3" "$W/pb_hooks/pages"
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

echo "################ A. archivos, rutas, params, redirect, errores, límites"; setup "$HERE/mini/routes.js" data "$HERE/mini/pages"
chk 'pub' - 200 /assets/pub.txt; chk sub - 200 /assets/sub/a.txt
for p in /assets/.env /assets/link.txt /assets/dirlink/secret.txt /assets/sub /assets/..%2foutside%2fsecret.txt /assets/%2e%2e/outside/secret.txt /assets/sub/..%2f..%2foutside%2fsecret.txt '/assets/..\outside\secret.txt' '/assets/pub.txt%00.png' /assets/%252e%252e%252foutside/secret.txt /assets/sub/.%2e/pub.txt; do chk - 'TOP-SECRET\|hunter2' 404 "$p"; done
chk - - 200 /u/abcdefghijklmno; chk - - 404 /u/abc; chk - - 404 /u/%2e%2e; chk - - 404 '/u/ABCDEFGHIJKLMNO'
chk - - 200 /slug/hola-mundo; chk - - 404 /slug/Hola; chk - - 404 '/slug/a%2fb'
chk - - 401 /me; chk - - 401 /admin/; chk - - 403 /admin/ -H "Authorization: $TOKA"
chk - '<script>' 200 '/hi?name=%3Cscript%3Ealert(1)%3C/script%3E'; chk '&lt;script' - 200 '/hi?name=%3Cscript%3E'
for to in https://evil.example //evil.example '%2f%5cevil.example' 'javascript:alert(1)'; do chk - - 500 "/go?to=$to"; done
chk - - 400 '/go?to=/ok%0d%0aSet-Cookie:x=1'; chk - - 400 '/go?to=/ok%00'   # CRLF/NUL: el parser los rechaza antes del handler
chk - - 302 '/go?to=/dashboard'; chk - hunter2 500 /boom
head -c 5000 /dev/zero | tr '\0' a > "$W/big"; chk - - 413 /form -X POST --data-binary @"$W/big"; chk - - 200 /form -X POST; chk - - 400 /form -X POST -d ok   # sin esquema de body, campos no declarados se rechazan
grep -aq 'limitador nativo de PocketBase está DESACTIVADO' "$W/log" && ok "aviso de arranque: limitador nativo desactivado" || ko "falta el aviso de limitador desactivado"
# el límite lo aplica PocketBase (nativo) también a rutas de pbmini: lo activamos por la API de settings
curl -s -o /dev/null -X PATCH "$B/api/settings" -H "Authorization: $TOKSU" -H 'Content-Type: application/json' -d '{"rateLimits":{"enabled":true,"rules":[{"label":"/rl","maxRequests":3,"duration":60}]}}'
for i in 1 2 3; do curl -s -o /dev/null "$B/rl"; done; chk - - 429 /rl
chk - - 429 /rl -H 'X-Forwarded-For: 9.9.9.9' -H 'X-Real-IP: 8.8.8.8'   # spoof de IP no evade el límite nativo
chk - - 200 /u/abcdefghijklmno                                              # rutas sin regla no se ven afectadas
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
chk - - 400 '/slug/hola?x=1'                                                          # rutas sin esquema: query no vacía rechazada

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

echo "################ H. PÁGINAS POR ARCHIVOS (estilo PHP)"
chk 'ROOT-LAYOUT' - 200 /; chk 'NAV-PARTIAL' - 200 /; chk '>hello<' 'TOPSECRET\|private-draft' 200 /
chk '&lt;script&gt;alert' '<script>alert' 200 /                                         # autoescape de datos en la plantilla
chk 'ABOUT-STATIC' - 200 /about; chk 'ROOT-LAYOUT' - 200 /about
chk 'BLOG-LAYOUT' 'ROOT-LAYOUT' 200 /blog/; chk 'NAV-PARTIAL' - 200 /blog/; chk 'Blog p1' - 200 /blog/; chk 'Blog p1' - 200 '/blog/?page=1'
chk - - 400 '/blog/?evil=1'; chk - - 400 '/blog/?page=0'; chk - - 400 '/blog/?page=1&page=2'
chk 'POST: hello' - 200 /blog/hello; chk 'slug=hello' - 200 /blog/hello
chk - 'TOPSECRET\|private' 404 /blog/private-draft                                        # viewRule: borrador oculto
chk - - 404 /blog/Hello; chk - - 404 '/blog/a%2fb'; chk - - 404 '/blog/%2e%2e'; chk - - 404 /blog/nope-no-existe
chk '&lt;script&gt;' '<script>alert' 200 /blog/xss-post
chk 'DOC a/b' - 200 /docs/a/b; chk 'DOC x' - 200 /docs/x
for p in /docs/.env '/docs/a/..%2fb' '/docs/%2e%2e/x' '/docs/a/%2e%2e/b' '/docs/a%00b' '/docs/a%5cb' '/docs/.git/config'; do chk - 'DOC' 404 "$p"; done
chk 'SENT-OK' - 200 '/contact?sent=true'; chk - 'SENT-OK' 200 /contact; chk - - 400 '/contact?sent=maybe'
chk - - 303 /contact "${J[@]}" -d '{"name":"ana"}'; chk - - 400 /contact "${J[@]}" -d '{}'; chk - - 400 /contact "${J[@]}" -d '{"name":"a","admin":true}'; chk - - 400 /contact -X POST -d 'name=a&role=admin'
chk '"ok":true' - 200 /health; chk - - 401 /whoami; chk '"id"' - 200 /whoami -H "Authorization: $TOKA"
chk - 'SECRET-PAGE-LEAK' 200 /_secret; chk - 'SECRET-PAGE-LEAK' 200 /secret; chk - 'SECRET-PAGE-LEAK' 200 /.hidden; chk - 'SECRET-PAGE-LEAK' 200 /pb_hooks/pages/_secret.js
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/about"); [[ $code == 404 || $code == 405 ]] && ok "POST a página solo-GET => $code" || ko "POST a página solo-GET => $code"
hdr '^cache-control: no-store' /blog/hello; hdr '^content-security-policy:' /blog/hello; hdr '^content-type: text/html' /blog/hello

echo "################ J. SESIÓN = TOKEN DE POCKETBASE (cookie pb_auth del SDK, validada por PocketBase)"
ckie(){ python3 -I -c 'import sys,json,urllib.parse;print("pb_auth="+urllib.parse.quote(json.dumps({"token":sys.argv[1],"record":{"id":sys.argv[2] if len(sys.argv)>2 else "forged"}}),safe=""))' "$@"; }
jwt(){ python3 -I - "$@" <<'PY'
import sys,base64,json
mode,tok=sys.argv[1],sys.argv[2]; h,p,s=tok.split('.'); d=lambda x: json.loads(base64.urlsafe_b64decode(x+'='*(-len(x)%4))); e=lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
if mode=="payload": pl=d(p); pl["id"]="AAAAAAAAAAAAAAA"; print(h+'.'+e(pl)+'.'+s)
elif mode=="none": print(e({"alg":"none","typ":"JWT"})+'.'+p+'.')
PY
}
AID=$(body "$B/whoami" -H "Authorization: $TOKA" | sed 's/.*"id":"\([^"]*\)".*/\1/'); BID=$(body "$B/whoami" -H "Authorization: $TOKB" | sed 's/.*"id":"\([^"]*\)".*/\1/')
[[ -n $AID && $AID != "$BID" ]] && ok "ids de usuario obtenidos" || ko "no se pudieron obtener ids"
chk "\"id\":\"$AID\"" - 200 /whoami -H "Cookie: $(ckie $TOKA)"
chk "\"id\":\"$AID\"" - 200 /whoami -H "Cookie: $(ckie $TOKA $BID)"                    # record{} de la cookie es ignorado
chk "\"id\":\"$BID\"" - 200 /whoami -H "Authorization: $TOKB" -H "Cookie: $(ckie $TOKA)"   # Authorization nativo tiene prioridad
chk - - 401 /whoami -H "Cookie: $(ckie "${TOKA%?}X")"                                  # firma alterada
chk - - 401 /whoami -H "Cookie: $(ckie "$(jwt payload $TOKA)")"                         # payload alterado, firma original
chk - - 401 /whoami -H "Cookie: $(ckie "$(jwt none $TOKA)")"                            # alg=none
FTOK=$(curl -s -X POST "$B/api/files/token" -H "Authorization: $TOKA" | sed 's/.*"token":"\([^"]*\)".*/\1/')
[[ -n $FTOK ]] && chk - - 401 /whoami -H "Cookie: $(ckie "$FTOK")"                      # token de archivo != sesión
for c in 'pb_auth=%7Bnope' 'pb_auth=' 'pb_auth=%7B%22token%22%3A%7B%22a%22%3A1%7D%7D' 'pb_auth=%7B%22token%22%3A%22a.b%22%7D' "pb_auth=$(python3 -c 'print("A"*9000)')" 'other=1'; do chk - - 401 /whoami -H "Cookie: $c"; done
chk "\"id\":\"$AID\"" - 200 /whoami -H "Cookie: $(ckie $TOKA); pb_auth=junk"             # se usa la primera cookie
chk - - 401 /whoami -H "Cookie: pb_auth=junk; $(ckie $TOKA)"                             # (documentado: cookie tossing => anónimo, nunca otro usuario)
chk - - 200 /admin/ -H "Cookie: $(ckie $TOKSU)"; chk - - 403 /admin/ -H "Cookie: $(ckie $TOKA)"
chk '"who":null' - 200 "/pub/abcdefghijklmno" -H "Cookie: $(ckie $TOKA)"; hdr '^cache-control: no-store' /pub/abcdefghijklmno -H "Cookie: $(ckie $TOKA)"
chk - 'A-DOC' 200 '/api/collections/mine/records' -H "Cookie: $(ckie $TOKA)"           # la API NATIVA de PocketBase no lee la cookie
chk 'A-DOC' - 200 /mine -H "Cookie: $(ckie $TOKA)"                                      # una consulta de pbmini sí, con las reglas de PocketBase
echo "## CSRF (la cookie es credencial ambiental): métodos que cambian estado + Sec-Fetch-Site"
for sfs in cross-site same-site; do chk - - 401 /secure-post -X POST -H "Cookie: $(ckie $TOKA)" -H "Sec-Fetch-Site: $sfs"; done
for sfs in same-origin none; do chk '"ok":true' - 200 /secure-post -X POST -H "Cookie: $(ckie $TOKA)" -H "Sec-Fetch-Site: $sfs"; done
chk '"ok":true' - 200 /secure-post -X POST -H "Cookie: $(ckie $TOKA)"                    # cliente no-navegador (sin cabecera)
chk '"ok":true' - 200 /secure-post -X POST -H "Authorization: $TOKA" -H 'Sec-Fetch-Site: cross-site'   # Authorization no es ambiental
chk - - 200 /whoami -H "Cookie: $(ckie $TOKA)" -H 'Sec-Fetch-Site: cross-site'           # GET (seguro) permitido
echo "## revocación NATIVA: cambiar la contraseña invalida el token (sin lista de sesiones propia)"
curl -s -o /dev/null -X PATCH "$B/api/collections/users/records/$AID" -H "Authorization: $TOKSU" -H 'Content-Type: application/json' -d '{"password":"Other#Pass0rd!","passwordConfirm":"Other#Pass0rd!"}'
chk - - 401 /whoami -H "Cookie: $(ckie $TOKA)"; chk - - 401 /whoami -H "Authorization: $TOKA"
chk "\"id\":\"$BID\"" - 200 /whoami -H "Cookie: $(ckie $TOKB)"                          # otros usuarios no se ven afectados

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
bad "rateLimit (eliminada: lo hace el limitador nativo)" 'app.get("/x", {auth:"public", rateLimit:{max:1}}, (c) => c.text("x"));'
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

echo "################ I. Páginas mal formadas deben abortar el arranque"
badpage(){ # desc relpath contenido [symlink-destino] [routes-body]
  rm -rf "$W.pages"; mkdir -p "$W.pages/$(dirname "$2")"; printf '%s' "$3" > "$W.pages/$2"
  [[ -n ${4:-} ]] && { rm -f "$W.pages/$2"; ln -s "$4" "$W.pages/$2"; }
  printf 'module.exports = (app) => { %s };\n' "${5:-}" > "$W.bad.js"; setup "$W.bad.js" "" "$W.pages"
  if grep -q 'pbmini' "$W/log" && ! kill -0 $PID 2>/dev/null; then ok "rechazada: $1"; else ko "aceptada: $1"; fi; }
badpage "página sin auth" x.js 'module.exports = { get: (c) => ({}) };'
badpage "clave desconocida (auht)" x.js 'module.exports = { auht: "public", get: (c) => ({}) };'
badpage "typo rateLimt (desactivaría el límite)" x.js 'module.exports = { auth: "public", rateLimt: { max: 1 }, get: (c) => ({}) };'
badpage "sin métodos" x.js 'module.exports = { auth: "public" };'
badpage "método no función" x.js 'module.exports = { auth: "public", get: 5 };'
badpage "exporta no-objeto" x.js 'module.exports = 5;'
badpage "nombre con espacios/mayúsculas" "Bad Name.js" 'module.exports = { auth: "public", get: (c) => ({}) };'
badpage "extensión no permitida (.txt)" notes.txt 'hola'
badpage "backup de editor (.js.bak)" x.js.bak 'x'
badpage "enlace simbólico" ln.html '' /etc/hostname
badpage "[...x] en directorio" "[...a]/b.js" 'module.exports = { auth: "public", get: (c) => ({}) };'
badpage "parcial no .html" _partials/evil.sh 'rm -rf /'
badpage "ruta duplicada con routes.js" x.js 'module.exports = { auth: "public", get: (c) => ({}) };' "" 'app.get("/x", { auth: "public" }, (c) => c.text("x"));'
badpage "cache con auth:user" x.js 'module.exports = { auth: "user", cache: { maxAge: 10 }, get: (c) => ({}) };'
badpage "query con nombre reservado" x.js 'module.exports = { auth: "public", query: JSON.parse("{\"__proto__\":\"int\"}"), get: (c) => ({}) };'
rm -rf "$W.pages"; mkdir -p "$W.pages"; for n in a b; do echo 'module.exports = { auth: "public", get: (c) => ({}) };' > "$W.pages/[$n].js"; done
printf 'module.exports = (app) => {};\n' > "$W.bad.js"; setup "$W.bad.js" "" "$W.pages"
if grep -aq 'conflicts with pattern' "$W/log" && ! kill -0 $PID 2>/dev/null; then ok "rechazada: [a] y [b] en conflicto (PocketBase aborta el arranque)"; else ko "aceptada: [a] y [b] en conflicto"; fi

echo "################ G. Lint de código de aplicación"
"$HERE/lint.sh" "$ROOT/pb_hooks" >/dev/null && ok "lint: pb_hooks de ejemplo limpio" || ko "lint: pb_hooks de ejemplo con primitivas peligrosas"
"$HERE/lint.sh" "$HERE/mini/pages" >/dev/null && ok "lint: fixture de páginas limpio" || ko "lint: fixture de páginas marcado"
lintbad(){ rm -rf "$W.l"; mkdir -p "$W.l"; printf '%s\n' "$2" > "$W.l/$1"; "$HERE/lint.sh" "$W.l" >/dev/null 2>&1 && ko "lint no detectó: $3" || ok "lint detecta: $3"; rm -rf "$W.l"; }
lintbad r.js 'module.exports=(a)=>{a.get("/x",{auth:"public"},(c)=>c.json($app.findRecordsByFilter("posts","id != 1")))}' '$app en rutas'
lintbad r.js 'module.exports={auth:"public",get:(c)=>$os.exec("id")}' '$os.exec en páginas'
lintbad p.js 'module.exports={auth:"public",get:(e)=>e.request.url}' 'acceso directo a e.request'
lintbad p.js 'module.exports={auth:"public",get:(c)=>eval("1")}' 'eval'
lintbad p.html '<p>{{.x | raw}}</p>' 'raw en plantilla (pipe)'
lintbad p.html '<p>{{raw .x}}</p>' 'raw en plantilla (función)'
lintbad p.html '<p>{{js .x}}</p>' 'js en plantilla'

echo; echo "resultado: $npass ok, estado=$fail"; exit $fail
