module.exports = { auth: "public", queries: { all: { collection: "posts", filter: "id != ''", sort: ["title"] } }, get: (ctx) => ctx.json(ctx.find("all")) };
