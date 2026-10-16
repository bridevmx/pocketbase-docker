module.exports = { auth: "public", cache: { maxAge: 300 }, get: (ctx) => ctx.file("pb_public", ctx.params.path) };
