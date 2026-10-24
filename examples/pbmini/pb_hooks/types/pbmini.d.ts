// Tipos de pbmini para autocompletar y comprobar (checkJs) páginas, endpoints, esquemas y pbmini.config.js. No se ejecutan: solo ayudan al editor.
// Uso en un archivo de pages/:   /** @type {import("../types/pbmini").Route} */  module.exports = { ... }
// Sincronizado con el código por la prueba de deriva del laboratorio (lab/attacks_v2.py, sección D).

/** Registro de PocketBase tal como lo devuelve `publicExport()` (sin campos hidden). */
export type PublicRecord = { id: string; collectionId?: string; collectionName?: string; created?: string; updated?: string; [field: string]: unknown };

export type FieldType = "string" | "int" | "bool" | "id" | "slug" | "uuid" | "enum";
export interface FieldSpec {
  type?: FieldType;
  min?: number; max?: number;
  enum?: string[];
  pattern?: RegExp;
  required?: boolean;
  default?: string | number | boolean;
  multi?: boolean;
  allowEmpty?: boolean;
}
/** "int" | /regex/ | {type:"string", max:50} ... o el nombre de un archivo de pages/_schemas/ */
export type Field = FieldType | RegExp | FieldSpec;
export type Schema = { [name: string]: Field };

export interface QueryDef {
  collection: string;
  /** Filtro CONSTANTE de PocketBase con placeholders {:nombre}; nunca se concatena nada de la petición. */
  filter: string;
  sort?: string[];
  rule?: "list" | "view";
  maxLimit?: number;
  /** Fragmentos opcionales (cada uno con un único {:v}) que se activan con `where` en find/paginate. */
  filters?: { [name: string]: string };
}
export interface MutationDef { collection: string; op: "create" | "update" | "delete"; /** lista blanca de campos (no en delete) */ fields?: string[] }
export interface CacheDef { maxAge: number; server?: boolean; shared?: boolean; /** colecciones cuya modificación invalida la caché de servidor */ tags?: string[] }
export interface PaginateDef { perPage: number; maxPerPage: number; sort?: string[] }

/** Condición de acceso (módulo opcional access): una sola clave por objeto. */
export type Access =
  | { role: string } | { permission: string } | { plan: string }
  | { any: Access[] } | { all: Access[] };

export interface Membership { superuser: boolean; roles: string[]; permissions: string[]; plan: string | null; expired: boolean; blocked: boolean; valid: boolean }
export interface SessionInfo { id: string; ip: string; userAgent: string; created: string; lastSeen: string; current: boolean }
export interface Page { items: PublicRecord[]; page: number; perPage: number; hasMore: boolean }

/** Respuesta de pbmini (lo que devuelven ctx.json, ctx.page, ctx.redirect, ...). */
export type Reply = unknown;

export interface TxCtx {
  find(query: string, params?: Params, opt?: FindOptions): PublicRecord[];
  findOne(query: string, params?: Params, opt?: FindOptions): PublicRecord | null;
  create(mutation: string, data: Params): PublicRecord;
  update(mutation: string, id: string, data: Params): PublicRecord;
  delete(mutation: string, id: string): { id: string };
}
export type Params = { [name: string]: string | number | boolean };
export interface FindOptions { sort?: string; limit?: number; page?: number; where?: { [filter: string]: string | number | boolean | null | undefined } }

export interface Ctx {
  /** Parámetros de ruta, ya validados y tipados. */
  params: { [name: string]: any };
  /** Query string validada contra `query` (valores por defecto aplicados). */
  query: { [name: string]: any };
  /** Cuerpo validado contra `body`. */
  body: { [name: string]: any };
  /** Usuario autenticado (null si es anónimo o la ruta es cacheable). */
  user: any | null;
  /** Idioma elegido por Accept-Language (módulo i18n) o null. */
  locale: string | null;
  t(key: string, vars?: { [name: string]: string | number | boolean }): string;
  escape(s: unknown): string;
  json(data: unknown, code?: number): Reply;
  text(s: string, code?: number): Reply;
  view(name: string, data?: object, layout?: string): Reply;
  page(data?: object): Reply;
  unsafeHtml(html: string, code?: number): Reply;
  redirect(url: string, code?: number): Reply;
  file(baseDir: string, relativePath: string): Reply;
  find(query: string, params?: Params, opt?: FindOptions): PublicRecord[];
  findOne(query: string, params?: Params, opt?: FindOptions): PublicRecord | null;
  paginate(query: string, params?: Params, opt?: { where?: FindOptions["where"] }): Page;
  create(mutation: string, data: Params): PublicRecord;
  update(mutation: string, id: string, data: Params): PublicRecord;
  delete(mutation: string, id: string): { id: string };
  tx<T>(fn: (tx: TxCtx) => T): T;
  notFound(): Reply;
  forbidden(): Reply;
  can(permission: string): boolean;
  hasRole(role: string): boolean;
  membership(): Membership | null;
  mail(template: string, opt: { to: string; data?: object }): boolean;
  logout(): void;
  logoutEverywhere(): void;
  sessions(): SessionInfo[];
  revokeSession(id: string): boolean;
  /** Telegram (módulo opcional; solo rutas no públicas y no GET). destino: "me" o el id de un usuario. */
  telegram(target: "me" | string, msg: TelegramMessage): { status: "sent" | "queued" | "duplicate" | "not_linked" | "blocked" | "failed" };
  /** Un aviso a todos los usuarios vinculados de un grupo definido en telegram.groups (se encola y el cron lo reparte con ritmo). */
  telegramGroup(group: string, msg: TelegramMessage, opt?: { key?: string }): { queued: number; skipped: number; members: number };
  /** Alerta a los chats de TELEGRAM_OPERATOR_CHATS. */
  telegramAlert(msg: TelegramMessage, opt?: { key?: string }): { queued: number };
  /** Enlace de un solo uso para vincular el Telegram del usuario autenticado. */
  telegramLink(): { url: string; expires: string };
  /** Envío simple a los canales habilitados (hoy Telegram). { user: "me" } = usuario autenticado. No en GET ni en rutas públicas. */
  notify(to: NotifyTarget, msg: string | TelegramMessage, opt?: { key?: string }): { telegram?: any };
  /** Consultas rápidas de UNA vuelta a Google AI Studio (Gemini/Gemma, capa gratuita). No es un chat. No en GET ni en rutas públicas; requiere usuario autenticado. */
  ai: {
    /** Extrae campos tipados de un texto o imagen. Cada campo se valida (null si falta o es inválido); lo no declarado se descarta. 502 si fallan el modelo principal y el de respaldo. */
    extract(opts: { instruction: string; fields: { [name: string]: AiField }; text?: string; image?: { mime: "image/png" | "image/jpeg" | "image/webp"; base64: string } }): { values: { [name: string]: string | number | boolean | null }; model: string };
    /** Texto libre del modelo (DATO NO CONFIABLE: valídalo). */
    ask(opts: { instruction: string; text?: string; image?: { mime: "image/png" | "image/jpeg" | "image/webp"; base64: string } }): { text: string; model: string };
  };
  /** Pagos por transferencia SPEI validados contra el CEP de Banxico (módulo opcional). No en GET ni en rutas públicas; requiere sesión de la colección de usuarios. */
  spei: {
    /** Crea la orden con la cuenta ASIGNADA (de otro banco que el del cliente si es posible). `amount` en CENTAVOS enteros calculados en el SERVIDOR; el cliente nunca elige la cuenta. */
    createOrder(opts: { amount: number; description: string; subject: { kind: string; id: string }; customerBank?: string; idemKey?: string }): SpeiOrder & { manualReview: boolean };
    /** El cliente reporta su transferencia. Idempotente. Banxico decide: solo se paga con cuenta, monto exacto, fecha posterior a la orden y clave sin usar; cualquier anomalía va a `review`. */
    report(id: string, input: { tracking: string; emisor?: string; date?: string }): SpeiOrder;
    /** Lee un comprobante (PNG/JPEG/WebP en base64) con el modelo de visión y devuelve lo leído sin cambiar la orden. La imagen no se guarda. */
    readReceipt(id: string, imageBase64: string): { reading: { tracking: string | null; amountCents: number | null; date: string | null; emisor: string | null; bankName: string | null; confidence: number }; warnings: string[]; input: { tracking: string; emisor: string; date?: string } | null; ready: boolean };
    /** Lee el comprobante y, solo si todo es legible y el monto coincide, lo reporta. Si no, devuelve lo leído para que el cliente lo complete. */
    reportFromReceipt(id: string, imageBase64: string): { auto: boolean; reading: any; warnings: string[]; order: SpeiOrder };
    get(id: string): SpeiOrder;
    list(query: { subjectKind: string; subjectId: string }): SpeiOrder[];
  };
  /** Pagos con links de Clip (módulo opcional). No en GET ni en rutas públicas; requiere sesión de la colección de usuarios. */
  clip: {
    /** Crea el pago y el link en Clip. `amount` en CENTAVOS enteros calculados en el SERVIDOR (nunca del cliente); `urls` solo rutas relativas; `idemKey` repite el mismo pago. */
    createPayment(opts: ClipPaymentOptions): ClipPayment;
    /** Pregunta a Clip (con intervalo mínimo) y devuelve el pago ACTUALIZADO. Solo el dueño o un superusuario; el resto recibe 404. Se puede usar desde rutas GET. */
    verify(id: string): ClipPaymentView;
    /** Lee un pago propio (sin datos internos). */
    get(id: string): ClipPaymentView;
    /** Pagos propios de un sujeto, del más nuevo al más viejo. */
    list(query: { subjectKind: string; subjectId: string }): ClipPaymentView[];
    /** Reembolso TOTAL: pide primero el reembolso a Clip y solo si lo aprueba pasa a `refunded`. Solo rutas `auth: "superuser"` y no desde GET (mueve dinero). */
    refund(id: string): { status: ClipStatus; changed: boolean; payment?: ClipPaymentView };
  };
}

export interface AiField { type: "string" | "number" | "boolean" | "enum"; desc: string; max?: number; min?: number; values?: string[] }
export type SpeiStatus = "awaiting" | "checking" | "paid" | "review" | "failed" | "expired";
export interface SpeiOrder { id: string; status: SpeiStatus; amount: number; baseAmount: number; currency: "MXN"; description: string; subject: { kind: string; id: string }; account: { number: string; kind: "clabe" | "card"; holder: string; label: string; bankCode: string } | null; reports: number; expiresAt: string; paidAt: string; created: string }

export interface ClipPaymentOptions { amount: number; description: string; subject: { kind: string; id: string }; urls: { success: string; error: string; default: string }; idemKey?: string }
export type ClipStatus = "created" | "pending" | "paid" | "failed" | "expired" | "review" | "refunded";
export interface ClipPaymentView { id: string; reference: string; status: ClipStatus; amount: number; currency: "MXN"; description: string; subject: { kind: string; id: string }; url: string; receiptNo: string; paidAt: string; expiresAt: string; created: string }
export interface ClipPayment { id: string; reference: string; url: string; status: ClipStatus; amount: number; currency: "MXN" }

/** Destino de notify: un usuario (id o "me"), un grupo de telegram.groups, o los operadores. */
export type NotifyTarget = { user: string } | { group: string } | { ops: true };

export type TelegramButton = { text: string } & ({ action: string; args?: object } | { url: string } | { webApp: true });
/** El texto se escapa siempre (no admite HTML). key = idempotencia: la misma key no se envía dos veces. */
export interface TelegramMessage { text: string; title?: string; buttons?: TelegramButton[][]; silent?: boolean; protect?: boolean; key?: string }
/** Acción de botón: pb_hooks/telegram/actions/<nombre>.js */
export interface TelegramAction { run(app: any, ctx: { user: any; args: any }): string | void }

type Handler = (ctx: Ctx) => Reply | object | void;

/** Lo que exporta un archivo de pages/. Las claves desconocidas abortan el arranque. */
export interface Route {
  auth: "public" | "user" | "superuser";
  access?: Access;
  params?: Schema | string;
  query?: Schema | string;
  body?: Schema | string;
  queries?: { [name: string]: QueryDef };
  cache?: CacheDef;
  paginate?: PaginateDef;
  mutations?: { [name: string]: MutationDef };
  bodyLimit?: number;
  unknownQuery?: "ignore";
  get?: Handler;
  post?: Handler;
  put?: Handler;
  patch?: Handler;
  delete?: Handler;
}

/** Tarea programada: pb_hooks/cron/<id>.js */
export interface CronJob { schedule: string; run(app: any): void }

/** pb_hooks/pbmini.config.js (todo apagado por defecto). */
export interface Config {
  access?: { enabled: boolean; mode: "role" | "membership"; collection?: string; roles: string[]; field?: string; rolesField?: string;
    permissions?: { [role: string]: string[] }; permissionsField?: string; extraPermissions?: string[];
    planField?: string; planOrder?: string[]; expiresField?: string; grace?: number; statusField?: string; blockedStatuses?: string[] };
  sessions?: { enabled: boolean; collection?: string; legacy?: "allow" | "deny"; realtime?: boolean };
  mail?: { maxPerRecipientPerHour?: number; maxPerHour?: number };
  telegram?: { enabled: boolean; collection?: string; linkTtl?: number; actionTtl?: number;
    login?: { enabled?: boolean; maxAge?: number; autoprovision?: boolean; singleUse?: boolean; perMinute?: number };
    groups?: { [name: string]: { field: string; values: string[] } };
    limits?: { perChatPerMinute?: number; perHour?: number; perUserPerHour?: number };
    retention?: { sentDays?: number; linksDays?: number } };
  ai?: { enabled: boolean; timeoutSeconds?: number; perMinute?: number; perUserPerMin?: number; maxOutputTokens?: number; maxInputChars?: number; maxImageKB?: number };
  spei?: { enabled: boolean; collection?: string; accountsFile?: string; amount?: { min?: number; max?: number }; orderTtlHours?: number; report?: { perUserPerMin?: number; maxReportsPerOrder?: number; maxPendingPerUser?: number };
    banxico?: { timeoutSeconds?: number; minIntervalMs?: number; perMinute?: number }; reconcile?: { cron?: string; batch?: number; maxTries?: number; retryMinutes?: number };
    vision?: { enabled?: boolean; provider?: "omnirouter" | "google"; maxKB?: number; timeoutSeconds?: number; perUserPerMin?: number; maxPerOrder?: number; minConfidence?: number };
    retention?: { failedDays?: number; paidDays?: number }; readRules?: boolean; uniqueCents?: { enabled?: boolean; max?: number } };
  clip?: { enabled: boolean; collection?: string; publicUrl?: string; referencePrefix?: string; methods?: ("credit" | "debit" | "cash")[]; openOnCardForm?: boolean;
    amount?: { min?: number; max?: number }; descriptionMax?: number; timeoutSeconds?: number; expiresInMinutes?: number | null; installmentsMsi?: number[] | null; international?: boolean;
    webhook?: { path?: string; maxBytes?: number; perIpPerMin?: number }; create?: { perUserPerMin?: number; maxPendingPerUser?: number }; verify?: { minIntervalMs?: number; perUserPerMin?: number };
    reconcile?: { cron?: string; windowHours?: number; batch?: number; staleCreatedMinutes?: number; minAgeMinutes?: number };
    retention?: { failedDays?: number; paidDays?: number }; readRules?: boolean };
}
