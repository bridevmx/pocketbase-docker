/**
 * Configuracion del plugin. Edita este archivo o, mejor, crea `config.local.js` (junto a este) con SOLO lo que
 * quieras cambiar: se mezcla encima de estos valores y no se sube a git (ver config.local.example.js).
 *
 * Los secretos se leen de variables de entorno del proceso de PocketBase (no hay .env automatico):
 *   CLIP_API_TOKEN                 token tal cual para el header Authorization
 *   o CLIP_API_KEY + CLIP_API_SECRET   (Authorization: Basic base64(key:secret))
 *   PAYMENT_LINKS_WEBHOOK_TOKEN    secreto largo: va en la URL del webhook y firma las referencias
 *   PAYMENT_LINKS_PUBLIC_URL       URL publica de ESTE PocketBase (https://pagos.midominio.com)
 *   CLIP_API_URL                   opcional; por defecto https://api.payclip.com
 */
const env = (name, fallback) => {
	const value = $os.getenv(name);
	return value ? value : fallback || '';
};

module.exports = {
	// --- Clip ---
	provider: {
		baseUrl: env('CLIP_API_URL', 'https://api.payclip.com'),
		token: env('CLIP_API_TOKEN'),
		key: env('CLIP_API_KEY'),
		secret: env('CLIP_API_SECRET'),
		timeoutSeconds: 10
	},

	// URL publica de este PocketBase: de aqui salen el webhook y las URLs de retorno que se mandan a Clip.
	// Si esta vacia se usa la "Application URL" de PocketBase (Ajustes > Application).
	publicUrl: env('PAYMENT_LINKS_PUBLIC_URL'),
	// Secreto del webhook y de las referencias. Obligatorio: sin el no se crean links.
	webhookToken: env('PAYMENT_LINKS_WEBHOOK_TOKEN'),

	// --- Coleccion donde se guardan los links (se crea sola al arrancar) ---
	collection: 'payment_links',

	// --- API ---
	api: {
		basePath: '/api/payment-links',
		// quien puede crear y consultar links:
		//   'superuser' solo superusuarios (recomendado si los crea tu servidor)
		//   'auth'      cualquier sesion de PocketBase; limitala con `collections: ['users']`
		//   'public'    cualquiera (¡solo detras de tu propio control de acceso!)
		auth: 'superuser',
		collections: []
	},

	// --- el link de pago ---
	link: {
		currency: 'MXN',
		minAmount: 1, // en pesos (Clip no acepta menos de 1)
		maxAmount: 100000,
		// credit | debit | cash. "cash" es diferido (el cliente paga despues en tienda): evitalo si reservas stock
		paymentMethods: ['credit', 'debit'],
		// abre directo el formulario de tarjeta (solo si ofreces unicamente credit/debit)
		openOnCardForm: true,
		// minutos de vida del link (null = lo que decida Clip, 3 dias por defecto). Clip exige que venza
		// el mismo dia antes de las 23:59:59 hora CDMX; si te pasas, Clip responde error 400.
		expiresInMinutes: null,
		referencePrefix: 'PL', // la referencia es PL-<id>-<firma>, de 36 caracteres como maximo
		descriptionMax: 250,
		// meses sin intereses, p. ej. [3, 6, 12] (null = no ofrecer)
		installmentsMsi: null,
		international: false
	},

	// --- paginas a las que regresa el comprador (HTML propio, se pueden personalizar por completo) ---
	pages: {
		brand: 'Pagos',
		logoUrl: '', // https://... (opcional)
		accent: '#2563eb',
		showDetails: true, // muestra descripcion y monto
		refreshPendingSeconds: 5, // la pagina "confirmando" se recarga sola; 0 = no
		texts: {
			paidTitle: '¡Pago recibido!',
			paidMessage: 'Gracias. Tu pago se registró correctamente.',
			failedTitle: 'No se pudo completar el pago',
			failedMessage: 'Tu pago no se realizó o el link venció. No se hizo ningún cargo.',
			pendingTitle: 'Confirmando tu pago…',
			pendingMessage: 'Esto tarda unos segundos. No cierres esta página.',
			notFoundTitle: 'Link no encontrado',
			notFoundMessage: 'Revisa el enlace o pide uno nuevo.',
			buttonLabel: '' // si pones texto y buttonUrl, se muestra un boton (p. ej. "Volver a la tienda")
		},
		buttonUrl: ''
	},

	// Si pones una URL, el comprador va ahi en lugar de ver la pagina de arriba. Acepta {id}, {reference}
	// y {status} (paid | failed | pending). Ejemplo: 'https://mitienda.com/gracias?ref={reference}'
	redirects: {
		success: '',
		error: '',
		pending: ''
	},

	// --- respaldo para webhooks perdidos (Clip no documenta reintentos) ---
	reconcile: {
		enabled: true,
		cron: '*/5 * * * *',
		minAgeMinutes: 2, // no consulta links recien creados
		maxAgeHours: 72, // deja de revisar links mas viejos (se marcan vencidos)
		batch: 50
	},

	// --- tus reglas: funciones que el plugin llama en cada momento ---
	hooks: {
		// Texto que ve el comprador en Clip. `input` = lo recibido en POST; `ctx.auth` = quien lo pidio.
		// description: (input, ctx) => `Pedido ${input.metadata.order} - Mi tienda`,
		description: null,

		// Validar o ajustar lo recibido ANTES de crear. Devuelve el input (modificado o no) o lanza error:
		//   throw new BadRequestError('Falta el pedido');
		beforeCreate: null,

		// Se llama una sola vez cuando el pago queda CONFIRMADO. `record` es el registro de payment_links.
		// Ideal para marcar tu pedido como pagado, enviar un correo, etc. Si lanza un error solo se registra.
		onPaid: null,

		// Cuando el link se cancela o vence sin pagarse.
		onFailed: null
	}
};
