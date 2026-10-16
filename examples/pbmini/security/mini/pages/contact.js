module.exports = {
  auth: "public",
  query: { sent: { type: "bool", default: false } },
  body: { name: { type: "string", max: 40, required: true }, msg: { type: "string", max: 200 } },
  get(c) { return { sent: c.q.sent }; },
  post(c) { return c.redirect("/contact?sent=true", 303); },
};
