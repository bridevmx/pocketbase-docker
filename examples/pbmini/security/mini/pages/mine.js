module.exports = { auth: "user", queries: { mine: { collection: "mine", filter: "id != ''", sort: ["-created"] } }, get: (ctx) => ctx.json(ctx.find("mine")) };
