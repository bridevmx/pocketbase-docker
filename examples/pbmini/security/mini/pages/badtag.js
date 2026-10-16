const hits = () => { const s = $app.store(); const n = (s.get("t:badtag") || 0) + 1; s.set("t:badtag", n); return n; };
module.exports = { auth: "public", cache: { maxAge: 60, server: true, tags: ["no_existe_xyz"] }, get: (ctx) => ctx.json({ hits: hits() }) };
