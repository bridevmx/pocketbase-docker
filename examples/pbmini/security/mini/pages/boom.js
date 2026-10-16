module.exports = { auth: "public", get: () => { throw new Error("db password is hunter2"); } };
