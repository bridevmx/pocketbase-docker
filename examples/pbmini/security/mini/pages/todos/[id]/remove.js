module.exports = {
  auth: "user", params: { id: "id" },
  mutations: { rm: { collection: "todos", op: "delete" } },
  delete: (ctx) => ctx.json(ctx.delete("rm", ctx.params.id)),
};
