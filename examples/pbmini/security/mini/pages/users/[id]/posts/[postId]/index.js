module.exports = { auth: "public", params: { id: "id", postId: "int" }, get: (ctx) => ({ user: ctx.params.id, post: ctx.params.postId }) };
