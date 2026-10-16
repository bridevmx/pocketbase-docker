// SECRET-PAGE-LEAK: archivos con _ o . nunca son rutas
module.exports = { auth: "public", get: (c) => c.text("SECRET-PAGE-LEAK") };
