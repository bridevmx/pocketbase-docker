/** Pagina HTML a la que regresa el comprador. Todo el texto y los colores salen de config.pages. */
const { escapeHtml } = require(`${__hooks}/clip-payment-links/lib/util.js`);

const ICON = { ok: '✓', bad: '✕', wait: '…' };

/**
 * @param {object} c       configuracion completa
 * @param {'ok'|'bad'|'wait'} tone
 * @param {string} title
 * @param {string} message
 * @param {{ description?: string, amount?: string }} [details]
 */
function render(c, tone, title, message, details) {
	const p = c.pages;
	const accent = /^#[0-9a-f]{3,8}$/i.test(p.accent) ? p.accent : '#2563eb';
	const color = tone === 'ok' ? '#16a34a' : tone === 'bad' ? '#dc2626' : accent;
	const refresh =
		tone === 'wait' && p.refreshPendingSeconds > 0
			? `<meta http-equiv="refresh" content="${Number(p.refreshPendingSeconds)}">`
			: '';
	const logo = /^https:\/\//i.test(p.logoUrl) ? `<img class="logo" src="${escapeHtml(p.logoUrl)}" alt="">` : '';
	const rows =
		p.showDetails && details
			? `<dl>${details.description ? `<dt>Concepto</dt><dd>${escapeHtml(details.description)}</dd>` : ''}${
					details.amount ? `<dt>Monto</dt><dd>${escapeHtml(details.amount)}</dd>` : ''
				}</dl>`
			: '';
	const button =
		p.texts.buttonLabel && /^https?:\/\//i.test(p.buttonUrl)
			? `<a class="btn" href="${escapeHtml(p.buttonUrl)}">${escapeHtml(p.texts.buttonLabel)}</a>`
			: '';

	return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">${refresh}
<title>${escapeHtml(title)} · ${escapeHtml(p.brand)}</title>
<style>
:root{--bg:#f4f4f5;--card:#fff;--text:#18181b;--muted:#71717a;--line:#e4e4e7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0d;--card:#18181b;--text:#fafafa;--muted:#a1a1aa;--line:#27272a}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 24px;text-align:center}
.logo{max-height:40px;margin-bottom:16px}.brand{color:var(--muted);font-size:14px;margin-bottom:16px}
.icon{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;font-size:28px;color:#fff;background:${color}}
h1{font-size:22px;margin:0 0 8px}p{margin:0;color:var(--muted)}
dl{margin:20px 0 0;padding-top:16px;border-top:1px solid var(--line);display:grid;grid-template-columns:auto 1fr;gap:6px 12px;text-align:left;font-size:14px}
dt{color:var(--muted)}dd{margin:0;text-align:right;word-break:break-word}
.btn{display:inline-block;margin-top:24px;padding:10px 20px;border-radius:10px;background:${accent};color:#fff;text-decoration:none;font-weight:600}
</style></head><body><main class="card">${logo}<div class="brand">${escapeHtml(p.brand)}</div>
<div class="icon">${ICON[tone]}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${rows}${button}</main></body></html>`;
}

module.exports = { render };
