module.exports = { auth: "user", get: (ctx) => ctx.json({ can: ctx.can("posts.write"), editor: ctx.hasRole("editor"), m: ctx.membership() }) };
