module.exports = { schedule: "@hourly", run(app) { throw new Error("la tarea falla a propósito"); } };
