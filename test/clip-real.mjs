#!/usr/bin/env node
// PRUEBA REAL con Clip (cobra dinero de verdad: un pedido de $1.00) usando ESTA máquina y un túnel de cloudflared.
//   1. copia test/.env.example a test/.env y pon tus credenciales
//   2. node test/clip-real.mjs   (con --browser abre el checkout de Clip en Chromium con Playwright)
// Levanta PocketBase (datos en test/.data/, fuera de git), abre el túnel, crea el pedido y te da el link de pago.
// Cuando pagues, espera el webhook y confirma que el pedido quedó cobrado. Ctrl+C para salir.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedStore, orderBody } from './lib-clip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'test', '.data');
const PORT = Number(process.env.PB_PORT || 8190);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error('✘ ' + m); process.exit(1); };

// ── test/.env (KEY=VALOR, sin comillas obligatorias)
const envFile = path.join(root, 'test', '.env');
if (!fs.existsSync(envFile)) die(`Falta ${envFile}. Copia test/.env.example a test/.env y llénalo.`);
const cfg = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !line.trim().startsWith('#')) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!cfg.CLIP_API_TOKEN && !(cfg.CLIP_API_KEY && cfg.CLIP_API_SECRET)) die('Pon CLIP_API_TOKEN (o CLIP_API_KEY y CLIP_API_SECRET) en test/.env');
const PB_BIN = cfg.PB_BIN || process.env.PB_BIN || 'pocketbase';
const CLOUDFLARED = cfg.CLOUDFLARED_BIN || 'cloudflared';
if (spawnSync(PB_BIN, ['--version']).error) die(`No encuentro PocketBase (${PB_BIN}). Define PB_BIN en test/.env`);
if (spawnSync(CLOUDFLARED, ['--version']).error) die(`No encuentro cloudflared (${CLOUDFLARED}). Define CLOUDFLARED_BIN en test/.env`);

fs.mkdirSync(dataRoot, { recursive: true });
const state = path.join(dataRoot, 'instance.json');
const inst = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : { suEmail: 'admin@clip.test', suPass: crypto.randomBytes(12).toString('hex'), webhookToken: crypto.randomBytes(24).toString('base64url') };
fs.writeFileSync(state, JSON.stringify(inst));
const children = [];
const stop = () => children.forEach((c) => { try { c.kill(); } catch {} });
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('exit', stop);

// ── 1. túnel: la URL pública hay que saberla ANTES de arrancar PocketBase (va en el webhook)
console.log('→ abriendo túnel de cloudflared…');
// --config con un archivo vacío: un ~/.cloudflared/config.yml con "ingress" ignoraría --url y mandaría el tráfico a otra app
const emptyCfg = path.join(dataRoot, 'cloudflared-empty.yml'); fs.writeFileSync(emptyCfg, '# vacio a proposito' + String.fromCharCode(10));
const tun = spawn(CLOUDFLARED, ['tunnel', '--config', emptyCfg, '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(tun);
const publicUrl = await new Promise((resolve) => {
  const t = setTimeout(() => die('cloudflared no dio una URL en 40 s'), 40000);
  const on = (b) => { const m = String(b).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { clearTimeout(t); resolve(m[0]); } };
  tun.stdout.on('data', on); tun.stderr.on('data', on);
});
console.log('  URL pública:', publicUrl);

// ── 2. PocketBase con el entorno real
const dirs = [`--dir=${dataRoot}/pb_data`, `--migrationsDir=${root}/pb_migrations`];
const env = { ...process.env, ...cfg, PAYMENT_LINKS_WEBHOOK_TOKEN: inst.webhookToken, PAYMENT_LINKS_PUBLIC_URL: publicUrl };
spawnSync(PB_BIN, ['migrate', 'up', ...dirs], { stdio: 'ignore' });
spawnSync(PB_BIN, ['superuser', 'upsert', inst.suEmail, inst.suPass, ...dirs], { stdio: 'ignore' });
const log = fs.openSync(path.join(dataRoot, 'pb.log'), 'a');
const pb = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PORT}`, ...dirs, `--hooksDir=${root}/pb_hooks`], { env, stdio: ['ignore', log, log] });
children.push(pb);
const local = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(local + '/api/health')).ok) break; } catch {} await sleep(500); }
let up = false;
for (let i = 0; i < 30 && !up; i++) { try { up = (await fetch(publicUrl + '/api/health')).ok; } catch {} if (!up) await sleep(2000); } // el DNS del túnel tarda unos segundos
if (!up) die('El túnel no llega a PocketBase (revisa cloudflared)');
console.log('  PocketBase listo (log: test/.data/pb.log)');

// ── 3. tienda de prueba y pedido de $1.00
const { product, SU, api } = await seedStore(local, { suEmail: inst.suEmail, suPass: inst.suPass });
const cfgShop = (await api('GET', '/api/shop/config')).data;
if (!cfgShop.payment_ways?.some((w) => w.way === 'clip')) die('La tienda no ofrece Clip: faltan credenciales o variables (mira test/.data/pb.log)');
const r = await api('POST', '/api/shop/orders', { body: orderBody(product) });
if (r.status !== 200 || !r.data.payment_url) die(`No se creó el link de pago: ${JSON.stringify(r.data)}`);
const order = r.data;
console.log(`\n✔ Pedido ${order.friendly_id} por $${order.total} creado.\n`);
console.log('  PAGA AQUÍ (se cobrará $1.00 REAL):\n  ' + order.payment_url + '\n');
console.log('  Esperando el pago (hasta 20 min)…');
let browser = null;
if (process.argv.includes('--browser')) {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: false }) // tu Chrome instalado (PW_CHANNEL=msedge para Edge);
    const page = await browser.newPage();
    await page.goto(order.payment_url);
    console.log('  Chromium abierto en el checkout de Clip: captura tu tarjeta ahí (el script no ingresa datos de tarjeta).');
  } catch (err) { console.log('  (no se pudo abrir Playwright: ' + err.message + ')'); }
}

// ── 4. esperar el cobro (llega por webhook; el cron/retorno son respaldo)
const check = async () => (await api('GET', `/api/collections/orders/records/${order.id}`, { token: SU })).data;
let done = false;
for (let i = 0; i < 400 && !done; i++) {
  await sleep(3000);
  const o = await check();
  if (o.payment_status === 'completed') done = true;
}
if (browser) await browser.close().catch(() => {});
if (!done) { console.log('✘ No se confirmó el pago a tiempo. El link sigue vigente; el conciliador lo revisa cada 5 min.'); process.exit(2); }
const pays = (await api('GET', `/api/collections/order_payments/records?filter=${encodeURIComponent(`order="${order.id}"`)}`, { token: SU })).data.items;
const link = (await api('GET', `/api/collections/payment_links/records?filter=${encodeURIComponent(`metadata.order="${order.id}"`)}`, { token: SU })).data.items[0];
console.log(`\n✔ PAGO CONFIRMADO. Recibo Clip: ${link?.receipt_no} · cobros registrados: ${pays.length} (${pays.map((p) => `${p.method} $${p.total}`).join(', ')})`);
console.log(pays.length === 1 && link?.status === 'paid' ? '✔ Todo correcto.' : '✘ Revisa: se esperaba 1 cobro y link en estado paid.');
process.exit(0);
