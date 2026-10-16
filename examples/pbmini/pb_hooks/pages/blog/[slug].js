// GET /blog/mi-entrada — [slug] es un parámetro de ruta; "slug" lo restringe a [a-z0-9-]
module.exports = {
  auth: "public",
  params: { slug: "slug" },
  queries: { bySlug: { collection: "posts", filter: "slug = {:s} && published = true", rule: "view" } },   // {:s} va enlazado, nunca concatenado
  get(c) {
    const post = c.findOne("bySlug", { s: c.params.slug });
    if (!post) return c.notFound();
    return { post };
  },
};
