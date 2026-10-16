module.exports = { auth: "public", queries: { vault: { collection: "vault", filter: "id != ''" } }, get: (ctx) => ctx.json(ctx.find("vault")) };
