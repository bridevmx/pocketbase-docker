/// <reference path="../pb_data/types.d.ts" />
// Activa el limitador NATIVO de PocketBase (Settings > Application > Rate limiting). Aplica también a las rutas de pbmini.
// Labels: tag (`*:auth`), ruta exacta ("/contacto" o "POST /contacto") o prefijo (termina en "/"). Ajusta a tu tráfico.
migrate((app) => {
  const settings = app.settings();
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: "*:auth", maxRequests: 5, duration: 20 },   // intentos de login
    { label: "*:create", maxRequests: 20, duration: 10 },
    { label: "/api/", maxRequests: 300, duration: 10 },
    { label: "/", maxRequests: 600, duration: 10 },      // resto del sitio (páginas y estáticos)
  ];
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.rateLimits.enabled = false;
  app.save(settings);
});
