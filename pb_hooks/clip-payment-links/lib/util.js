/** Utilidades sin dependencias (el motor JS de PocketBase no tiene btoa, URL ni URLSearchParams). */

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Mezcla `extra` encima de `base`: los objetos clave por clave; listas, funciones y valores se reemplazan. */
function merge(base, extra) {
	const out = {};
	for (const key of Object.keys(base)) out[key] = base[key];
	for (const key of Object.keys(extra || {})) {
		out[key] = isPlain(base[key]) && isPlain(extra[key]) ? merge(base[key], extra[key]) : extra[key];
	}
	return out;
}

/** config.js mezclado con config.local.js (si existe). */
function loadConfig() {
	const defaults = require(`${__hooks}/clip-payment-links/config.js`);
	let local = {};
	try {
		local = require(`${__hooks}/clip-payment-links/config.local.js`);
	} catch (_) {
		// no hay config.local.js: se usa config.js tal cual
	}
	return merge(defaults, local);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 de un texto (UTF-8). Se usa para `Authorization: Basic`. */
function base64(text) {
	const encoded = encodeURIComponent(String(text));
	const bytes = [];
	for (let i = 0; i < encoded.length; i++) {
		if (encoded[i] === '%') {
			bytes.push(parseInt(encoded.substr(i + 1, 2), 16));
			i += 2;
		} else {
			bytes.push(encoded.charCodeAt(i));
		}
	}
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
		out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
		out += b2 === undefined ? '=' : B64[b2 & 63];
	}
	return out;
}

/** Fecha en el formato que usa PocketBase para guardar y filtrar ("2026-10-12 19:30:00.000Z"). */
const pbDate = (date) => date.toISOString().replace('T', ' ');

/** Escapa texto para meterlo en HTML. */
const escapeHtml = (value) =>
	String(value === null || value === undefined ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

module.exports = { merge, loadConfig, base64, pbDate, escapeHtml };
