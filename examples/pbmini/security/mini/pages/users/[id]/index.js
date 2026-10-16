module.exports = { auth: "public", params: { id: "id" }, get: (ctx) => ({ user: ctx.params.id }) };
