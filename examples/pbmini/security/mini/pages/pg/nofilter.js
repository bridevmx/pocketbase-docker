// Intenta usar un filtro que NO está declarado (debe fallar de forma cerrada: 500, nunca ejecutar)
module.exports = {
  auth: "public",
  paginate: { perPage: 2, maxPerPage: 5 },
  queries: { list: { collection: "posts", filter: "id != ''", sort: ["title"], filters: { slug: "slug = {:v}" } } },
  get: (ctx) => ctx.json(ctx.paginate("list", {}, { where: { "title != '' || id": "x" } })),
};
