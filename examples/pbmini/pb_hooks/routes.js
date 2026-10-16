// Toda ruta declara `auth`. Parámetros se validan antes del handler.
module.exports = (app) => {
  app.get("/{$}", { auth: "public" }, (c) => c.view("home", { name: "mundo" }));
  app.get("/u/{id}", { auth: "public", params: { id: "id" } }, (c) => c.json({ id: c.params.id }));
  app.get("/blog/{slug}", { auth: "public", params: { slug: "slug" } }, (c) => c.json({ slug: c.params.slug }));
  app.get("/assets/{path...}", { auth: "public" }, (c) => c.file("pb_public", c.params.path));
  app.get("/api/myapp/ping", { auth: "public", allowSystemPrefix: true }, (c) => c.json({ ok: true }));
  app.get("/me", { auth: "user" }, (c) => c.json({ id: c.auth.id }));
  app.get("/admin/{$}", { auth: "superuser" }, (c) => c.text("admin"));
  app.post("/form", { auth: "public", bodyLimit: 10 * 1024 }, (c) => c.json({ posted: true }));
};
