module.exports = {
  auth: "public",
  queries: { posts: { collection: "posts", filter: "title = {:t}", sort: ["title", "-title", "-created"] } },
  query: { s: { type: "string", max: 40 } },
  get: (ctx) => ctx.json(ctx.find("posts", { t: "hello" }, { sort: ctx.query.s })),
};
