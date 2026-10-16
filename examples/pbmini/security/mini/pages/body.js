module.exports = {
  auth: "public",
  body: { n: { type: "int", min: 0, max: 1000, required: true }, note: { type: "string", max: 20 }, ok: "bool" },
  post: (ctx) => ctx.json({ n: ctx.body.n, note: ctx.body.note || null, ok: ctx.body.ok === undefined ? null : ctx.body.ok, keys: Object.keys(ctx.body).sort() }),
};
