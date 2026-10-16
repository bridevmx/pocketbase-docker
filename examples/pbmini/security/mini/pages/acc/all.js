module.exports = { auth: "user", access: { all: [{ role: "editor" }, { plan: "pro" }] }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
