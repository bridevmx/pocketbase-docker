module.exports = { auth: "public", get(c) { return { path: c.params.path }; } };
