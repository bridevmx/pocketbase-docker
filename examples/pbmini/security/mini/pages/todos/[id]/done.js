module.exports = {
  auth: "user", params: { id: "id" },
  body: { done: { type: "bool", required: true } },
  mutations: { setDone: { collection: "todos", op: "update", fields: ["done"] } },
  patch: (ctx) => ctx.json(ctx.update("setDone", ctx.params.id, { done: ctx.body.done })),
};
