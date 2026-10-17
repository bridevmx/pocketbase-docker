// FIXTURE (superusuario): emite un token ESTÁNDAR de PocketBase (sin sid), como los emitidos antes de activar el módulo de sesiones
module.exports = {
  auth: "superuser", query: { id: "id" },
  get: (ctx) => ctx.json({ token: $app.findRecordById("users", ctx.query.id).newAuthToken() }),
};
