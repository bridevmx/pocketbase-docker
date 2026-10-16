module.exports = { auth: "public", bodyLimit: 1024, post: (ctx) => ctx.json({ posted: true }) };
