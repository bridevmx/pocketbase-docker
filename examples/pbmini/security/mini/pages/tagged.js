// FIXTURE: usa $app.store() a propósito para contar ejecuciones (no es código de aplicación)
const hits = () => { const s = $app.store(); const n = (s.get("t:taghits") || 0) + 1; s.set("t:taghits", n); return n; };
module.exports = {
  auth: "public", cache: { maxAge: 60, server: true, tags: ["posts"] },
  queries: { all: { collection: "posts", filter: "id != ''", sort: ["title"], maxLimit: 100 } },
  get: (ctx) => ctx.json({ hits: hits(), n: ctx.find("all", {}, { limit: 100 }).length }),
};
