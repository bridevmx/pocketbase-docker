// FIXTURE: observa el tamaño del store de caché.
module.exports = { auth: "public", get: (ctx) => ctx.json({ n: $app.store().length() }) };
