// FIXTURE de pruebas: usa $app a propósito para observar la caché (NO es código de aplicación; el lint no se ejecuta sobre fixtures).
const hits = () => { const s = $app.store(); const n = (s.get("t:hits") || 0) + 1; s.set("t:hits", n); return n; };
module.exports = { auth: "public", params: { id: "id" }, cache: { maxAge: 60, server: true }, get: (ctx) => ctx.json({ id: ctx.params.id, hits: hits() }) };
