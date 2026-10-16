module.exports = { auth: "public", query: { name: { type: "string", max: 50 } }, get: (ctx) => ctx.view("home", { name: ctx.query.name }) };
