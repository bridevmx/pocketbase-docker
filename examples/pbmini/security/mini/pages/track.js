module.exports = { auth: "public", unknownQuery: "ignore", query: { id: "id" }, get: (ctx) => ctx.json({ keys: Object.keys(ctx.query) }) };
