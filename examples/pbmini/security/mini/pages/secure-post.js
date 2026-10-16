module.exports = { auth: "user", post: (ctx) => ctx.json({ ok: true, id: ctx.user.id }) };
