// SECRET-PAGE-LEAK: archivos con _ o . nunca son rutas
module.exports = { auth: "public", get: (ctx) => ctx.text("SECRET-PAGE-LEAK") };
