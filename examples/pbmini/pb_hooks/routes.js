module.exports = (app) => {
  app.get("/{$}", (c) => c.view("home", { name: "mundo" }));
  app.get("/u/{id}", (c) => c.json({ id: c.params.id }));
  app.get("/files/{rest...}", (c) => c.text("rest=" + c.params.rest));
  app.get("/exact/{$}", (c) => c.text("exact"));
  app.get("/exact/", (c) => c.text("prefix"));
  app.get("/api/myapp/ping", (c) => c.json({ ok: true }));
  app.post("/form", (c) => c.json({ posted: true }));
};
