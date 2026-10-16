// Toda ruta declara `auth`. Query/body/params se validan con esquema ANTES del handler.
// Sólo la API `c` de pbmini; las primitivas del sistema las bloquea security/lint.sh.
module.exports = (app) => {
  app.get("/{$}", { auth: "public" }, (c) => c.view("home", { name: "mundo" }));
  app.get("/u/{id}", { auth: "public", params: { id: "id" } }, (c) => c.json({ id: c.params.id }));
  app.get("/blog/{slug}", { auth: "public", params: { slug: "slug" }, cache: { maxAge: 60, server: true } }, (c) => c.json({ slug: c.params.slug }));
  app.get("/assets/{path...}", { auth: "public", cache: { maxAge: 300 } }, (c) => c.file("pb_public", c.params.path));
  app.get("/me", { auth: "user" }, (c) => c.json({ id: c.auth.id }));
  app.get("/admin/{$}", { auth: "superuser" }, (c) => c.text("admin"));
  app.post("/form", { auth: "public", bodyLimit: 10 * 1024, body: { name: { type: "string", max: 50 } } }, (c) => c.json({ posted: true, name: c.b.name || null }));
};
