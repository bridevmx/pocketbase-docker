/**
 * Crea la coleccion de links de pago si no existe. Todas las reglas van en `null` (solo superusuarios por la
 * API de PocketBase): el plugin escribe con permisos propios y tu aplicacion lee a traves de sus rutas.
 * Si quieres que tus usuarios lean sus links directo, abre `listRule`/`viewRule` en el panel de PocketBase.
 */
const { loadConfig } = require(`${__hooks}/clip-payment-links/lib/util.js`);

function ensure() {
	const name = loadConfig().collection;
	try {
		$app.findCollectionByNameOrId(name);
		return;
	} catch (_) {
		// no existe: se crea
	}
	const collection = new Collection({
		type: 'base',
		name,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
		fields: [
			{ type: 'text', name: 'reference', required: true, max: 64 },
			// centavos enteros; el minimo (1 peso) hace que `required` sea seguro (PocketBase rechaza 0 como vacio)
			{ type: 'number', name: 'amount_cents', required: true, onlyInt: true, min: 1 },
			{ type: 'text', name: 'currency', required: true, max: 8 },
			{ type: 'text', name: 'description', max: 250 },
			{ type: 'select', name: 'status', required: true, maxSelect: 1, values: ['pending', 'paid', 'failed'] },
			{ type: 'text', name: 'provider_id', max: 64 }, // UUID de Clip (payment_request_id)
			{ type: 'text', name: 'provider_status', max: 64 }, // ultimo estado crudo de Clip
			{ type: 'text', name: 'url', max: 500 }, // link de pago para el comprador
			{ type: 'text', name: 'qr_url', max: 500 },
			{ type: 'text', name: 'receipt_no', max: 64 },
			{ type: 'date', name: 'expires_at' },
			{ type: 'date', name: 'paid_at' },
			// libre para tu aplicacion (id de pedido, cliente...). Se devuelve tal cual en la API.
			{ type: 'json', name: 'metadata', maxSize: 50000 },
			{ type: 'text', name: 'created_by', max: 64 },
			{ type: 'text', name: 'error', max: 500 },
			{ type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
			{ type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
		],
		indexes: [
			`CREATE UNIQUE INDEX idx_${name}_reference ON ${name} (reference)`,
			`CREATE UNIQUE INDEX idx_${name}_provider ON ${name} (provider_id) WHERE provider_id != ''`,
			`CREATE UNIQUE INDEX idx_${name}_receipt ON ${name} (receipt_no) WHERE receipt_no != ''`,
			`CREATE INDEX idx_${name}_status ON ${name} (status, created)`
		]
	});
	$app.save(collection);
}

module.exports = { ensure };
