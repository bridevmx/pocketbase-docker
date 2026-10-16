// Campo fuera de la lista blanca => rechazado (500 fail-closed), sin guardar nada
module.exports = {
  auth: "user", params: { id: "id" },
  body: { done: { type: "bool", default: true } },
  mutations: { setDone: { collection: "todos", op: "update", fields: ["done"] } },
  patch: (ctx) => ctx.json(ctx.update("setDone", ctx.params.id, { done: ctx.body.done, owner: ctx.user.id })),
};
