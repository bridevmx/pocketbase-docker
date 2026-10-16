// Configuración del sandbox del laboratorio: módulos opcionales ACTIVADOS (en un proyecto real están apagados por defecto)
module.exports = {
  access: {
    enabled: true, mode: "membership", collection: "users", roles: ["editor", "admin", "viewer"], rolesField: "roles",
    permissions: { editor: ["posts.write"], admin: ["*"], viewer: ["posts.read"] }, extraPermissions: ["billing.view"], permissionsField: "perms",
    planField: "plan", planOrder: ["free", "pro", "team"], expiresField: "plan_expires", grace: 2, statusField: "status",
  },
  sessions: { enabled: true, legacy: "allow" },
  mail: { maxPerRecipientPerHour: 3, maxPerHour: 50 },
};
