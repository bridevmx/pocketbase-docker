module.exports = { auth: "public", get(ctx) { return { path: ctx.params.path }; } };
