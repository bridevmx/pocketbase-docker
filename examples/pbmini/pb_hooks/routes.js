// routes.js es OPCIONAL: úsalo para endpoints JSON/API. Las páginas viven en pb_hooks/pages/.
// Sólo la API `c` (el lint de CI prohíbe $app/$os/e.*). Toda ruta declara `auth`.
module.exports = (app) => {
  app.get("/healthz", { auth: "public" }, (c) => c.json({ ok: true }));
};
