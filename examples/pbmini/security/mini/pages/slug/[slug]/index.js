module.exports = { auth: "public", params: { slug: "slug" }, get: (ctx) => ctx.json({ slug: ctx.params.slug }) };
