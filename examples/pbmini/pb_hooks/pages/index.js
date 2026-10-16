// GET /  — se renderiza con index.html dentro de _layout.html
module.exports = {
  auth: "public",
  cache: { maxAge: 60 },                                     // opcional: Cache-Control público (solo respuestas anónimas)
  queries: { recent: { collection: "posts", filter: "published = true", sort: ["-created"], maxLimit: 5 } },
  get(ctx) { return { posts: ctx.find("recent", {}, { limit: 5 }) }; },   // el objeto devuelto llega a la plantilla
};
