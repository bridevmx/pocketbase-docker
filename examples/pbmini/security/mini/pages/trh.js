module.exports = { auth: "public", query: { name: { type: "string", max: 60, default: "x" } }, get: (ctx) => ({ hello: ctx.t("greeting", { name: ctx.query.name }) }) };
