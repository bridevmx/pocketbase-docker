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
  // Sesiones revocables (solo rutas de pbmini). Crea la colección interna pbmini_sessions; funciona sobre proyectos existentes.
  sessions: { enabled: false, collection: "users", legacy: "allow" },   // legacy "deny": rechaza tokens emitidos antes de activarlo
  mail: { maxPerRecipientPerHour: 5, maxPerHour: 200 },
};
