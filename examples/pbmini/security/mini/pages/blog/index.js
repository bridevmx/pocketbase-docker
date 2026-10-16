module.exports = {
  auth: "public",
  query: { page: { type: "int", min: 1, max: 100, default: 1 } },
  queries: { list: { collection: "posts", filter: "id != ''", sort: ["title"], maxLimit: 20 } },
  get(ctx) { return { page: ctx.query.page, posts: ctx.find("list", {}, { page: ctx.query.page, limit: 20 }) }; },
};
