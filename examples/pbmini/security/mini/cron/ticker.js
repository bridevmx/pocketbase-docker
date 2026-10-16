// FIXTURE: cuenta ejecuciones en el almacén compartido
module.exports = { schedule: "*/5 * * * *", run(app) { const s = app.store(); s.set("t:cron", (Number(s.get("t:cron")) || 0) + 1); } };
