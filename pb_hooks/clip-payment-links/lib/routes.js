/** Handlers HTTP del plugin (los registra clip-payment-links.pb.js). */
const util = require(`${__hooks}/clip-payment-links/lib/util.js`);
const clipLib = require(`${__hooks}/clip-payment-links/lib/clip.js`);
const service = require(`${__hooks}/clip-payment-links/lib/service.js`);
const pages = require(`${__hooks}/clip-payment-links/lib/pages.js`);

const KIND = { paid: 'success', failed: 'error', pending: 'pending' };

/** POST {base}  { amount (pesos), description?, metadata? } -> 201 con el link */
function create(e) {
	const body = e.requestInfo().body || {};
	return e.json(201, service.createLink(body, { auth: e.auth, event: e }));
}

/** GET {base}/{id}[?refresh=1] */
function show(e) {
	let record = service.find(e.request.pathValue('id'));
	if (!record) throw new NotFoundError('Link no encontrado');
	if (e.request.url.query().get('refresh')) record = service.verify(record, { force: true });
	return e.json(200, service.view(record));
}

/** GET {base}/{id}/return — a donde Clip regresa al comprador. El resultado sale de la verificacion, no de la URL. */
function back(e) {
	const c = util.loadConfig();
	const t = c.pages.texts;
	e.response.header().set('cache-control', 'no-store');

	let record = service.find(e.request.pathValue('id'));
	if (!record) return e.html(404, pages.render(c, 'bad', t.notFoundTitle, t.notFoundMessage));
	record = service.verify(record);

	const status = record.getString('status');
	const target = c.redirects[KIND[status]];
	if (target) {
		const url = String(target)
			.replace(/\{id\}/g, encodeURIComponent(record.id))
			.replace(/\{reference\}/g, encodeURIComponent(record.getString('reference')))
			.replace(/\{status\}/g, status);
		return e.redirect(302, url);
	}

	const cents = record.getInt('amount_cents');
	const details = {
		description: record.getString('description'),
		amount: `$${(cents / 100).toFixed(2)} ${record.getString('currency')}`
	};
	if (status === 'paid') return e.html(200, pages.render(c, 'ok', t.paidTitle, t.paidMessage, details));
	if (status === 'failed') return e.html(200, pages.render(c, 'bad', t.failedTitle, t.failedMessage, details));
	return e.html(200, pages.render(c, 'wait', t.pendingTitle, t.pendingMessage, details));
}

/**
 * POST {base}-webhook/clip?token=...  { id, origin, event_type }
 * Clip no firma el webhook: solo se usa el `id` para preguntarle el estado real. Siempre 200 (si falla algo,
 * el conciliador lo recupera); 403 con token malo.
 */
function webhook(e) {
	const c = util.loadConfig();
	if (!c.webhookToken) throw new NotFoundError();
	const token = e.request.url.query().get('token') || '';
	if (!$security.equal(token, c.webhookToken)) throw new ForbiddenError();

	const body = e.requestInfo().body || {};
	const id = String(body.id || '');
	if (clipLib.isClipId(id)) {
		const record = service.findByProvider(id); // un id desconocido no genera ninguna llamada a Clip
		if (record) {
			try {
				service.verify(record, { force: true });
			} catch (err) {
				$app.logger().error('[payment-links] webhook: no se pudo verificar', 'detail', String(err));
			}
		}
	}
	return e.json(200, { ok: true });
}

module.exports = { create, show, back, webhook };
