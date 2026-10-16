module.exports = { auth: "user", post: (ctx) => { ctx.logout(); return ctx.json({ ok: true }); }, get: (ctx) => { ctx.logout(); return ctx.json({ ok: true }); } };
