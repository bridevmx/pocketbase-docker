module.exports = {
  auth: "user", body: { to: { type: "string", max: 300, required: true }, name: { type: "string", max: 60, default: "amigo" } },
  post: (ctx) => ctx.json({ sent: ctx.mail("welcome", { to: ctx.body.to, data: { name: ctx.body.name } }) }),
  get: (ctx) => ctx.json({ sent: ctx.mail("welcome", { to: "x@y.io", data: { name: "x" } }) }),
};
