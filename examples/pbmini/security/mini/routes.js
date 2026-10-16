// FIXTURE de pruebas (usa $app a propósito para observar la caché; NO es código de aplicación).
const hits = () => { const s = $app.store(); const n = (s.get("t:hits") || 0) + 1; s.set("t:hits", n); return n; };
module.exports = (app) => {
  app.get("/u/{id}", { auth: "public", params: { id: "id" } }, (c) => c.json({ id: c.params.id }));
  app.get("/slug/{slug}", { auth: "public", params: { slug: "slug" } }, (c) => c.json({ slug: c.params.slug }));
  app.get("/assets/{path...}", { auth: "public", cache: { maxAge: 300 } }, (c) => c.file("pb_public", c.params.path));
  app.get("/me", { auth: "user" }, (c) => c.json({ id: c.auth.id }));
  app.get("/admin/{$}", { auth: "superuser" }, (c) => c.text("admin"));
  app.get("/hi", { auth: "public", query: { name: { type: "string", max: 50 } } }, (c) => c.view("home", { name: c.q.name }));
  app.get("/go", { auth: "public", query: { to: { type: "string", max: 200 } } }, (c) => c.redirect(c.q.to));
  app.get("/boom", { auth: "public" }, () => { throw new Error("db password is hunter2"); });
  app.get("/rl", { auth: "public" }, (c) => c.text("ok"));   // el límite lo pone el limitador NATIVO (settings)
  app.post("/secure-post", { auth: "user" }, (c) => c.json({ ok: true, id: c.auth.id }));
  app.post("/form", { auth: "public", bodyLimit: 1024 }, (c) => c.json({ posted: true }));

  // ---- query strict
  app.get("/search", { auth: "public", query: { page: { type: "int", min: 1, max: 100, default: 1 }, sort: { enum: ["title", "-title"], default: "title" }, tag: { type: "slug", multi: true } } },
    (c) => c.json({ page: c.q.page, sort: c.q.sort, tag: c.q.tag || null, keys: Object.keys(c.q) }));
  app.get("/track", { auth: "public", unknownQuery: "ignore", query: { id: "id" } }, (c) => c.json({ keys: Object.keys(c.q) }));
  // ---- body strict
  app.post("/body", { auth: "public", body: { n: { type: "int", min: 0, max: 1000, required: true }, note: { type: "string", max: 20 }, ok: "bool" } }, (c) => c.json({ n: c.b.n, note: c.b.note || null, ok: c.b.ok === undefined ? null : c.b.ok, keys: Object.keys(c.b).sort() }));
  // ---- consultas preparadas
  const Q = { posts: { collection: "posts", filter: "title = {:t}", sort: ["title", "-title", "-created"] }, all: { collection: "posts", filter: "id != ''", sort: ["title"] },
    byid: { collection: "posts", filter: "id = {:id}", rule: "view" }, badsort: { collection: "posts", filter: "id != ''", sort: ["secret"] },
    vault: { collection: "vault", filter: "id != ''" }, mine: { collection: "mine", filter: "id != ''", sort: ["-created"] } };
  app.get("/posts", { auth: "public", queries: Q, query: { title: { type: "string", max: 100 }, sort: { enum: ["title", "-title"], default: "title" } } }, (c) => c.json(c.find("posts", { t: c.q.title }, { sort: c.q.sort })));
  app.get("/posts-all", { auth: "public", queries: Q }, (c) => c.json(c.find("all")));
  app.get("/posts-one/{id}", { auth: "public", queries: Q, params: { id: "id" } }, (c) => c.json(c.findOne("byid", { id: c.params.id })));
  app.get("/posts-badsort", { auth: "public", queries: Q }, (c) => c.json(c.find("badsort", {}, { sort: "secret" })));
  app.get("/posts-undeclared-sort", { auth: "public", queries: Q, query: { s: { type: "string", max: 40 } } }, (c) => c.json(c.find("posts", { t: "hello" }, { sort: c.q.s })));
  app.get("/vault", { auth: "public", queries: Q }, (c) => c.json(c.find("vault")));
  app.get("/vault-su", { auth: "superuser", queries: Q }, (c) => c.json(c.find("vault")));
  app.get("/mine", { auth: "user", queries: Q }, (c) => c.json(c.find("mine")));
  // ---- caché
  app.get("/pub/{id}", { auth: "public", params: { id: "id" }, cache: { maxAge: 60, server: true }, query: { n: { type: "int", min: 0, max: 5000, default: 0 }, m: { type: "bool", default: false } } }, (c) => c.json({ id: c.params.id, n: c.q.n, m: c.q.m, hits: hits(), who: c.auth ? c.auth.id : null }));
  app.get("/flood/{id}", { auth: "public", params: { id: "id" }, cache: { maxAge: 60, server: true } }, (c) => c.json({ id: c.params.id, hits: hits() }));
  app.get("/nocache", { auth: "public" }, (c) => c.json({ hits: hits() }));
  app.get("/hdrcache", { auth: "public", cache: { maxAge: 30 } }, (c) => c.json({ hits: hits() })); // solo cabeceras, sin caché de servidor
  app.get("/storelen", { auth: "public" }, (c) => c.json({ n: $app.store().length() }));
};
