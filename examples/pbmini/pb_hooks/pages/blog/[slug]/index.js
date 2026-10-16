// GET /blog/mi-entrada — la carpeta [slug]/ es el parámetro de ruta; "slug" lo restringe a [a-z0-9-]
module.exports = {
  auth: "public",
  params: { slug: "slug" },
  queries: { bySlug: { collection: "posts", filter: "slug = {:s} && published = true", rule: "view" } },   // {:s} va enlazado, nunca concatenado
  get(ctx) {
    const post = ctx.findOne("bySlug", { s: ctx.params.slug });
    if (!post) return ctx.notFound();
    return { post };
  },
};
