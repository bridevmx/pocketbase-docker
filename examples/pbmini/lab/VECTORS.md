# 50 vectores aún sin probar en el laboratorio

Fuente: **[doc]** = dicho en la documentación oficial de PocketBase/Go; **[exp]** = medido por nosotros en 0.40.5; **[inf]** = hipótesis mía, sin verificar (hay que probarla).
Todas son candidatas para el catálogo `objetivo → meta` de `lab.py`.

## A. Reglas y API nativa de PocketBase
| # | Vector | Objetivo (qué se intenta) | Meta (resultado seguro) | Fuente |
|---|---|---|---|---|
| 1 | Mass assignment en registro público de `users` | Crear usuario con `verified=true`, `emailVisibility`, `role`, o `id` propio | Campos protegidos ignorados o rechazados; probar `@request.body.x:isset = false` | [doc] `:isset` |
| 2 | `:changed` en archivos | Cambiar un campo `file` saltándose una regla `:changed/:isset` | La doc admite que no cubren archivos nuevos: necesita otra regla | [doc] |
| 3 | `manageRule` de colecciones auth | Un usuario con manageRule cambia email/contraseña de otro y toma la cuenta | Solo el alcance previsto; sin escalada a superuser | [doc] |
| 4 | Operadores `?=` / `?~` (any-of) | Ampliar acceso en reglas con relaciones múltiples (match-all por defecto) | Reglas no concedan acceso por una sola coincidencia | [doc] |
| 5 | Comodín `%`/`_` en `~` con parámetro enlazado | Pasar `%` en un parámetro `{:t}` usado con `~` para coincidir con todo | pbmini escapa `%`/`_` o no usa `~` con input libre | [doc] `~` auto-% + [inf] |
| 6 | Diferencial de códigos (400/404/200 vacío) | Deducir si un registro existe por create=400, view=404, list=200 vacío | Sin oráculo útil de existencia en datos sensibles | [doc] |
| 7 | `:lower` con Unicode | Evadir reglas de igualdad insensible a mayúsculas con letras no ASCII (`İ`, `ß`) | Reglas no dependen de `:lower` para seguridad | [doc] ASCII-only |
| 8 | `@request.context` | Usar OAuth2/OTP/realtime para saltar reglas que asumen contexto "default" | Reglas por contexto verificadas | [doc] |
| 9 | `@request.headers.*` falsificadas | Enviar `x_forwarded_for` u otras cabeceras para satisfacer una regla | Ninguna regla confía en cabeceras de cliente | [doc] normalización |
| 10 | Subida de archivos (MIME/tamaño/SVG) | Subir SVG/HTML con script o `.js` y cargarlo desde el origen propio | Límites de campo, `Content-Disposition`, sin ejecución en el origen | [doc] + [inf] |
| 11 | Token de archivo protegido (`/api/files/token`) | Reutilizar/fugar el token para leer archivos de otro usuario | Token de vida corta, ligado al usuario; ya probado que no sirve como sesión | [doc] + [exp] |
| 12 | Realtime/SSE | Suscribirse a una colección y recibir eventos tras perder acceso o de registros ocultos | Reglas aplicadas en suscripción y en cada evento | [inf] |
| 13 | `/api/batch` | Eludir límite de peticiones o reglas empaquetando operaciones | Cada operación pasa por reglas y por el limitador | [inf] |
| 14 | Pre-hijacking OAuth2 / email no verificado | Registrar el email de la víctima sin verificar y esperar el enlace OAuth2 | Versión corregida (≥ avisos GHSA-pq7p / m93w) y verificación obligatoria | [doc] advisories |
| 15 | Fuerza bruta de OTP/MFA | Adivinar códigos de 6 dígitos | Limitador nativo con regla específica para endpoints OTP | [inf] |
| 16 | Enumeración por reset/verify/cambio de email | Descubrir cuentas por diferencias de respuesta o tiempo | Respuesta uniforme | [inf] |
| 17 | Whitelist de IP de superusers + proxy | Falsificar `X-Forwarded-For` para entrar a `/_/` | `trustedProxy` correcto; sin cabecera confiada por defecto | [doc] |
| 18 | Limitador evadido por forma de ruta | Esquivar la regla con `//`, mayúsculas, `HEAD`, `OPTIONS`, barra final o `?x` | La misma regla cuenta todas las variantes | [exp] parcial |
| 19 | CORS `*` con rutas pbmini y cookie | Leer respuestas autenticadas desde otro origen | Con cookie, `Access-Control-Allow-Credentials` nunca + `*`; probar `Origin: null` | [doc] `--origins` |
| 20 | Secretos en claro en `pb_data` / backups | Descargar un backup o robar `pb_data` y leer SMTP/S3 | `--encryptionEnv` activo; backups no accesibles al anónimo | [doc] producción |
| 21 | Tokens en logs | Buscar tokens/queries sensibles en `_logs` | Sin tokens en URL ni en logs; acceso solo superuser | [inf] |
| 22 | Panic fuera de request | Provocar excepción en cron/hook/goroutine para tumbar el proceso | Proceso sigue vivo (corregido en GHSA-84vh) | [doc] advisory |
| 23 | Agotar descriptores con realtime | Abrir miles de conexiones SSE | `ulimit`/`LimitNOFILE` y límites del proxy | [doc] |
| 24 | Slowloris / cuerpo lento | Mantener conexiones abiertas goteando bytes | Timeouts del proxy (`proxy_read_timeout`, `read_timeout`) | [doc] ejemplos proxy |
| 25 | Filtros/`expand` costosos | `expand` profundo, `@collection` anidado o back-relations para saturar SQLite | Límite de profundidad/tiempo; nada de filtros del cliente en pbmini | [inf] |
| 26 | `fields`/`expand` con back-relations | Leer datos de otra colección vía `expand=x_via_y` | Reglas de la colección destino aplicadas | [inf] |

## B. HTTP, parseo y protocolo
| # | Vector | Objetivo | Meta | Fuente |
|---|---|---|---|---|
| 27 | Método sobrescrito | `X-HTTP-Method-Override`, `_method=DELETE`, `HEAD` en ruta POST | Ignorado o 405; HEAD no ejecuta efectos | [inf] |
| 28 | Confusión de `Content-Type` | Mandar JSON como `text/plain`, `multipart`, `charset=utf-7`, doble cabecera | Parser estricto: 400/415 | [inf] |
| 29 | Cabeceras duplicadas | Dos `Authorization`, dos `Cookie`, `Host` repetido | Determinista; nunca elegir la peor | [inf] |
| 30 | Host / URI absoluta | `GET http://evil/ HTTP/1.1`, `Host: evil`, `X-Forwarded-Proto` | Ningún enlace ni redirect absoluto con el host del atacante | [exp] parcial |
| 31 | Request smuggling | CL.TE/TE.CL contra el proxy delante | Proxy moderno + pruebas con proxy real (nginx/Caddy) | [inf] |
| 32 | JSON hostil | Claves duplicadas `{"n":1,"n":2}`, anidado profundo, enteros enormes, `-0`, `1e999` | 400 o valor determinista | [inf] |
| 33 | Cuerpo comprimido | `Content-Encoding: gzip` bomba | Rechazado o con límite tras descomprimir | [inf] |
| 34 | `Range` / `If-Range` múltiples | Rangos solapados para DoS o revelar fragmentos | Límite de rangos en `ctx.file` | [exp] Range funciona |
| 35 | Redirección nativa de limpieza | `//evil.com/..`, `/\evil.com` que Go convierte en 307 | `Location` siempre relativo y sin host externo | [doc] Go limpia rutas |
| 36 | `%2F` dentro de parámetro | `/blog/a%2fb/edit` llega como `a/b` | Tipos estrictos; verificar en rutas con auth (hoy: 401 antes que 404) | [exp] |
| 37 | Orden auth vs validación | Distinguir "ruta existe" vs "param inválido" sin sesión | Respuesta uniforme o aceptar y documentar el diferencial | [exp] |
| 38 | Fallback `index.html` | `/blog/x/y/z` devolvió 200 con `<h1>idx</h1>` | Con `--indexFallback=false` = 404 real (obligar en Docker) | [exp] |
| 39 | Casing y trailing slash | `/blog/A/`, `/BLOG/x`, `/blog/x//` | 404/307 consistente; sin saltarse auth | [exp] parcial |

## C. Archivos y plataforma
| # | Vector | Objetivo | Meta | Fuente |
|---|---|---|---|---|
| 40 | Rutas de Windows | `CON`, `NUL`, `file.txt::$DATA`, nombres 8.3 (`PROGRA~1`), punto/espacio final | `ctx.file` rechaza todo salvo `[a-z0-9._-]` | [inf] |
| 41 | Sistema de archivos insensible a mayúsculas | `/assets/.ENV`, `/assets/PUB.TXT` | El chequeo de dotfile no depende de mayúsculas | [inf] |
| 42 | Carrera TOCTOU con symlinks | Cambiar un archivo por symlink entre `readDir` y servir | `pb_public` de solo lectura; revalidar al servir | [inf] |
| 43 | Unicode | `U+FF0F` (／ fullwidth), NFC/NFD, `%c0%af`, homógrafos en slugs | Slugs solo ASCII; comparar tras normalizar | [inf] |
| 44 | Módulo plantado | `require()` busca en cwd, `node_modules` y padres (la doc lo dice): plantar `node_modules/` | Sin `node_modules`; `pb_hooks` solo lectura; ejecutar en cwd controlado | [doc] |

## D. Plantillas, navegador y operación
| # | Vector | Objetivo | Meta | Fuente |
|---|---|---|---|---|
| 45 | XSS por contexto | `href="{{.url}}"` con `javascript:`, atributos sin comillas, CSS, `<base>` | `html/template` neutraliza; probar cada contexto | [inf] |
| 46 | Inyección en plantilla (SSTI) | `{{` en HTML plano que `mini.js` concatena con `loadString` | Los datos nunca entran como plantilla; solo contenido de archivos del repo | [inf] (mini.js:242) |
| 47 | CSP con `script-src 'self'` | Subir un `.js` a `pb_public` y ejecutarlo como script propio | Subidas de usuario fuera del origen/`Content-Disposition: attachment` | [inf] |
| 48 | Clickjacking | Enmarcar páginas pbmini | CSP `frame-ancestors 'none'` además de `X-Frame-Options` | [exp] XFO actual |
| 49 | Canales laterales | Tiempo de login, de "slug existe" y de acierto de caché | Diferencias no explotables o aceptadas | [inf] |
| 50 | Recarga en caliente y variables de entorno | Archivo a medio escribir al recargar; `PBMINI_ON_ERROR=warn` apaga fail-closed | Despliegue inmutable (sin recarga viva); entorno controlado | [doc] recarga + [exp] |
