// Una escritura desde un GET (CSRF) debe estar prohibida aunque el desarrollador lo intente
module.exports = {
  auth: "user",
  get: (ctx) => ctx.json(ctx.create("add", { title: "from-get", done: false, owner: ctx.user.id })),
};
