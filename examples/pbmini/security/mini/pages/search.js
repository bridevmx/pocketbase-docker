module.exports = {
  auth: "public",
  query: { page: { type: "int", min: 1, max: 100, default: 1 }, sort: { enum: ["title", "-title"], default: "title" }, tag: { type: "slug", multi: true } },
  get: (ctx) => ctx.json({ page: ctx.query.page, sort: ctx.query.sort, tag: ctx.query.tag || null, keys: Object.keys(ctx.query) }),
};
