module.exports = { auth: "user", access: { plan: "team" }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
