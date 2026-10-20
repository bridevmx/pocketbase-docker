// Plantilla de pb_hooks/pbmini.config.js (cópiala con ese nombre para activarla). TODO está apagado por defecto.
// Claves desconocidas o valores inválidos abortan el arranque. Los campos que nombres deben existir en tu colección de usuarios.
module.exports = {
  // Roles y membresías. Protege SOLO las rutas de pbmini (access: {...}); espeja las condiciones en las reglas de la colección para la API nativa.
  access: {
    enabled: false,
    mode: "membership",                 // "role" (básico: un campo con el rol) o "membership" (roles + permisos + planes + vencimiento)
    collection: "users",
    roles: ["admin", "editor"],
    // mode "role":        field: "role",
    rolesField: "roles",                // select múltiple o texto "a, b"
    permissions: { editor: ["posts.write"], admin: ["*"] },   // "*" = todos los permisos conocidos
    // permissionsField: "perms",       // permisos extra por usuario
    // extraPermissions: ["billing.view"],
    planField: "plan", planOrder: ["free", "pro", "team"],   // pro incluye free
    expiresField: "plan_expires", grace: 3,                  // días de gracia; un plan de pago sin fecha vigente cuenta como vencido
    statusField: "status",                                   // "suspended" | "banned" | "blocked" => 403
  },
  // Sesiones revocables con veto GLOBAL (pbmini y /api/*): el token lleva un sid. Crea la colección interna pbmini_sessions; funciona sobre proyectos existentes.
  sessions: { enabled: false, collection: "users", legacy: "allow", realtime: true },   // realtime: corta las conexiones SSE al revocar (PocketBase solo autentica el SSE al suscribirse)   // legacy "deny": rechaza tokens emitidos antes de activarlo
  mail: { maxPerRecipientPerHour: 5, maxPerHour: 200 },
  // Telegram: alertas a usuarios, grupos y operadores, botones con acciones seguras y login por Mini App. Secretos SOLO en variables de entorno (ver .env.example):
  // TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (>=32), TELEGRAM_WEBHOOK_URL (https), TELEGRAM_OPERATOR_CHATS, TELEGRAM_BOT_USERNAME, TELEGRAM_MINIAPP_URL.
  // Clip: pagos con links de pago. Variables (ver .env.example): CLIP_API_TOKEN ("Basic <base64 de API_KEY:SECRET>"), CLIP_WEBHOOK_TOKEN (>=32), CLIP_PUBLIC_URL (o clip.publicUrl; https, sin ruta).
  clip: {
    enabled: false, collection: "users", referencePrefix: "PBM", methods: ["credit", "debit"],
    amount: { min: 100, max: 5000000 },            // CENTAVOS enteros (mín. $1)
    webhook: { path: "/_clip/webhook", maxBytes: 2048, perIpPerMin: 120 },
    create: { perUserPerMin: 5, maxPendingPerUser: 10 }, verify: { minIntervalMs: 2000, perUserPerMin: 30 },
    reconcile: { cron: "*/2 * * * *", windowHours: 72, batch: 50, staleCreatedMinutes: 10, minAgeMinutes: 1 },
    retention: { failedDays: 90, paidDays: 0 },    // paidDays 0 = conservar los pagos confirmados (obligaciones fiscales)
    readRules: false,                              // true: el dueño ve sus pagos por la API nativa/realtime (campos internos ocultos)
  },
  telegram: {
    enabled: false, collection: "users",
    linkTtl: 600, actionTtl: 3600,                                         // segundos de vida del enlace de vinculación y de los botones de acción
    login: { enabled: false, maxAge: 600, autoprovision: false, singleUse: true, perMinute: 20 },   // Mini App: POST /_telegram/login {initData}
    groups: { /* staff: { field: "roles", values: ["admin", "editor"] } */ },   // ctx.telegramGroup("staff", {...}) llega a los vinculados con ese rol
    limits: { perChatPerMinute: 20, perHour: 3000, perUserPerHour: 30 },
    retention: { sentDays: 7, linksDays: 1 },                              // los mensajes enviados no guardan contenido; se purgan filas antiguas
  },
};
