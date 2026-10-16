module.exports = {
  auth: "public",
  queries: { recent: { collection: "posts", filter: "id != ''", sort: ["-created"], maxLimit: 10 } },
  get(c) { return { posts: c.find("recent", {}, { limit: 10 }) }; },
};
