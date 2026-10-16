// Lista las claves reales de ctx (la prueba de deriva las compara con types/pbmini.d.ts)
module.exports = { auth: "public", get: (ctx) => ctx.json(Object.keys(ctx).sort()) };
