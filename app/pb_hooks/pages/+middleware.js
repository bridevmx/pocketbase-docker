// Todo requiere sesión, salvo /login y los archivos estáticos.
module.exports = (api, next) => {
  const { auth, request, redirect } = api
  const ruta = request.url.pathname
  if (!auth && ruta !== '/login' && ruta.indexOf('/assets/') !== 0) {
    return redirect('/login', { message: 'Ingresa para continuar' })
  }
  next()
}
