// Endpoint sin .html (equivalente a +server.js): el objeto devuelto se responde como JSON. GET /healthz
module.exports = { auth: "public", get: () => ({ ok: true }) };
