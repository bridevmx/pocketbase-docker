module.exports = {
  auth: "public",
  query: { sent: { type: "bool", default: false } },
  body: { name: { type: "string", max: 40, required: true }, msg: { type: "string", max: 200 } },
  get(ctx) { return { sent: ctx.query.sent }; },
  post(ctx) { return ctx.redirect("/contact?sent=true", 303); },
};
