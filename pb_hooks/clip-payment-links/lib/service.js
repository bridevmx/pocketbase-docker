/**
 * Logica de los links de pago: crear, verificar contra Clip y conciliar.
 *
 * Un link solo pasa a `paid` si Clip responde COMPLETED con NUESTRA referencia, NUESTRO monto, NUESTRA moneda y
 * un `receipt_no`. El webhook y la URL de retorno solo sirven para decidir CUANDO preguntar; nunca prueban nada.
 */
const util = require(`${__hooks}/clip-payment-links/lib/util.js`);
const clipLib = require(`${__hooks}/clip-payment-links/lib/clip.js`);

const ID = /^[a-z0-9]{15}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const THROTTLE_MS = 2000; // no se le pregunta a Clip por el mismo link mas de 1 vez cada 2 s (salvo `force`)

const cfg = () => util.loadConfig();
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function log(level, message, detail) {
	try {
		$app.logger()[level](`[payment-links] ${message}`, 'detail', String(detail === undefined ? '' : detail));
	} catch (_) {
		console.log(`[payment-links] ${message} ${detail === undefined ? '' : detail}`);
	}
}

// ---------------------------------------------------------------- configuracion
function publicUrlOf(c) {
	return String(c.publicUrl || $app.settings().meta.appUrl || '').replace(/\/+$/, '');
}

/** Lo que falta para poder crear links (lista vacia = todo listo). */
function configProblems() {
	const c = cfg();
	const missing = [];
	const p = c.provider;
	if (!p.token && !(p.key && p.secret)) missing.push('CLIP_API_TOKEN (o CLIP_API_KEY y CLIP_API_SECRET)');
	if (!c.webhookToken || String(c.webhookToken).length < 16) {
		missing.push('PAYMENT_LINKS_WEBHOOK_TOKEN (minimo 16 caracteres)');
	}
	if (!publicUrlOf(c)) missing.push('PAYMENT_LINKS_PUBLIC_URL');
	if (String(c.link.referencePrefix).length > 11) missing.push('link.referencePrefix (maximo 11 caracteres)');
	return missing;
}

// ---------------------------------------------------------------- referencia firmada
const sign = (c, id) => $security.hs256(id, c.webhookToken).slice(0, 8);
const makeReference = (c, id) => `${c.link.referencePrefix}-${id}-${sign(c, id)}`;
const referenceIsOurs = (c, record) =>
	$security.equal(record.getString('reference'), makeReference(c, record.id));

// ---------------------------------------------------------------- lectura
function find(id) {
	if (!ID.test(String(id || ''))) return null;
	try {
		return $app.findRecordById(cfg().collection, id);
	} catch (_) {
		return null;
	}
}

function findByProvider(providerId) {
	try {
		return $app.findFirstRecordByData(cfg().collection, 'provider_id', providerId);
	} catch (_) {
		return null;
	}
}

function readJson(record, field) {
	try {
		const raw = record.getString(field);
		return raw ? JSON.parse(raw) : {};
	} catch (_) {
		return {};
	}
}

/** Lo que devuelve la API (sin datos internos). */
function view(record) {
	const cents = record.getInt('amount_cents');
	return {
		id: record.id,
		reference: record.getString('reference'),
		status: record.getString('status'),
		amount: cents / 100,
		amountCents: cents,
		currency: record.getString('currency'),
		description: record.getString('description'),
		url: record.getString('url'),
		qrUrl: record.getString('qr_url'),
		receiptNo: record.getString('receipt_no'),
		expiresAt: record.getString('expires_at'),
		paidAt: record.getString('paid_at'),
		metadata: readJson(record, 'metadata'),
		created: record.getString('created')
	};
}

// ---------------------------------------------------------------- crear
function createLink(rawInput, ctx) {
	const c = cfg();
	const problems = configProblems();
	if (problems.length) {
		log('error', 'configuracion incompleta', problems.join(', '));
		throw new ApiError(503, 'El servicio de pagos no esta configurado', {});
	}

	let input = isPlain(rawInput) ? rawInput : {};
	if (typeof c.hooks.beforeCreate === 'function') input = c.hooks.beforeCreate(input, ctx) || input;

	const amount = Number(input.amount);
	const cents = Math.round(amount * 100);
	if (!isFinite(amount) || Math.abs(amount * 100 - cents) > 1e-6) {
		throw new BadRequestError('amount debe ser un numero en pesos con maximo 2 decimales', {
			amount: new ValidationError('validation_invalid', 'Monto no valido')
		});
	}
	if (amount < c.link.minAmount || amount > c.link.maxAmount) {
		throw new BadRequestError(`El monto debe estar entre ${c.link.minAmount} y ${c.link.maxAmount}`, {
			amount: new ValidationError('validation_out_of_range', 'Monto fuera de rango')
		});
	}

	let description = typeof c.hooks.description === 'function' ? c.hooks.description(input, ctx) : input.description;
	description = String(description || 'Pago').trim().slice(0, c.link.descriptionMax || 250) || 'Pago';

	let metadata = {};
	if (input.metadata !== undefined) {
		if (!isPlain(input.metadata) || JSON.stringify(input.metadata).length > 20000) {
			throw new BadRequestError('metadata debe ser un objeto de hasta 20 KB', {
				metadata: new ValidationError('validation_invalid', 'Metadata no valida')
			});
		}
		metadata = input.metadata;
	}

	const id = $security.randomStringWithAlphabet(15, ALPHABET);
	const reference = makeReference(c, id);
	const expiresAt = c.link.expiresInMinutes
		? new Date(Date.now() + c.link.expiresInMinutes * 60000).toISOString()
		: '';

	const record = new Record($app.findCollectionByNameOrId(c.collection));
	record.set('id', id);
	record.set('reference', reference);
	record.set('amount_cents', cents);
	record.set('currency', c.link.currency);
	record.set('description', description);
	record.set('status', 'pending');
	record.set('metadata', metadata);
	record.set('created_by', ctx && ctx.auth ? ctx.auth.id : '');
	// se guarda ANTES de llamar a Clip: asi la referencia ya existe si el webhook llega muy rapido
	$app.save(record);

	const base = publicUrlOf(c);
	const back = `${base}${c.api.basePath.replace(/\/+$/, '')}/${id}/return`;
	try {
		const created = clipLib.createClient(c).createCheckout({
			amountCents: cents,
			currency: c.link.currency,
			description,
			reference,
			urls: { success: `${back}?result=success`, error: `${back}?result=error`, default: `${back}?result=default` },
			webhookUrl: `${base}${c.api.basePath.replace(/\/+$/, '')}-webhook/clip?token=${encodeURIComponent(c.webhookToken)}`,
			expiresAt
		});
		record.set('provider_id', created.id);
		record.set('provider_status', 'CHECKOUT_CREATED');
		record.set('url', created.url);
		record.set('qr_url', created.qrUrl);
		if (created.expiresAt) record.set('expires_at', created.expiresAt);
		$app.save(record);
	} catch (err) {
		record.set('status', 'failed');
		record.set('error', String(err.message || err).slice(0, 500));
		$app.save(record);
		log('error', 'Clip no creo el link', err.message || err);
		const detail = c.api.auth === 'public' ? 'No se pudo crear el link de pago' : String(err.message || err);
		throw new ApiError(502, detail, {});
	}
	return view(record);
}

// ---------------------------------------------------------------- verificar
function fire(name, record) {
	const fn = cfg().hooks[name];
	if (typeof fn !== 'function') return;
	try {
		fn(record);
	} catch (err) {
		log('error', `el hook ${name} fallo`, err);
	}
}

/**
 * pending -> `to` de forma atomica e idempotente: dentro de una transaccion se relee el registro y solo se
 * cambia si SIGUE pendiente, asi onPaid/onFailed se disparan una sola vez aunque lleguen webhook y retorno a la vez.
 */
function transition(id, to, apply) {
	let changed = false;
	let result = null;
	$app.runInTransaction((tx) => {
		const fresh = tx.findRecordById(cfg().collection, id);
		result = fresh;
		if (fresh.getString('status') !== 'pending') return;
		fresh.set('status', to);
		apply(fresh);
		tx.save(fresh);
		changed = true;
	});
	if (changed) fire(to === 'paid' ? 'onPaid' : 'onFailed', result);
	return result;
}

function note(record, message) {
	if (record.getString('error') === message) return;
	record.set('error', message);
	$app.save(record);
}

/** Pregunta a Clip y actualiza el link. Devuelve el registro vigente. Nunca lanza por un fallo de red. */
function verify(record, options) {
	const c = cfg();
	if (record.getString('status') !== 'pending') return record;
	const providerId = record.getString('provider_id');
	if (!providerId) return record;

	if (!(options && options.force)) {
		const updated = new Date(record.getString('updated').replace(' ', 'T')).getTime();
		if (isFinite(updated) && Date.now() - updated < THROTTLE_MS) return record;
	}

	let remote;
	try {
		remote = clipLib.createClient(c).getCheckout(providerId);
	} catch (err) {
		log('warn', 'no se pudo consultar a Clip (se reintenta despues)', err.message || err);
		return record;
	}

	if (remote.status === 'failed') {
		return transition(record.id, 'failed', (r) => {
			r.set('provider_status', remote.rawStatus);
			r.set('error', '');
		});
	}
	if (remote.status === 'pending') {
		if (record.getString('provider_status') !== remote.rawStatus) {
			record.set('provider_status', remote.rawStatus);
			$app.save(record);
		}
		return record;
	}

	// COMPLETED: todo debe coincidir con lo NUESTRO
	const same =
		referenceIsOurs(c, record) &&
		remote.reference === record.getString('reference') &&
		remote.amountCents === record.getInt('amount_cents') &&
		remote.currency === record.getString('currency');
	if (!same) {
		log('error', 'Clip reporta un pago que no coincide con el link', record.id);
		note(record, 'El pago reportado por Clip no coincide con el link (referencia, monto o moneda)');
		return record;
	}
	// sin recibo todavia: Clip aun no lo liquida del todo; se vuelve a preguntar luego
	if (!remote.receiptNo) return record;

	try {
		return transition(record.id, 'paid', (r) => {
			r.set('provider_status', remote.rawStatus);
			r.set('receipt_no', remote.receiptNo);
			r.set('paid_at', util.pbDate(new Date()));
			r.set('error', '');
		});
	} catch (err) {
		// p. ej. el recibo ya lo usa otro link (indice unico): anomalia, se deja pendiente y se avisa
		log('error', 'no se pudo registrar el pago', err);
		note(record, 'No se pudo registrar el pago (¿recibo repetido?). Revisalo en Clip.');
		return record;
	}
}

// ---------------------------------------------------------------- conciliar
/** Respaldo del webhook: revisa los links pendientes y vence los muy viejos. */
function reconcile() {
	const c = cfg();
	const name = c.collection;
	const r = c.reconcile;
	const oldest = util.pbDate(new Date(Date.now() - r.maxAgeHours * 3600000));
	const newest = util.pbDate(new Date(Date.now() - r.minAgeMinutes * 60000));

	let pending = [];
	try {
		pending = $app.findRecordsByFilter(
			name,
			'status = "pending" && provider_id != "" && created >= {:oldest} && created <= {:newest}',
			'-created',
			r.batch,
			0,
			{ oldest, newest }
		);
	} catch (_) {
		pending = [];
	}
	pending.forEach((row) => verify(row, { force: true }));

	let stale = [];
	try {
		stale = $app.findRecordsByFilter(name, 'status = "pending" && created < {:oldest}', 'created', r.batch, 0, { oldest });
	} catch (_) {
		stale = [];
	}
	stale.forEach((row) =>
		transition(row.id, 'failed', (x) => x.set('error', 'Vencido sin pago confirmado'))
	);
}

module.exports = { configProblems, find, findByProvider, view, createLink, verify, reconcile, publicUrlOf };
