module.exports = {
  auth: "public", query: { name: { type: "string", max: 40, default: "x" } },
  get: (ctx) => ctx.json({ locale: ctx.locale, greeting: ctx.t("greeting", { name: ctx.query.name }), missing: ctx.t("no_such_key"), price: ctx.t("price", { amount: 5, currency: "$&" }) }),
};
