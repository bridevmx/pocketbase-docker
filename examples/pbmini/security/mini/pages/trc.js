// FIXTURE: cuenta ejecuciones con $app.store() (no es código de aplicación)
const hits = () => { const s = $app.store(); const n = (s.get("t:trhits") || 0) + 1; s.set("t:trhits", n); return n; };
module.exports = { auth: "public", cache: { maxAge: 60, server: true }, get: (ctx) => ctx.json({ locale: ctx.locale, title: ctx.t("title"), hits: hits() }) };
