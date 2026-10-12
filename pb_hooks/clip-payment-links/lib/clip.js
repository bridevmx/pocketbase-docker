/**
 * Cliente minimo de la API de Clip (links de pago del Checkout Redireccionado), sobre `$http.send`.
 *   POST {base}/v2/checkout        crea el link
 *   GET  {base}/v2/checkout/{id}   estado (receipt_no solo viene cuando esta COMPLETED)
 * Estados: CHECKOUT_CREATED | CHECKOUT_PENDING | CHECKOUT_CANCELLED | CHECKOUT_EXPIRED | CHECKOUT_COMPLETED.
 */
const { base64 } = require(`${__hooks}/clip-payment-links/lib/util.js`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isClipId = (value) => typeof value === 'string' && UUID.test(value);

// Un estado desconocido NUNCA cuenta como pagado.
const STATUS = {
	CHECKOUT_COMPLETED: 'paid',
	CHECKOUT_CANCELLED: 'failed',
	CHECKOUT_EXPIRED: 'failed',
	CHECKOUT_CREATED: 'pending',
	CHECKOUT_PENDING: 'pending'
};
const normalizeStatus = (raw) => STATUS[String(raw || '').toUpperCase()] || 'pending';

const HINTS = {
	401: 'credenciales de Clip incorrectas',
	403: 'Clip bloquea solicitudes fuera de Mexico y EE. UU.',
	412: 'limite de peticiones de Clip'
};

class ClipError extends Error {
	constructor(message, status) {
		super(message);
		this.name = 'ClipError';
		this.status = status;
	}
}

function describeError(status, body) {
	const detail = (body && (body.message || body.code_message || body.error)) || '';
	const hint = HINTS[status] ? ` (${HINTS[status]})` : '';
	return `Clip respondio ${status}${hint}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`;
}

function createClient(cfg) {
	const baseUrl = String(cfg.provider.baseUrl || '').replace(/\/+$/, '');
	const { token, key, secret } = cfg.provider;
	const authorization = token ? token : `Basic ${base64(`${key}:${secret}`)}`;
	// el link lleva al comprador a otro sitio: https siempre, salvo contra un servidor de pruebas http
	const allowedLink = baseUrl.indexOf('http://') === 0 ? /^https?:\/\//i : /^https:\/\//i;

	function call(method, path, body) {
		let res;
		try {
			res = $http.send({
				url: baseUrl + path,
				method,
				headers: { authorization, 'content-type': 'application/json', accept: 'application/json' },
				body: body ? JSON.stringify(body) : '',
				timeout: cfg.provider.timeoutSeconds || 10
			});
		} catch (err) {
			throw new ClipError(`No pude conectar con Clip: ${err}`);
		}
		const json = res.json && typeof res.json === 'object' ? res.json : {};
		if (res.statusCode < 200 || res.statusCode >= 300) {
			throw new ClipError(describeError(res.statusCode, json), res.statusCode);
		}
		return json;
	}

	return {
		isConfigured: !!(baseUrl && (token || (key && secret))),

		/** Crea el link. `amountCents` en centavos (Clip recibe pesos con 2 decimales). */
		createCheckout({ amountCents, currency, description, reference, urls, webhookUrl, expiresAt }) {
			const link = cfg.link;
			const options = { payment_method_types: link.paymentMethods };
			if (link.international) options.international_enabled = true;
			if (link.installmentsMsi && link.installmentsMsi.length) options.installments_msi = link.installmentsMsi;

			const payload = {
				amount: Number((amountCents / 100).toFixed(2)),
				currency,
				purchase_description: String(description).slice(0, link.descriptionMax || 250),
				redirection_url: { success: urls.success, error: urls.error, default: urls.default },
				metadata: { external_reference: reference },
				webhook_url: webhookUrl,
				custom_payment_options: options
			};
			if (expiresAt) payload.expires_at = expiresAt;

			const body = call('POST', '/v2/checkout', payload);
			const id = body.payment_request_id;
			const url = body.payment_request_url;
			if (!isClipId(id)) throw new ClipError('Clip no devolvio un id de solicitud valido');
			if (!allowedLink.test(String(url || ''))) throw new ClipError('Clip devolvio un link de pago no valido');

			const cardOnly = link.paymentMethods.every((m) => m === 'credit' || m === 'debit');
			const finalUrl =
				link.openOnCardForm && cardOnly ? `${String(url).replace(/\/+$/, '')}/card` : String(url);
			return { id: String(id), url: finalUrl, qrUrl: body.qr_image_url || '', expiresAt: body.expires_at || '' };
		},

		/** { id, status: 'paid'|'failed'|'pending', rawStatus, amountCents, currency, reference, receiptNo } */
		getCheckout(id) {
			if (!isClipId(id)) throw new ClipError('Id de solicitud de pago no valido');
			const body = call('GET', `/v2/checkout/${encodeURIComponent(id)}`);
			const amount = Number(body.amount);
			return {
				id,
				status: normalizeStatus(body.status),
				rawStatus: body.status || '',
				amountCents: isFinite(amount) ? Math.round(amount * 100) : null,
				currency: body.currency || '',
				reference: (body.metadata && body.metadata.external_reference) || '',
				receiptNo: body.receipt_no ? String(body.receipt_no) : ''
			};
		}
	};
}

module.exports = { createClient, ClipError, isClipId, normalizeStatus };
