module.exports = { auth: "user", access: { permission: "posts.write" }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
