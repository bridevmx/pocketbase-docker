module.exports = { auth: "user", access: { any: [{ role: "admin" }, { plan: "pro" }] }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
