module.exports = { auth: "user", body: { id: { type: "string", max: 40, required: true } }, post: (ctx) => ctx.json({ revoked: ctx.revokeSession(ctx.body.id) }) };
