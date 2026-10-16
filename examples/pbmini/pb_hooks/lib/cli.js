// Comandos de consola (corren en un proceso aparte del `serve`; PocketBase carga también los hooks, así que
// si alguna página es inválida el registro aborta antes de llegar aquí: es el comportamiento fail-closed deseado).
//   ./pocketbase pbmini:routes     imprime la tabla de rutas como JSON entre marcadores (la usa el fuzzer guiado y los tipos)
const MARK = "PBMINI_ROUTES_JSON";
function routes() {
  const t = require(`${__hooks}/lib/mini.js`).routeTable();
  console.log(MARK + "_BEGIN\n" + JSON.stringify(t) + "\n" + MARK + "_END");
}
module.exports = { routes };
