/* Pruebas de runtime: ejecuta Uri Code en un DOM simulado y verifica que
 * arranca sin errores, que el workspace multi-raiz se dibuja y que las
 * funciones公共 no fallan en tiempo de ejecucion.
 *
 * Uso: node tests/runtime.test.js
 */
"use strict";

var dom = require("./dom.js");

var failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log("  ok  - " + msg);
  else { failures++; console.log("  FAIL- " + msg); }
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function main() {
  console.log("\n[1] Arranque de la app en DOM simulado");
  var storage = dom.makeStorage();
  // Workspace con dos raices: la carpeta de proyectos y una subcarpeta.
  storage.setItem("uri.roots", JSON.stringify(["", "sub"]));
  // Archivos de prueba en el sistema de archivos virtual.
  storage.setItem("uri.vfs", JSON.stringify({
    files: { "sub/app.js": "var a = 1;\n", "sub/notes.txt": "hola" },
    dirs: ["sub"]
  }));

  var ctx = dom.createSandbox({ storage: storage });
  var threw = null;
  try { dom.loadApp(ctx); } catch (e) { threw = e; }
  ok(!threw, "los scripts se cargan sin lanzar excepciones" + (threw ? " -> " + threw.message : ""));
  if (threw && process.env.VERBOSE) console.log(threw.stack);

  await wait(150);

  var win = ctx.window;
  ok(!!win.UriEditor, "UriEditor expuesto");
  ok(!!win.API, "API expuesto");
  ok(!!win.UriLSP, "UriLSP expuesto");
  ok(!!win.UriDebug, "UriDebug expuesto");
  ok(!!win.UriExtensions, "UriExtensions expuesto");
  ok(!!win.Icons, "Icons expuesto");

  console.log("\n[2] Sin errores en los avisos (toast)");
  var toastEl = ctx.elements["toast"];
  var toastText = toastEl && toastEl.textContent ? toastEl.textContent : "";
  ok(toastText.indexOf("Error") < 0, "no hay avisos de error: " + (toastText || "(ninguno)"));

  console.log("\n[3] Explorador multi-raiz");
  var tree = ctx.elements["tree"];
  ok(!!tree, "existe el contenedor del arbol");
  var treeChildren = tree ? tree._children.length : 0;
  ok(treeChildren >= 2, "el arbol dibuja al menos las 2 raices (" + treeChildren + " nodos)");
  var rows = tree ? tree._children : [];
  var rootRows = rows.filter(function (r) { return r._attrs["data-root"] === "1"; });
  ok(rootRows.length === 2, "se dibujan 2 filas de raiz (" + rootRows.length + ")");
  ok(rootRows.some(function (r) { return r._attrs["data-path"] === ""; }), "esta la raiz principal");
  ok(rootRows.some(function (r) { return r._attrs["data-path"] === "sub"; }), "esta la raiz 'sub'");
  var labels = rootRows.map(function (r) {
    var el = r.querySelector ? r.querySelector(".label") : null;
    return el ? el.textContent : "";
  });
  ok(labels.filter(Boolean).length === 2, "las filas de raiz muestran su nombre (" + labels.join(", ") + ")");
  var childRows = rows.filter(function (r) { return r._attrs["data-root"] !== "1"; });
  ok(childRows.length >= 2, "se dibujan los hijos de las raices (" + childRows.length + ")");

  console.log("\n[4] API de archivos");
  var list = await win.API.listDir("");
  ok(Array.isArray(list), "listDir devuelve una lista");
  var sub = await win.API.listDir("sub");
  ok(sub.length === 2, "listDir('sub') devuelve 2 elementos (" + sub.length + ")");
  var exists = await win.API.exists("sub/app.js");
  ok(exists === true, "exists('sub/app.js') es true");

  console.log("\n[5] Extensiones");
  if (win.UriExtensions) {
    var cmds = win.UriExtensions.getCommands();
    ok(cmds.some(function (c) { return c.id === "sample.hello"; }), "la extension de ejemplo registro su comando");
    ok(win.UriExtensions.runCommand("sample.hello"), "el comando de la extension se ejecuta");
  }

  console.log("\n[6] Depuracion");
  if (win.UriDebug) {
    win.UriDebug.setBreakpoint("sub/app.js", 1);
    var bps = win.UriDebug.getBreakpoints();
    ok(bps.length === 1 && bps[0].line === 1, "el breakpoint se guarda");
    win.UriDebug.removeBreakpoint("sub/app.js", 1);
    ok(win.UriDebug.getBreakpoints().length === 0, "el breakpoint se elimina");
  }

  console.log("\n[7] LSP");
  if (win.UriLSP) {
    var conn = await win.UriLSP.connect("javascript");
    ok(conn && conn.adapter === "monaco-ts", "el adaptador JS/TS es monaco-ts");
    ok(win.UriLSP.isConnected("javascript"), "el adaptador queda conectado");
  }

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
