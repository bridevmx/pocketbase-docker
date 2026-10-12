// Mini-DSL para describir el schema de PocketBase.
// Convenciones (ver docs/pulpos-schema.md):
//  - nombres de colección y campos en snake_case en inglés
//  - dinero/cantidades: `number` (float64); redondeo y validación en los hooks
//  - NO hay campos json: las listas/arreglos son colecciones referenciadas
//  - bool y number nunca son `required` (PocketBase exige true / != 0)

export const text = (name, o = {}) => ({ k: 'text', name, ...o });
export const num = (name, o = {}) => ({ k: 'number', name, ...o });
export const bool = (name, o = {}) => ({ k: 'bool', name, ...o });
export const date = (name, o = {}) => ({ k: 'date', name, ...o });
export const sel = (name, values, o = {}) => ({ k: 'select', name, values, ...o });
export const file = (name, o = {}) => ({ k: 'file', name, ...o });
export const email = (name, o = {}) => ({ k: 'email', name, ...o });
export const url = (name, o = {}) => ({ k: 'url', name, ...o });
// relación simple (1 registro) y múltiple (lista de registros)
export const rel = (name, to, o = {}) => ({ k: 'relation', name, to, max: 1, ...o });
export const rels = (name, to, o = {}) => ({ k: 'relation', name, to, max: 999, ...o });

export const IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const photos = (name, max = 5) => file(name, { max, size: 5242880, mime: IMG });

export const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// col(): define una colección.
//  kind: lookup | config | master | doc | system | custom
//  perms: { read:[keys]|'any', create:[...], edit:[...], delete:[...] }  (llaves de `permissions`)
//  loc:  campos de ubicación para acotar lectura a las sucursales del usuario (p.ej. 'location', 'order.location')
//  noAccount: sin campo `account` (catálogos globales)
//  soft: agrega `deleted_at` (borrado lógico)
export function col(name, def) {
  return { name, kind: 'master', soft: false, noAccount: false, fields: [], idx: [], ...def };
}
// índices: uniq('name', ['account','sku'], 'sku != "" AND deleted_at = ""')
export const uniq = (cols, where) => ({ unique: true, cols, where });
export const index = (cols, where) => ({ unique: false, cols, where });
