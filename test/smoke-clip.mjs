#!/usr/bin/env node
// Pago con Clip de la tienda en línea contra un Clip FALSO (test/mock-clip.mjs), sin dinero ni internet.
// Levanta su propio PocketBase temporal y el mock:  PB_BIN=/ruta/pocketbase.exe node test/smoke-clip.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedStore, orderBody } from './lib-clip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN || 'pocketbase';
const PB_PORT = 8108, MOCK_PORT = 8109;
const URL_ = `http://127.0.0.1:${PB_PORT}`, MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SU_EMAIL = 'admin@test.mx', SU_PASS = 'superpass-12345';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-smoke-'));
const dirs = [`--dir=${tmp}/pb_data`, `--migrationsDir=${root}/pb_migrations`];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };

const run = (cmd, args, env = {}) => new Promise((res) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); p.on('exit', res); });
await run(PB_BIN, ['migrate', 'up', ...dirs]);
await run(PB_BIN, ['superuser', 'upsert', SU_EMAIL, SU_PASS, ...dirs]);
const logFile = fs.openSync(path.join(tmp, 'pb.log'), 'w');
const env = { ...process.env, CLIP_API_URL: MOCK, CLIP_API_TOKEN: 'test', PAYMENT_LINKS_WEBHOOK_TOKEN: 'secreto-de-prueba-largo-123', PAYMENT_LINKS_PUBLIC_URL: URL_ };
const mock = spawn(process.execPath, [path.join(root, 'test/mock-clip.mjs')], { env: { ...env, MOCK_CLIP_PORT: String(MOCK_PORT) }, stdio: 'ignore' });
const pb = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PB_PORT}`, ...dirs, `--hooksDir=${root}/pb_hooks`], { env, stdio: ['ignore', logFile, logFile] });
const stop = () => { pb.kill(); mock.kill(); };
process.on('exit', stop);

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_ + '/api/health')).ok) break; } catch {} await sleep(500); }
  const { product, owner, SU, api } = await seedStore(URL_, { suEmail: SU_EMAIL, suPass: SU_PASS });
  const shop = (m, p, body) => api(m, '/api/shop' + p, { body });
  const mockPost = async (p) => (await fetch(MOCK + p, { method: 'POST' })).json();
  const orderOf = async (id) => (await api('GET', `/api/collections/orders/records/${id}`, { token: SU })).data;
  const payments = async (id) => (await api('GET', `/api/collections/order_payments/records?filter=${encodeURIComponent(`order="${id}"`)}`, { token: SU })).data.items;
  const clipId = (url) => url.split('/pay/')[1].split('/')[0];
  const waitFor = async (fn) => { for (let i = 0; i < 20; i++) { if (await fn()) return true; await sleep(250); } return false; };

  console.log('── configuración ──');
  let r = await shop('GET', '/config');
  ok(r.data.payment_ways.some((w) => w.way === 'clip'), 'la tienda ofrece Clip cuando está configurado');

  console.log('── pedido y link ──');
  const body = orderBody(product);
  r = await shop('POST', '/orders', body);
  ok(r.status === 200 && r.data.total === 1 && r.data.payment_status === 'pending', 'pedido de $1.00 creado y pendiente');
  ok(/\/pay\/[0-9a-f-]{36}/.test(r.data.payment_url || ''), 'devuelve payment_url de Clip');
  const o1 = r.data, link1 = o1.payment_url;
  r = await shop('POST', '/orders', body);
  ok(r.data.idempotent && r.data.payment_url === link1, 'reintento con el mismo request_id: mismo pedido y mismo link');
  r = await shop('GET', `/orders/${o1.friendly_id}`);
  ok(r.data.payment_url === link1, 'el seguimiento muestra el link mientras esté pendiente');
  r = await shop('POST', `/orders/${o1.friendly_id}/pay`);
  ok(r.status === 200 && r.data.payment_url === link1, '/pay reutiliza el link vigente');
  ok(code(await shop('POST', '/orders', orderBody(product, { items: [{ product: product.id, quantity: 1 }], way_of_payment: 'bank_transfer' }))) === 'payment_way_unavailable', 'forma de pago no habilitada se rechaza');

  console.log('── pago confirmado ──');
  const SU_pay = await mockPost(`/__pay/${clipId(link1)}`);
  ok(SU_pay.status === 'CHECKOUT_COMPLETED', 'el comprador paga en el Clip falso');
  ok(await waitFor(async () => (await orderOf(o1.id)).payment_status === 'completed'), 'el webhook confirma: pedido → completed');
  const pays = await payments(o1.id);
  ok(pays.length === 1 && pays[0].method === 'card' && pays[0].total === 1, 'un solo order_payments (card, $1.00)');
  r = await shop('GET', `/orders/${o1.friendly_id}`);
  ok(r.data.payment_status === 'completed' && !r.data.payment_url, 'seguimiento: pagado y sin link');
  await mockPost(`/__pay/${clipId(link1)}`); // webhook repetido
  await sleep(500);
  ok((await payments(o1.id)).length === 1, 'webhook repetido no duplica el cobro');
  ok(code(await shop('POST', `/orders/${o1.friendly_id}/pay`)) === 'order_payment_not_pending', '/pay en un pedido pagado → 409');

  console.log('── monto alterado ──');
  r = await shop('POST', '/orders', orderBody(product, { items: [{ product: product.id, quantity: 3 }] }));
  const o2 = r.data;
  await mockPost(`/__tamper/${clipId(o2.payment_url)}`);
  await sleep(800);
  ok((await orderOf(o2.id)).payment_status === 'pending' && (await payments(o2.id)).length === 0, 'pago con otro monto: el pedido sigue pendiente');

  console.log('── link fallido y reintento ──');
  r = await shop('POST', '/orders', orderBody(product));
  const o3 = r.data;
  await mockPost(`/__fail/${clipId(o3.payment_url)}`);
  await sleep(800);
  ok((await orderOf(o3.id)).payment_status === 'pending', 'link cancelado: el pedido sigue pendiente (puede reintentar)');
  r = await shop('POST', `/orders/${o3.friendly_id}/pay`);
  ok(r.status === 200 && r.data.payment_url && r.data.payment_url !== o3.payment_url, '/pay genera un link nuevo');
  await mockPost(`/__pay/${clipId(r.data.payment_url)}`);
  ok(await waitFor(async () => (await orderOf(o3.id)).payment_status === 'completed'), 'pagando el link nuevo el pedido se completa');

  console.log('── pago sin webhook (retorno del comprador) ──');
  r = await shop('POST', '/orders', orderBody(product));
  const o4 = r.data;
  await mockPost(`/__pay/${clipId(o4.payment_url)}?webhook=0`);
  const linkRow = (await api('GET', `/api/collections/payment_links/records?filter=${encodeURIComponent(`provider_id="${clipId(o4.payment_url)}"`)}`, { token: SU })).data.items[0];
  await sleep(2300); // el plugin limita las consultas a Clip a 1 cada 2 s por link
  const back = await fetch(`${URL_}/api/payment-links/${linkRow.id}/return?result=success`);
  ok(back.status === 200, 'la página de retorno responde');
  ok(await waitFor(async () => (await orderOf(o4.id)).payment_status === 'completed'), 'el retorno verifica contra Clip y completa el pedido');

  console.log('── seguridad ──');
  r = await fetch(`${URL_}/api/payment-links-webhook/clip?token=malo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok(r.status === 403, 'webhook con token malo → 403');
  r = await api('POST', '/api/payment-links', { body: { amount: 5 } });
  ok(r.status === 401 || r.status === 403, 'crear links directo requiere superusuario');
  ok(code(await shop('POST', '/orders', orderBody(product, { items: [{ product: product.id, quantity: 1 }], way_of_payment: 'clip', request_id: undefined }))) === 'request_id_required', 'sin request_id se rechaza');
  void owner;
} catch (err) {
  fail++; console.log('  ✘ excepción:', err.message);
} finally {
  stop();
  if (fail) { console.log('--- log de PocketBase (errores) ---'); try { console.log(fs.readFileSync(path.join(tmp, 'pb.log'), 'utf8').split('\n').filter((l) => /ERROR|payment-links|clip/i.test(l)).slice(-25).join('\n')); } catch {} }
  console.log(`\n${pass} ok, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
function code(r) { return Object.keys(r.data?.data || {})[0]; }
