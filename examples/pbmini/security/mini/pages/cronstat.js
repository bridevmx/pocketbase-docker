// FIXTURE: lee el contador de la tarea programada
module.exports = { auth: "public", get: (ctx) => ctx.json({ n: Number($app.store().get("t:cron")) || 0 }) };
