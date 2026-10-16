module.exports = { auth: "public", params: { id: "id" }, get: (ctx) => ctx.json({ id: ctx.params.id }) };
