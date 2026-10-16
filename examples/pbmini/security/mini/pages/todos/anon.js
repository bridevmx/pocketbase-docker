module.exports = {
  auth: "public",
  mutations: { add: { collection: "todos", op: "create", fields: ["title", "owner"] } },
  post: (ctx) => ctx.json(ctx.create("add", { title: "anon", owner: "anon" })),
};
