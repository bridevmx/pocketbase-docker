module.exports = { auth: "user", access: { permission: "billing.view" }, get: (ctx) => ctx.json({ ok: true, can: ctx.can("posts.write") }) };
