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
}

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
}
