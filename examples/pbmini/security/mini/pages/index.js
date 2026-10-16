module.exports = {
  auth: "public",
  queries: { recent: { collection: "posts", filter: "id != ''", sort: ["-created"], maxLimit: 10 } },
  get(ctx) { return { posts: ctx.find("recent", {}, { limit: 10 }) }; },
};
