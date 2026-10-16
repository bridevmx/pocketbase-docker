// Esquema reutilizable de paginación (query)
module.exports = { page: { type: "int", min: 1, max: 100, default: 1 }, size: { type: "int", min: 1, max: 50, default: 10 } };
