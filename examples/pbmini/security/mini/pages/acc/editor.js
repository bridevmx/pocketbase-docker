module.exports = { auth: "user", access: { role: "editor" }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
