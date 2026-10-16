module.exports = (app) => {
  app.get("/{$}", { auth: "public" }, (c) => c.view("home", { name: "mundo" }));
  app.get("/u/{id}", { auth: "public", params: { id: "id" } }, (c) => c.json({ id: c.params.id }));
  app.get("/blog/{slug}", { auth: "public", params: { slug: "slug" } }, (c) => c.json({ slug: c.params.slug }));
  app.get("/assets/{path...}", { auth: "public" }, (c) => c.file("pb_public", c.params.path));
  app.get("/me", { auth: "user" }, (c) => c.json({ id: c.auth.id }));
  app.get("/admin/{$}", { auth: "superuser" }, (c) => c.text("admin"));
  app.get("/hi", { auth: "public" }, (c) => c.view("home", { name: c.query("name") }));
  app.get("/go", { auth: "public" }, (c) => c.redirect(c.query("to")));
  app.get("/boom", { auth: "public" }, () => { throw new Error("db password is hunter2"); });
  app.get("/rl", { auth: "public", rateLimit: { max: 3, windowSec: 60 } }, (c) => c.text("ok"));
  app.post("/form", { auth: "public", bodyLimit: 1024 }, (c) => c.json({ posted: true }));
};
