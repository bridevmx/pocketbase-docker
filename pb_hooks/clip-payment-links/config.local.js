// Ajustes de Clip para esta tienda (sin secretos: las credenciales vienen de variables de entorno).
// Los hooks delegan en lib/clip_pay.js, que ata cada link a su pedido.
module.exports = {
	api: { auth: 'superuser' }, // los links se crean desde el servidor (createOrder), no desde el navegador
	link: {
		paymentMethods: ['credit', 'debit'], // sin efectivo: el pago diferido dejaría existencias comprometidas
		minAmount: 1,
		referencePrefix: 'PL'
	},
	pages: { brand: 'Tienda' },
	hooks: {
		onPaid: (record) => require(`${__hooks}/lib/clip_pay.js`).onPaid(record),
		onFailed: (record) => require(`${__hooks}/lib/clip_pay.js`).onFailed(record)
	}
};
