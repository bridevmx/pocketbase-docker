# Cómo crear un plugin (módulo opcional) de pbmini

Un plugin es un **módulo opcional**: apagado por defecto, activado desde `pb_hooks/pbmini.config.js`, sin tocar el núcleo salvo en 5 puntos de enganche. Los ejemplos reales son `mail`, `sessions`, `access` y `telegram`.
Un plugin no está terminado hasta que cumple **todos** los estándares de este documento (código, configuración, seguridad, pruebas, documentación).

---

## 1. Datos que necesito para integrarlo (la ficha del plugin)

Antes de escribir código necesito estas respuestas. Si faltan, las pregunto; no las supongo.

**A. Propósito y alcance**
1. Qué problema resuelve y qué **no** resuelve (qué ya hace PocketBase de forma nativa y no debemos reinventar).
2. Quién lo usa: usuarios finales, operadores/admin, otros servicios.
3. Servicio externo (API/documentación oficial, versión, límites y costes) o solo lógica local.
4. Alcance de la primera versión y lo que queda para después.

**B. Configuración**
5. Opciones de `pbmini.config.js` (nombre de la clave, tipos, rangos, valores por defecto).
6. **Variables de entorno** (nombre, formato exacto, obligatoria/opcional). Los secretos **solo** por entorno, nunca en el archivo de configuración ni en la base.
7. Si necesita un `.env` de pruebas reales: qué valores pongo yo (de prueba) y cuáles debe poner la persona (credenciales reales).

**C. Datos**
8. Colecciones internas (campos, índices únicos, reglas; por defecto todo `null` = solo superusuario).
9. Qué datos personales guarda, por cuánto tiempo y cómo se purgan.
10. Relación con colecciones existentes (usuarios, roles, planes) y qué campos **debe** tener la colección del proyecto.

**D. Superficie**
11. API para las rutas (`ctx.xxx`), para hooks/cron (`require(...).xxx($app, ...)`) y comandos CLI (`pbmini:xxx`).
12. Rutas HTTP propias (webhooks, callbacks): método, ruta, autenticación (secreto, firma, sesión), límites de tamaño.
13. Tareas programadas (cron) y su frecuencia.
14. Hooks nativos que necesita (`onRecord…`, `onServe`, middleware y su prioridad).

**E. Seguridad (modelo de amenazas)**
15. Quién es el atacante en cada punto de entrada y qué quiere (suplantar, leer, enviar, agotar recursos, filtrar secretos).
16. Qué pasa si el servicio externo falla, tarda o responde basura.
17. Qué debe ocurrir ante datos inválidos: **siempre cerrar** (fail-closed), nunca ignorar en silencio.

**F. Pruebas**
18. Cómo simulo el servicio externo en el laboratorio (servidor falso en 127.0.0.1; **nunca** el real en la suite automática).
19. Si hay prueba real: qué hace `real.py` y qué permisos/recursos hacen falta (túnel, dominio, cuenta de pruebas).

---

## 2. Estructura de archivos

| Qué | Dónde |
|---|---|
| Lógica del módulo | `pb_hooks/lib/<nombre>.js` |
| Validación de la configuración | `pb_hooks/lib/config.js` → `normalize<Nombre>()` y entrada en `only(raw, [...])` |
| Enganche en el núcleo | `pb_hooks/lib/mini.js` → `register()` (validar, rutas, cron, hooks), `onServe()` (colecciones), `buildContext()` (`ctx.xxx`) |
| Archivos declarativos del usuario (opcional) | `pb_hooks/<nombre>/…` (como `mails/`, `cron/`, `telegram/actions/`), validados al arrancar |
| CLI | `pb_hooks/lib/cli.js` + comando en `pb_hooks/main.pb.js` |
| Tipos | `pb_hooks/types/pbmini.d.ts` (`Ctx`, `Config`, tipos propios) |
| Plantilla de configuración | `pb_hooks/pbmini.config.example.js` (bloque comentado, todo apagado) |
| Variables | `.env.example` (comentadas; sin valores reales) |
| Pruebas | `lab/attacks_<nombre>.py` (sección `V<letra>`) y registro en `lab/lab.py` |
| Documentación | `README.md` (módulos opcionales), `SECURITY.md` (ronda nueva), `lab/README.md` |

---

## 3. Estándares de código

1. **Apagado por defecto.** Con el módulo desactivado: sin rutas, sin colecciones, sin hooks, sin variables exigidas, y el proyecto arranca igual que sin el módulo. Se comprueba con una prueba.
2. **Fail-closed.** Opción desconocida, tipo incorrecto, valor fuera de rango, variable de entorno mal formada, archivo declarativo inválido o campo inexistente en la colección ⇒ **aborta el arranque** (`PBMINI_ON_ERROR=warn` solo para desarrollo). Una opción ignorada puede dejar un control desactivado.
3. **Validación estricta en la frontera.** Expresiones regulares ancladas, longitudes máximas, JSON estricto, sin claves extra, sin `__proto__`, sin interpolar datos en consultas (siempre parámetros `{:x}`).
4. **Secretos.** Solo en entorno; se redactan de errores y logs; nunca en respuestas, colecciones ni salidas de diagnóstico (`pbmini:xxx status`). Comparaciones de secretos y firmas con `$security.equal`.
5. **No reinventar PocketBase.** Si PocketBase ya lo hace (verificación, reset de contraseña, OTP/OAuth2, reglas de acceso), se usa. Cada decisión se contrasta con la documentación oficial y se **mide** lo no documentado; lo observado se anota como tal.
6. **Handlers aislados.** En hooks, rutas y cron el cuerpo se serializa y corre en una VM aparte: solo globals y `require()` **dentro** del handler; nada de variables del ámbito exterior. Los ids dinámicos van como literal (`eval`, ver `cron`).
7. **Idempotencia y atomicidad.** Operaciones de un solo uso (tokens, nonces) con `UPDATE … WHERE usado = 0` dentro de una transacción y comprobando `rowsAffected()`. Envíos y escrituras repetibles con una `key` única (índice único).
8. **Nunca romper la app del usuario.** Un fallo del servicio externo no puede romper un guardado ni un login: se encola, se reintenta con espera creciente y se registra. La API para hooks lanza, y el hook la envuelve en `try/catch`.
9. **Límites.** Contadores por ventana (global, por usuario/destino, por IP) en `$app.store()`; tamaños de cuerpo (`$apis.bodyLimit`); sin bucles sin tope.
10. **Datos personales.** Se guarda lo mínimo; el contenido se borra al terminar su uso; hay retención y un cron de limpieza basado en fechas que **sí** se pueden controlar (`created` es autodate y no se puede fijar).
11. **No ejecutar lo que no se declaró.** Acciones, plantillas y rutas del usuario solo por archivos declarados y validados al arrancar; el cliente nunca elige un nombre de archivo, una URL o un destino libre.
12. **Una sola fuente de verdad** de cada dato (la plantilla de configuración la copia `pbmini:new config`, no se duplica).
13. **Estilo.** Coherente con los módulos existentes: español en comentarios y mensajes, nombres cortos, comentarios que explican el *por qué* y lo medido.

---

## 4. Estándares de seguridad (lista de verificación)

- [ ] Cada punto de entrada externo está autenticado (secreto/firma/sesión) y la comparación es en tiempo constante.
- [ ] Un atacante que no es el dueño no puede usar el recurso de otro (botones, enlaces, tokens, mensajes).
- [ ] Los tokens/nonces de un solo uso se guardan **solo como hash** y no se pueden reutilizar (ni con peticiones simultáneas).
- [ ] El texto del usuario se escapa en todo destino (HTML, SQL por parámetros, cabeceras, URLs).
- [ ] No hay envío/efecto desde GET ni desde rutas públicas si el efecto tiene coste o destinatario.
- [ ] Las cuentas bloqueadas (`access.statusField`) no reciben, no entran y no ejecutan acciones.
- [ ] Borrar el usuario borra sus datos del módulo.
- [ ] El servicio externo caído, lento o devolviendo basura no filtra secretos ni deja estados inconsistentes.
- [ ] Documentados los límites que no se pueden cubrir (un solo proceso, API nativa de PocketBase fuera del módulo, contenido visible por el proveedor).

---

## 5. Estándares de pruebas

1. **Laboratorio en vivo** (`lab/attacks_<nombre>.py`, ids `V<letra>###`): cada caso declara **objetivo y meta**. Servidor propio con el módulo activo y un **servicio externo falso** (registra llamadas y falla a demanda: 429, 403, 500, 400, lento, caído).
2. Cobertura mínima:
   - camino feliz y cada variante válida;
   - cada entrada inválida (basura, tamaños, tipos, unicode, inyección, claves repetidas, método incorrecto);
   - autenticación del webhook/endpoint (ausente, vacía, parcial, de otro);
   - abuso entre usuarios (recurso ajeno, repetición, manipulación, caducado);
   - **carreras** (varios hilos con el mismo token/key) → exactamente un efecto;
   - fallos del servicio externo y recuperación;
   - límites;
   - cuenta bloqueada / usuario borrado;
   - secretos ausentes de logs, respuestas y colecciones;
   - módulo apagado: sin rutas ni colecciones;
   - **fail-closed del arranque**: una prueba por cada opción y variable inválida;
   - retención/limpieza;
   - CLI.
3. **Mutaciones:** se rompe cada defensa a propósito (script `mut<N>.py`) y la suite debe fallar. Una mutación no detectada = falta una prueba. Objetivo: todas detectadas (se justifica una redundante por diseño).
4. **Regresión:** la suite completa debe seguir en 0 fallos en **Windows y Linux (WSL)**; lo que depende del sistema operativo sale como *omitido*, nunca como aprobado.
5. **Pruebas reales** (opcional, con `.env`): `lab/real.py` con `check`, `serve`, `selftest`, `demo` y, si hace falta recibir sin túnel, `relay`. Solo contra recursos de pruebas de la persona; nunca se imprimen secretos.
6. Las pruebas de tipos (`D…`) y de deriva de configuración deben pasar: toda opción nueva aparece en `pbmini.d.ts`.

---

## 6. Estándares de documentación

- `README.md`: sección del módulo (qué hace, variables, API de rutas/hooks/cron, comandos, límites).
- `SECURITY.md`: ronda nueva con **objetivo, meta, controles, lo medido, resultado de pruebas y mutaciones, y límites que quedan**.
- `pbmini.config.example.js` y `.env.example` actualizados y comentados.
- `types/pbmini.d.ts` con `ctx.xxx`, opciones y tipos de mensajes.
- `lab/README.md`: la sección de pruebas y cómo correrlas.

---

## 7. Flujo de trabajo

1. **Ficha** (sección 1) → acuerdo del alcance.
2. **Diseño:** documentación oficial del servicio y de PocketBase; medir lo dudoso; plan escrito y aprobado antes de programar.
3. **Fases pequeñas** (configuración → núcleo → flujos → seguridad → CLI/tipos/docs), cada una con sus pruebas.
4. **Laboratorio completo** en Windows y Linux + **mutaciones**.
5. **Prueba real** si procede.
6. **Commit** (solo cuando se pide) con mensaje descriptivo; **push** solo con confirmación explícita.

---

## 8. Plantilla mínima de un plugin nuevo

```js
// pb_hooks/lib/miplugin.js
const cfg = () => require(`${__hooks}/lib/config.js`).load().miplugin;
const fail = (m) => { throw new Error("pbmini miplugin: " + m); };

function validate() {            // register(): entorno y archivos; aborta si algo falla
  if (!cfg().enabled) return;
  if (!/^[A-Za-z0-9_-]{32,256}$/.test($os.getenv("MIPLUGIN_SECRET") || "")) fail("MIPLUGIN_SECRET ausente o inválido");
}
function ensure(app) { /* onServe(): colecciones idempotentes con reglas null */ }
function send(e, route, ...args) {   // ctx.miplugin(...)
  if (!cfg().enabled) throw new Error("pbmini: miplugin requiere miplugin.enabled");
  if (route.method === "GET" || route.auth === "public") throw new Error("pbmini: no permitido aquí");
  /* validar → límites → cola/idempotencia → llamar al servicio → registrar sin secretos */
}
module.exports = { validate, ensure, send };
```

Enganches: `normalizeMiplugin` en `config.js`; `mod("miplugin").validate()` en `register()`; `ensure` en `onServe()`; `ctx.miplugin` en `buildContext()`; tipos y plantilla; sección de laboratorio y mutaciones.

---
## Ejemplos completos
- `telegram`: alertas, vinculación, grupos, botones y Mini App (ver README y SECURITY, Ronda 10).
- `clip`: pagos con links de pago (ver README y SECURITY, Ronda 11). Es el ejemplo de un plugin **con dinero**: núcleo puro probado aparte, un solo camino a `paid`, anomalías sin cancelar, reembolso solo por operador, y validación contra el servicio real antes de fijar el comportamiento.
- `notify`: envío simple desde cualquier parte (`lib/notify.js`), independiente del canal.
