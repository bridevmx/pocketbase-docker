/// <reference path="../pb_data/types.d.ts" />
/**
 * clip-payment-links — plugin de PocketBase (JSVM, v0.23+) para crear y cobrar links de pago de Clip.
 *
 * Instalacion: copia ESTE archivo y la carpeta `clip-payment-links/` dentro de `pb_hooks/` de tu proyecto.
 * Este archivo debe quedar en la raiz de pb_hooks (PocketBase no carga *.pb.js de subcarpetas).
 * Configuracion y personalizacion: clip-payment-links/config.js (ver README.md).
 *
 * Rutas (la base se cambia en config.api.basePath):
 *   POST {base}                      crea un link de pago
 *   GET  {base}/{id}[?refresh=1]     estado de un link (refresh = preguntarle a Clip)
 *   GET  {base}/{id}/return          pagina publica a la que Clip regresa al comprador
 *   POST {base}-webhook/clip?token=  aviso de Clip (se usa solo como senal: el estado se consulta a Clip)
 *
 * Regla de oro: un link NUNCA se da por pagado por un webhook ni por la URL de retorno; solo cuando
 * Clip responde COMPLETED con NUESTRA referencia, monto, moneda y un recibo (ver lib/service.js).
 *
 * Nota de PocketBase: los handlers corren aislados y no ven variables de este archivo; por eso cada uno
 * hace `require` de lo que necesita con `${__hooks}`.
 */

const cfg = require(`${__hooks}/clip-payment-links/lib/util.js`).loadConfig();
const base = cfg.api.basePath.replace(/\/+$/, '');

// ---- coleccion y avisos de configuracion al arrancar ----
onBootstrap((e) => {
	e.next();
	try {
		require(`${__hooks}/clip-payment-links/lib/collection.js`).ensure();
		const missing = require(`${__hooks}/clip-payment-links/lib/service.js`).configProblems();
		if (missing.length) {
			console.log(`[payment-links] falta configurar: ${missing.join(', ')}. Los links no se podran crear.`);
		}
	} catch (err) {
		console.log(`[payment-links] no se pudo preparar la coleccion: ${err}`);
	}
});

// ---- quien puede crear y consultar links ----
// 'superuser' (por defecto), 'auth' (cualquier sesion; config.api.collections la limita) o 'public'
const guard = [];
if (cfg.api.auth === 'superuser') guard.push($apis.requireSuperuserAuth());
else if (cfg.api.auth === 'auth') guard.push($apis.requireAuth(...(cfg.api.collections || [])));

routerAdd(
	'POST',
	base,
	(e) => require(`${__hooks}/clip-payment-links/lib/routes.js`).create(e),
	...guard
);

routerAdd(
	'GET',
	`${base}/{id}`,
	(e) => require(`${__hooks}/clip-payment-links/lib/routes.js`).show(e),
	...guard
);

// publicas: las usa el comprador y Clip (el id del link no se puede adivinar y no se muestra nada sensible)
routerAdd('GET', `${base}/{id}/return`, (e) =>
	require(`${__hooks}/clip-payment-links/lib/routes.js`).back(e)
);

routerAdd('POST', `${base}-webhook/clip`, (e) =>
	require(`${__hooks}/clip-payment-links/lib/routes.js`).webhook(e)
);

// ---- respaldo: confirma los pagos cuyo webhook se perdio ----
if (cfg.reconcile.enabled) {
	cronAdd('paymentLinksReconcile', cfg.reconcile.cron, () => {
		require(`${__hooks}/clip-payment-links/lib/service.js`).reconcile();
	});
}
