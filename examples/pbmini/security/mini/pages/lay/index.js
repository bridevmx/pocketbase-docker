module.exports = { auth: "public", query: { t: { type: "string", max: 50, default: "T0" } }, get: (ctx) => ({ Title: ctx.query.t }) };
