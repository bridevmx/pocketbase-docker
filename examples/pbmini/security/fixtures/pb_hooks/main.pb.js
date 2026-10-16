const SECRET = "outer-scope-secret";

// 1) INSEGURA a propósito: lee archivo con parámetro sin validar
routerAdd("GET", "/bad/read/{name}", (e) => {
  try { return e.string(200, toString($os.readFile(`${__hooks}/../pb_public/${e.request.pathValue("name")}`))); }
  catch (err) { return e.string(404, "err:" + err); }
});
routerAdd("GET", "/bad/rest/{p...}", (e) => {
  try { return e.string(200, toString($os.readFile(`${__hooks}/../pb_public/${e.request.pathValue("p")}`))); }
  catch (err) { return e.string(404, "err"); }
});
// 2) fileFS con parámetro crudo
routerAdd("GET", "/bad/fs/{p...}", (e) => e.fileFS($os.dirFS(`${__hooks}/../pb_public`), e.request.pathValue("p")));
// 3) $apis.static
routerAdd("GET", "/st/{path...}", $apis.static(`${__hooks}/../pb_public`, false));
// 4) auth por prefijo
routerAdd("GET", "/admin/{$}", (e) => e.string(200, "admin-index"), $apis.requireSuperuserAuth());
routerAdd("GET", "/admin/users", (e) => e.string(200, "admin-users"), $apis.requireSuperuserAuth());
routerAdd("GET", "/admin/open", (e) => e.string(200, "OPEN-no-mw"));          // olvido de middleware
routerAdd("GET", "/area/", (e) => e.string(200, "area:" + e.request.url.path), $apis.requireAuth());
// 5) XSS
routerAdd("GET", "/xss/auto", (e) => e.html(200, $template.loadFiles(`${__hooks}/x.html`).render({ v: e.request.url.query().get("q") })));
routerAdd("GET", "/xss/raw", (e) => e.html(200, $template.loadFiles(`${__hooks}/xr.html`).render({ v: e.request.url.query().get("q") })));
routerAdd("GET", "/xss/concat", (e) => e.html(200, "<p>" + e.request.url.query().get("q") + "</p>"));
// 6) scope aislado
routerAdd("GET", "/scope", (e) => e.string(200, typeof SECRET));
// 7) errores
routerAdd("GET", "/throw", (e) => { throw new Error("db password is hunter2"); });
routerAdd("GET", "/throwapi", (e) => { throw new BadRequestError("safe msg"); });
// 8) body
routerAdd("POST", "/echo", (e) => e.string(200, "len=" + toString(e.request.body).length));
routerAdd("POST", "/echo-lim", (e) => e.string(200, "len=" + toString(e.request.body).length), $apis.bodyLimit(100));
// 9) redirect abierto
routerAdd("GET", "/go", (e) => e.redirect(302, e.request.url.query().get("to")));
