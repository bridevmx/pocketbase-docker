module.exports = {
  auth: "public",
  params: { slug: "slug" },
  queries: { bySlug: { collection: "posts", filter: "slug = {:s}", rule: "view" } },
  get(c) { const post = c.findOne("bySlug", { s: c.params.slug }); if (!post) return c.notFound(); return { post }; },
};
