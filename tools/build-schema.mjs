#!/usr/bin/env node
// Genera pb_migrations/*.js y docs/pulpos-schema.md a partir de schema/*.mjs
//   node tools/build-schema.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snake, rel, date } from '../schema/lib.mjs';
import core from '../schema/core.mjs';
import catalog from '../schema/catalog.mjs';
import inventory from '../schema/inventory.mjs';
import sales from '../schema/sales.mjs';
import purchases from '../schema/purchases.mjs';
import online from '../schema/online.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_TS = '1760000000';
const SEED_TS = '1760000001';

// ───────── 1. Normalizar definiciones ─────────
const defs = [...core, ...catalog, ...inventory, ...sales, ...purchases, ...online];

// UNA INSTANCIA = UN NEGOCIO: no existe columna `account`; el aislamiento entre negocios es el propio contenedor.
const names = new Set(defs.map((d) => d.name));
for (const d of defs) {
  const fields = [];
  fields.push(...d.fields);
  if (d.soft && !fields.some((f) => f.name === 'deleted_at')) fields.push(date('deleted_at'));
  d.fields = fields;
  for (const f of d.fields) {
    if (f.k === 'relation' && !names.has(f.to)) throw new Error(`${d.name}.${f.name} → colección inexistente ${f.to}`);
  }
}

// ───────── 2. Reglas de acceso ─────────
const AUTH = '@request.auth.id != ""';
const TEN = AUTH;
const ADMIN = '@request.auth.role = "admin"';
const can = (keys) => (keys === 'any' || !keys ? null : '(' + [ADMIN, ...keys.map((k) => `@request.auth.permissions.key ?= "${k}"`)].join(' || ') + ')');
const locOf = (fields) => (fields && fields.length ? '(' + [ADMIN, ...fields.map((f) => `@request.auth.locations.id ?= ${f}`)].join(' || ') + ')' : null);
const and = (...p) => p.filter(Boolean).join(' && ');

function rulesFor(d) {
  if (d.rules) return d.rules;
  const p = d.perms || {};
  switch (d.kind) {
    case 'lookup': return { list: AUTH, view: AUTH, create: null, update: null, delete: null };
    case 'system': return { list: null, view: null, create: null, update: null, delete: null };
    case 'config':
      return {
        list: TEN, view: TEN,
        create: and(AUTH, ADMIN),
        update: and(TEN, ADMIN),
        delete: and(TEN, ADMIN),
      };
    case 'master':
      return {
        list: and(TEN, can(p.read)), view: and(TEN, can(p.read)),
        create: and(AUTH, can(p.create)),
        update: and(TEN, can(p.edit)),
        delete: and(TEN, can(p.delete)),
      };
    case 'doc': {
      const r = and(TEN, can(p.read), locOf(d.loc));
      // las escrituras de documentos solo las hacen los hooks/rutas del servidor (transaccionales)
      return { list: r, view: r, create: null, update: null, delete: null };
    }
    default: throw new Error('kind desconocido ' + d.kind);
  }
}

// ───────── 3. Índices ─────────
function indexes(d) {
  const out = [];
  const q = (s) => '`' + s + '`';
  const used = new Set();
  const add = (i0) => {
    const i = { ...i0, cols: i0.cols.filter((c) => c !== 'account') };
    if (!i.cols.length) return; // índice solo por account: ya no aplica
    const base = `idx_${d.name}_${i.cols.join('_')}${i.where ? '_p' : ''}`.slice(0, 60);
    let n = base; let k = 2;
    while (used.has(n)) n = `${base}_${k++}`;
    used.add(n);
    out.push(`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${q(n)} ON ${q(d.name)} (${i.cols.map(q).join(', ')})${i.where ? ' WHERE ' + i.where : ''}`);
  };
  for (const i of d.idx || []) add(i);
  return out;
}

// ───────── 4. Salida: migración de schema ─────────
const spec = defs.map((d) => ({
  name: d.name,
  extend: !!d.extend,
  kind: d.kind,
  fields: d.fields,
  indexes: indexes(d),
  rules: rulesFor(d),
  // no entra quien fue dado de baja (el estado de la licencia se revisa en el hook de auth)
  authRule: d.name === 'users' ? 'deleted_at = ""' : undefined,
}));

const PRELUDE = String.raw`
  const SPEC = __SPEC__;

  const opt = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
  const scalar = (f) => {
    switch (f.k) {
      case 'text': return new TextField(opt({ name: f.name, required: !!f.required, min: f.min, max: f.max, pattern: f.pattern, hidden: !!f.hidden }));
      case 'number': return new NumberField(opt({ name: f.name, min: f.min, max: f.max, onlyInt: !!f.onlyInt }));
      case 'bool': return new BoolField({ name: f.name });
      case 'date': return new DateField({ name: f.name, required: !!f.required });
      case 'select': return new SelectField({ name: f.name, values: f.values, maxSelect: 1, required: !!f.required });
      case 'file': return new FileField(opt({ name: f.name, maxSelect: f.max, maxSize: f.size, mimeTypes: f.mime, required: !!f.required }));
      case 'email': return new EmailField({ name: f.name });
      case 'url': return new URLField({ name: f.name });
      default: throw new Error('campo desconocido ' + f.k);
    }
  };
  const relation = (f) => new RelationField({
    name: f.name,
    collectionId: app.findCollectionByNameOrId(f.to).id,
    maxSelect: f.max,
    cascadeDelete: !!f.cascade,
    required: !!f.required,
  });

  // Pasada 1: crear colecciones con campos escalares (permite relaciones circulares)
  for (const c of SPEC) {
    let col;
    if (c.extend) {
      col = app.findCollectionByNameOrId(c.name);
    } else {
      col = new Collection({ type: 'base', name: c.name });
    }
    for (const f of c.fields) if (f.k !== 'relation') col.fields.add(scalar(f));
    if (!c.extend) {
      col.fields.add(new AutodateField({ name: 'created', onCreate: true }));
      col.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
    }
    app.save(col);
  }

  // Pasada 2: relaciones, índices y reglas
  for (const c of SPEC) {
    const col = app.findCollectionByNameOrId(c.name);
    for (const f of c.fields) if (f.k === 'relation') col.fields.add(relation(f));
    col.indexes = c.indexes;
    col.listRule = c.rules.list;
    col.viewRule = c.rules.view;
    col.createRule = c.rules.create;
    col.updateRule = c.rules.update;
    col.deleteRule = c.rules.delete;
    if (c.authRule !== undefined) col.authRule = c.authRule;
    app.save(col);
  }
`;

const PRELUDE_DOWN = String.raw`
  const SPEC = __SPEC__;
  // 1) quitar todas las relaciones y reglas para poder borrar sin referencias cruzadas
  for (const c of SPEC) {
    const col = app.findCollectionByNameOrId(c.name);
    if (c.extend) { // users: reglas por defecto de PocketBase
      col.listRule = 'id = @request.auth.id'; col.viewRule = 'id = @request.auth.id';
      col.createRule = ''; col.updateRule = 'id = @request.auth.id'; col.deleteRule = 'id = @request.auth.id';
      col.authRule = '';
    } else {
      col.listRule = null; col.viewRule = null; col.createRule = null; col.updateRule = null; col.deleteRule = null;
    }
    for (const f of c.fields) if (f.k === 'relation' && col.fields.getByName(f.name)) col.fields.removeByName(f.name);
    col.indexes = [];
    app.save(col);
  }
  // 2) borrar (o quitar los campos agregados a colecciones existentes)
  for (const c of [...SPEC].reverse()) {
    const col = app.findCollectionByNameOrId(c.name);
    if (c.extend) {
      for (const f of c.fields) if (col.fields.getByName(f.name)) col.fields.removeByName(f.name);
      app.save(col);
    } else {
      app.delete(col);
    }
  }
`;

const specJs = '[\n' + spec.map((c) => '  ' + JSON.stringify(c)).join(',\n') + '\n  ]';
const header = `/// <reference path="../pb_data/types.d.ts" />
// AUTO-GENERADO por tools/build-schema.mjs a partir de schema/*.mjs — NO editar a mano.
`;
fs.mkdirSync(path.join(root, 'pb_migrations'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'pb_migrations', `${SCHEMA_TS}_pulpos_schema.js`),
  `${header}migrate((app) => {${PRELUDE.replace('__SPEC__', specJs)}}, (app) => {${PRELUDE_DOWN.replace('__SPEC__', specJs)}});\n`,
);

// ───────── 5. Semillas ─────────
const UNITS = [
  ['unit', 'Unidad', 'Unidades', 'u'], ['kit', 'Kit', 'Kits', 'kit'], ['box', 'Caja', 'Cajas', 'caja'], ['bag', 'Bolsa', 'Bolsas', 'bolsa'],
  ['meter', 'Metro', 'Metros', 'm'], ['centimeter', 'Centímetro', 'Centímetros', 'cm'], ['kilogram', 'Kilogramo', 'Kilogramos', 'kg'],
  ['gram', 'Gramo', 'Gramos', 'g'], ['liter', 'Litro', 'Litros', 'L'], ['milliliter', 'Mililitro', 'Mililitros', 'mL'],
  ['service', 'Servicio', 'Servicios', 'serv.'], ['square_meter', 'Metro cuadrado', 'Metros cuadrados', 'm²'], ['piece', 'Pieza', 'Piezas', 'pieza'],
];
// Impuestos globales observados en Pulpos (tipo, %, exento, retenido)
const TAXES = [
  ['isr', 10, 0, 1], ['isr', 1.25, 0, 1], ['ieps', 160, 0, 0], ['ieps', 53, 0, 0], ['ieps', 50, 0, 0], ['ieps', 30.4, 0, 0], ['ieps', 30, 0, 0],
  ['ieps', 26.5, 0, 0], ['ieps', 25, 0, 0], ['ieps', 9, 0, 0], ['ieps', 8, 0, 0], ['ieps', 7, 0, 0], ['ieps', 6, 0, 0], ['ieps', 3, 0, 0],
  ['ieps', 0, 0, 0], ['vat', 16, 0, 0], ['vat', 10.6667, 0, 1], ['vat', 8, 0, 0], ['vat', 5.3333, 0, 1], ['vat', 0, 0, 0], ['vat', 0, 1, 0],
].map(([type, percentage, ex, wh]) => ({
  type, percentage, is_exempt: !!ex, is_withheld: !!wh,
  name: `${type.toUpperCase()} ${ex ? 'Exento' : percentage + '%'}${wh ? ' (retenido)' : ''}`,
}));

// Permisos finos (matriz de Pulpos) — sin facturación, WhatsApp, IA ni conciliación
const permSrc = JSON.parse(fs.readFileSync(path.join(root, 'docs/pulpos-data/permissions.json'), 'utf8'));
const SKIP = new Set(['INVOICE', 'RECONCILIATION', 'WHATSAPP', 'AI_AGENTS']);
const PERMS = [];
for (const [group, items] of Object.entries(permSrc)) {
  if (SKIP.has(group)) continue;
  for (const it of items) {
    PERMS.push({ group, key: `${it.subject.toLowerCase()}.${snake(it.action)}`, subject: it.subject.toLowerCase(), action: snake(it.action), reqNames: it.requires });
  }
}
for (const p of PERMS) {
  const dep = (name) => PERMS.find((x) => x.group === p.group && snake(x.action) === snake(name) && x !== p);
  p.requires = p.reqNames.map((n) => dep(n)?.key).filter(Boolean);
}
const permsData = PERMS.map(({ key, subject, action, requires }) => ({ key, subject, action, requires }));

const seed = { UNITS, TAXES, PERMS: permsData };
fs.writeFileSync(
  path.join(root, 'pb_migrations', `${SEED_TS}_pulpos_seed.js`),
  `${header}migrate((app) => {
  const SEED = ${JSON.stringify(seed, null, 1)};

  const units = app.findCollectionByNameOrId('measure_units');
  for (const [key, singular, plural, abbr] of SEED.UNITS) {
    const r = new Record(units);
    r.set('key', key); r.set('name_singular', singular); r.set('name_plural', plural); r.set('abbreviation', abbr);
    app.save(r);
  }

  const taxes = app.findCollectionByNameOrId('taxes');
  for (const t of SEED.TAXES) {
    const r = new Record(taxes);
    r.set('type', t.type); r.set('name', t.name); r.set('percentage', t.percentage);
    r.set('is_exempt', t.is_exempt); r.set('is_withheld', t.is_withheld);
    app.save(r);
  }

  const perms = app.findCollectionByNameOrId('permissions');
  const byKey = {};
  for (const p of SEED.PERMS) {
    const r = new Record(perms);
    r.set('key', p.key); r.set('subject', p.subject); r.set('action', p.action);
    app.save(r); byKey[p.key] = r.id;
  }
  for (const p of SEED.PERMS) {
    if (!p.requires.length) continue;
    const r = app.findRecordById('permissions', byKey[p.key]);
    r.set('requires', p.requires.map((k) => byKey[k]));
    app.save(r);
  }
}, (app) => {
  for (const name of ['permissions', 'taxes', 'measure_units']) {
    app.db().newQuery('DELETE FROM ' + name).execute();
  }
});
`,
);

// ───────── 6. Documentación generada ─────────
const md = [];
md.push('# Schema de PocketBase (generado)\n');
md.push(`Generado por \`tools/build-schema.mjs\` desde \`schema/*.mjs\`. **${defs.length} colecciones**, sin campos \`json\`.\n`);
md.push('Tipos: `text` `number` `bool` `date` `select(...)` `file` `rel→colección` (`[]` = relación múltiple). `deleted_at` = borrado lógico.\n');
const kindLabel = { lookup: 'catálogo global (solo lectura)', system: 'solo servidor', config: 'configuración (admin escribe)', master: 'datos maestros (permiso fino)', doc: 'documento/libro (solo servidor escribe)', custom: 'reglas propias' };
for (const d of defs) {
  const r = rulesFor(d);
  md.push(`## \`${d.name}\`${d.extend ? ' (extiende la colección auth `users`)' : ''}\n`);
  md.push(`*${kindLabel[d.kind]}*` + (d.perms?.read && d.perms.read !== 'any' ? ` · lectura: ${d.perms.read.map((k) => '`' + k + '`').join(', ')}` : '') + (d.loc ? ` · acotado a sucursales por \`${d.loc.join(', ')}\`` : '') + '\n');
  md.push('| campo | tipo |\n|---|---|');
  for (const f of d.fields) {
    let t = f.k;
    if (f.k === 'select') t = `select(${f.values.join('\\|')})`;
    if (f.k === 'relation') t = `rel→${f.to}${f.max > 1 ? ' []' : ''}`;
    md.push(`| \`${f.name}\`${f.required ? ' *' : ''} | ${t} |`);
  }
  const ix = indexes(d).filter((s) => !s.startsWith('CREATE INDEX') || true);
  const uniqs = (d.idx || []).filter((i) => i.unique).map((i) => `(${i.cols.join(', ')})${i.where ? ' donde ' + i.where : ''}`);
  if (uniqs.length) md.push(`\nÚnicos: ${uniqs.join('; ')}`);
  md.push('');
}
fs.writeFileSync(path.join(root, 'docs/pulpos-schema.md'), md.join('\n'));

console.log(`OK: ${defs.length} colecciones, ${PERMS.length} permisos, ${TAXES.length} impuestos, ${UNITS.length} unidades`);
