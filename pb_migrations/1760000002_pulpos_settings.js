/// <reference path="../pb_data/types.d.ts" />
// Ajustes de instancia para operar como servicio multi-negocio (editable luego desde el panel de PocketBase).
migrate((app) => {
  const s = app.settings();
  // Límite de peticiones por IP. Detrás de un proxy/CDN configura "trusted proxy" en Ajustes para que cuente la IP real.
  s.rateLimits.enabled = true;
  s.rateLimits.rules = [
    { label: '*:auth', audience: '', duration: 60, maxRequests: 60 },        // intentos de login
    { label: '/api/tpv/signup', audience: '', duration: 3600, maxRequests: 20 }, // altas de negocio
    { label: 'POST /api/shop/orders', audience: '', duration: 3600, maxRequests: 30 }, // pedidos de la tienda pública (por IP)
    { label: '/api/', audience: '', duration: 60, maxRequests: 1200 },        // resto de la API
  ];
  app.save(s);
}, (app) => {
  const s = app.settings();
  s.rateLimits.enabled = false;
  app.save(s);
});
