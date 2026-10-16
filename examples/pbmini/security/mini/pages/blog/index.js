module.exports = {
  auth: "public",
  query: { page: { type: "int", min: 1, max: 100, default: 1 } },
  queries: { list: { collection: "posts", filter: "id != ''", sort: ["title"], maxLimit: 20 } },
  get(c) { return { page: c.q.page, posts: c.find("list", {}, { page: c.q.page, limit: 20 }) }; },
};
