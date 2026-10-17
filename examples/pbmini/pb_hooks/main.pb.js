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
  short: "genera una página, un endpoint o un esquema: pbmini:new page|endpoint <ruta> [métodos] | schema <nombre> | config",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).create(args),
}));
$app.rootCmd.addCommand(new Command({
  use: "pbmini:access",
  short: "pbmini:access rules -> reglas de PocketBase equivalentes a la configuración de access",
  run: (cmd, args) => require(`${__hooks}/lib/cli.js`).access(args),
}));
