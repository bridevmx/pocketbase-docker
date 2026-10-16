module.exports = { auth: "user", access: { plan: "pro" }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
