module.exports = {
  auth: "user",
  query: "paging",
  body: { title: { type: "string", max: 100 }, done: { type: "bool", default: false } },
  queries: { mine: { collection: "todos", filter: "id != ''", sort: ["-created"] } },
  mutations: { add: { collection: "todos", op: "create", fields: ["title", "done", "owner"] } },
  get: (ctx) => ctx.json(ctx.find("mine")),
  post: (ctx) => ctx.json(ctx.create("add", { title: ctx.body.title, done: ctx.body.done, owner: ctx.user.id })),
};
