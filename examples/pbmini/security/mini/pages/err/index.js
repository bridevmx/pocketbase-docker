module.exports = { auth: "public", query: { x: { type: "bool", default: false } }, get: (ctx) => { if (ctx.query.x) throw new Error("db password is hunter2"); return { ok: 1 }; } };
