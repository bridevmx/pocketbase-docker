// Transacción: dos altas y un fallo opcional => todo o nada
module.exports = {
  auth: "user",
  body: { mode: { enum: ["ok", "boom", "badfield", "foreign"], default: "ok" } },
  mutations: { add: { collection: "todos", op: "create", fields: ["title", "done", "owner"] } },
  post: (ctx) => ctx.json(ctx.tx((t) => {
    const a = t.create("add", { title: "batch-1", done: false, owner: ctx.user.id });
    if (ctx.body.mode === "badfield") t.create("add", { title: "batch-x", owner: ctx.user.id, role: "admin" });
    if (ctx.body.mode === "foreign") t.create("add", { title: "batch-f", owner: "someoneelse00000" });
    const b = t.create("add", { title: "batch-2", done: false, owner: ctx.user.id });
    if (ctx.body.mode === "boom") throw new Error("boom");
    return { a: a.id, b: b.id, seen: t.find("mine").length };
  })),
  queries: { mine: { collection: "todos", filter: "id != ''", sort: ["-created"] } },
};
