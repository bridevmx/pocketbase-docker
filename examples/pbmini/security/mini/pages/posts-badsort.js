module.exports = { auth: "public", queries: { badsort: { collection: "posts", filter: "id != ''", sort: ["secret"] } }, get: (ctx) => ctx.json(ctx.find("badsort", {}, { sort: "secret" })) };
