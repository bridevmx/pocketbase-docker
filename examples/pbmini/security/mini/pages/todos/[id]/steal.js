// Intenta cambiar el dueño: la regla se evalúa contra el registro EXISTENTE, no contra el modificado
module.exports = {
  auth: "user", params: { id: "id" },
  body: { owner: { type: "id", required: true } },
  mutations: { steal: { collection: "todos", op: "update", fields: ["owner"] } },
  patch: (ctx) => ctx.json(ctx.update("steal", ctx.params.id, { owner: ctx.body.owner })),
};
