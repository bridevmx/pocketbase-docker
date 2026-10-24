require(`${__hooks}/lib/mini.js`).register();

// Comandos de consola. Cada callback corre aislado: solo globals y require().
//   ./pocketbase pbmini:routes                    tabla de rutas (JSON)
//   ./pocketbase pbmini:new page blog/[slug]      genera una página; ver lib/cli.js
$app.rootCmd.addCommand(new Command({
  use: "pbmini:routes",
  short: "imprime la tabla de rutas de pbmini como JSON",
  run: () => require(`${__hooks}/lib/cli.js`).routes(),
}));
$app.rootCmd.addCommand(new Command({
  use: "pbmini:new",
  short: "genera una página, un endpoint, un esquema, la configuración o una acción de Telegram: pbmini:new page|endpoint <ruta> [métodos] | schema <nombre> | config | tgaction <nombre>",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).create(args),
}));
$app.rootCmd.addCommand(new Command({
  use: "pbmini:access",
  short: "pbmini:access rules -> reglas de PocketBase equivalentes a la configuración de access",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).access(args),
}));
$app.rootCmd.addCommand(new Command({
  use: "pbmini:telegram",
  short: "pbmini:telegram status -> estado del módulo de Telegram (sin mostrar secretos)",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).telegram(args),
}));
$app.rootCmd.addCommand(new Command({
  use: "pbmini:clip",
  short: "pbmini:clip status|show|reconcile|purge|check|review|refund|refunded -> pagos con Clip (las operaciones que mueven dinero exigen `confirm`)",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).clip(args),
}));
$app.rootCmd.addCommand(new Command({
  use: "pbmini:spei",
  short: "pbmini:spei status|show|reconcile|purge|review|check -> pagos por transferencia SPEI (review exige `confirm`; check consulta a Banxico sin tocar órdenes)",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).spei(args),
}));
