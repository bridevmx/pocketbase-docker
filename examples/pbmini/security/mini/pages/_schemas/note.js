// Esquema reutilizable de cuerpo
module.exports = { title: { type: "string", max: 50, required: true }, level: { enum: ["a", "b"], default: "a" } };
