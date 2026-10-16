module.exports = {
  auth: "public",
  queries: { posts: { collection: "posts", filter: "title = {:t}", sort: ["title", "-title", "-created"] } },
  query: { title: { type: "string", max: 100 }, sort: { enum: ["title", "-title"], default: "title" } },
  get: (ctx) => ctx.json(ctx.find("posts", { t: ctx.query.title || "" }, { sort: ctx.query.sort })),
};
