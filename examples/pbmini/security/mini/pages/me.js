module.exports = { auth: "user", get: (ctx) => ctx.json({ id: ctx.user.id }) };
