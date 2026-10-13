// El SDK interno se conecta a este mismo PocketBase; debe usar el puerto real (PB_PORT).
const port = $os.getenv('PB_PORT') || '8090'

module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    'pocketpages-plugin-auth',
    { name: 'pocketpages-plugin-js-sdk', host: 'http://127.0.0.1:' + port },
  ],
  debug: false,
}
