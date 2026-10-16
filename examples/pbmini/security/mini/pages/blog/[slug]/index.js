module.exports = {
  auth: "public",
  params: { slug: "slug" },
  queries: { bySlug: { collection: "posts", filter: "slug = {:s}", rule: "view" } },
  get(ctx) { const post = ctx.findOne("bySlug", { s: ctx.params.slug }); if (!post) return ctx.notFound(); return { post }; },
};
