module.exports = { auth: "public", query: { to: { type: "string", max: 200 } }, get: (ctx) => ctx.redirect(ctx.query.to) };
