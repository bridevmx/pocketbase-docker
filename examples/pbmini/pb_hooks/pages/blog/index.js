// GET /blog/?page=2
module.exports = {
  auth: "public",
  query: { page: { type: "int", min: 1, max: 1000, default: 1 } },   // todo lo no declarado se rechaza (400)
  queries: { list: { collection: "posts", filter: "published = true", sort: ["-created", "title"], maxLimit: 20 } },
  get(c) {
    const posts = c.find("list", {}, { page: c.q.page, limit: 10, sort: "-created" });
    return { posts, page: c.q.page, prev: c.q.page > 1 ? c.q.page - 1 : 0, next: posts.length === 10 ? c.q.page + 1 : 0 };
  },
};
