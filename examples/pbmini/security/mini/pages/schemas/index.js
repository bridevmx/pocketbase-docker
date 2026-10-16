module.exports = {
  auth: "public",
  query: "paging",
  body: "note",
  get: (ctx) => ctx.json({ q: ctx.query }),
  post: (ctx) => ctx.json({ b: ctx.body }),
};
