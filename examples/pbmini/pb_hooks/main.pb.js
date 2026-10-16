require(`${__hooks}/lib/mini.js`).register();

// Comandos de consola (`./pocketbase pbmini:routes`). Cada callback corre aislado: solo globals y require().
$app.rootCmd.addCommand(new Command({
  use: "pbmini:routes",
  short: "imprime la tabla de rutas de pbmini como JSON",
  run: () => require(`${__hooks}/lib/cli.js`).routes(),
}));
