// FIXTURE (superusuario): lista las conexiones realtime registradas y sus etiquetas (usa $app a propósito; no es código de aplicación)
module.exports = {
  auth: "superuser",
  get: (ctx) => {
    const out = [], cl = $app.subscriptionsBroker().clients();
    for (const id in cl) { const c = cl[id]; let a = null; try { const r = c.get("auth"); a = r ? r.id : null; } catch (_) {} out.push({ auth: a, sid: c.get("pbmini_sid") || null, rid: c.get("pbmini_rid") || null, subs: Object.keys(c.subscriptions()) }); }
    return ctx.json(out);
  },
};
