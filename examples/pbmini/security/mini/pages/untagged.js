const hits = () => { const s = $app.store(); const n = (s.get("t:unhits") || 0) + 1; s.set("t:unhits", n); return n; };
module.exports = { auth: "public", cache: { maxAge: 60, server: true }, get: (ctx) => ctx.json({ hits: hits() }) };
