// Paginación estándar + filtros declarados (constantes) alimentados por valores de la query
module.exports = {
  auth: "public",
  paginate: { perPage: 2, maxPerPage: 5, sort: ["title", "-title"] },
  query: { slug: { type: "string", max: 32 }, pub: { type: "bool" } },
  queries: {
    list: { collection: "posts", filter: "published = true", sort: ["title", "-title"], filters: { slug: "slug = {:v}", pub: "published = {:v}" } },
  },
  get: (ctx) => ctx.json(ctx.paginate("list", {}, { where: { slug: ctx.query.slug, pub: ctx.query.pub } })),
};
