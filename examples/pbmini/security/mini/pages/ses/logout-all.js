module.exports = { auth: "user", post: (ctx) => { ctx.logoutEverywhere(); return ctx.json({ ok: true }); } };
