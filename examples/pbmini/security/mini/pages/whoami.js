module.exports = { auth: "user", get: (c) => c.json({ id: c.auth.id }) };
