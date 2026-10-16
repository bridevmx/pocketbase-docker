module.exports = { auth: "user", get: (ctx) => ctx.json({ sessions: ctx.sessions() }) };
