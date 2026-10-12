#!/usr/bin/env node
/**
 * Clip falso para probar el plugin sin dinero ni cuenta. NO se copia al otro proyecto.
 *
 *   node test/mock-clip.mjs          (escucha en http://127.0.0.1:8099)
 *
 * Arranca PocketBase apuntando a el:
 *   CLIP_API_URL=http://127.0.0.1:8099 CLIP_API_TOKEN=test \
 *   PAYMENT_LINKS_WEBHOOK_TOKEN=un-secreto-de-al-menos-16 PAYMENT_LINKS_PUBLIC_URL=http://127.0.0.1:8090 \
 *   pocketbase serve
 *
 * Endpoints de Clip imitados: POST /v2/checkout y GET /v2/checkout/{id}.
 * Para simular al comprador:
 *   POST /__pay/{id}     el pago se completa (con receipt_no)
 *   POST /__fail/{id}    el link se cancela
 *   POST /__tamper/{id}  completa el pago pero con OTRO monto (el plugin debe rechazarlo)
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_CLIP_PORT || 8099);
const links = new Map();

const readJson = (req) =>
	new Promise((resolve) => {
		let raw = '';
		req.on('data', (chunk) => (raw += chunk));
		req.on('end', () => {
			try {
				resolve(JSON.parse(raw || '{}'));
			} catch {
				resolve({});
			}
		});
	});
const send = (res, status, body) => {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const auth = req.headers.authorization;
	if (url.pathname.startsWith('/v2/') && !auth)
		return send(res, 401, { message: 'sin credenciales' });

	if (req.method === 'POST' && url.pathname === '/v2/checkout') {
		const body = await readJson(req);
		if (!body.amount || body.amount < 1) return send(res, 400, { message: 'amount minimo 1' });
		const id = randomUUID();
		links.set(id, { body, status: 'CHECKOUT_PENDING', amount: body.amount, receipt: null });
		console.log(`+ link ${id} $${body.amount} ref=${body.metadata?.external_reference}`);
		console.log(`  webhook_url=${body.webhook_url}`);
		console.log(`  success=${body.redirection_url?.success}`);
		return send(res, 200, {
			payment_request_id: id,
			payment_request_url: `http://127.0.0.1:${PORT}/pay/${id}`,
			status: 'CHECKOUT_CREATED',
			qr_image_url: `http://127.0.0.1:${PORT}/qr/${id}.png`
		});
	}
	const get = url.pathname.match(/^\/v2\/checkout\/([0-9a-f-]{36})$/);
	if (req.method === 'GET' && get) {
		const link = links.get(get[1]);
		if (!link) return send(res, 404, { message: 'no existe' });
		return send(res, 200, {
			payment_request_id: get[1],
			status: link.status,
			amount: link.amount,
			currency: link.body.currency,
			metadata: link.body.metadata,
			...(link.status === 'CHECKOUT_COMPLETED' ? { receipt_no: link.receipt } : {})
		});
	}
	const sim = url.pathname.match(/^\/__(pay|fail|tamper)\/([0-9a-f-]{36})$/);
	if (req.method === 'POST' && sim) {
		const link = links.get(sim[2]);
		if (!link) return send(res, 404, { message: 'no existe' });
		if (sim[1] === 'fail') link.status = 'CHECKOUT_CANCELLED';
		else {
			link.status = 'CHECKOUT_COMPLETED';
			link.receipt = `R-${Math.random().toString(36).slice(2, 10)}`;
			if (sim[1] === 'tamper') link.amount = 1;
		}
		// avisa al webhook como lo haria Clip: solo { id, origin, event_type }
		if (url.searchParams.get('webhook') !== '0' && link.body.webhook_url) {
			fetch(link.body.webhook_url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: sim[2], origin: 'checkout-api', event_type: 'UPDATE' })
			}).catch((err) => console.log('  webhook fallo:', err.message));
		}
		return send(res, 200, { ok: true, status: link.status });
	}
	send(res, 404, { message: 'no encontrado' });
}).listen(PORT, '127.0.0.1', () => console.log(`Clip falso en http://127.0.0.1:${PORT}`));
