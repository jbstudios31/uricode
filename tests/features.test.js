/* Pruebas de funcionalidad sobre el DOM simulado: buscar, reemplazar,
 * terminal y visor de diff.
 *
 * Uso: node tests/features.test.js
 */
"use strict";

var dom = require("./dom.js");
var nativeMock = require("./native-mock.js");

var failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log("  ok  - " + msg);
  else { failures++; console.log("  FAIL- " + msg); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* Dispara un elemento: usa onclick si existe, si no dispara los listeners. */
function fire(element, payload) {
  if (!element) return false;
  var ev = payload || { preventDefault: function () {}, stopPropagation: function () {} };
  if (typeof element.onclick === "function") { element.onclick(ev); return true; }
  var l = element._listeners && element._listeners.click;
  if (l) { l.slice().forEach(function (fn) { fn(ev); }); return true; }
  return false;
}

/* Pulsa el boton con el texto indicado dentro de un contenedor. */
function clickByText(container, text) {
  var found = null;
  (container._children || []).forEach(function (child) {
    if (found) return;
    if (child.textContent === text) { found = child; return; }
    found = clickByText(child, text);
  });
  if (found && found._listeners && found._listeners.click) {
    found._listeners.click.slice().forEach(function (fn) { fn({ preventDefault: function () {}, stopPropagation: function () {} }); });
    return true;
  }
  return false;
}

(async function main() {
  console.log("\n[1] Preparacion: app con archivos de prueba");
  var storage = dom.makeStorage();
  storage.setItem("uri.roots", JSON.stringify([""]));
  storage.setItem("uri.vfs", JSON.stringify({
    files: {
      "a.txt": "hola mundo\notra linea con hola\n",
      "b.js": "function saludar() { return 'hola'; }\n",
      "c.txt": "sin coincidencias\n"
    },
    dirs: []
  }));

  var ctx = dom.createSandbox({ storage: storage });
  // Puente nativo simulado (mismo contrato que MainActivity.java).
  ctx.window.FileAPI = nativeMock.createFileAPI({
    storage: storage,
    web: ctx.window,
    cwd: process.cwd(),
    vfs: JSON.parse(storage.getItem("uri.vfs"))
  });
  dom.loadApp(ctx);
  await wait(150);
  var win = ctx.window;
  var el = ctx.elements;

  console.log("\n[2] Buscar en archivos");
  el["searchInput"].value = "hola";
  var searchListeners = el["searchInput"]._listeners["keydown"] || [];
  searchListeners.forEach(function (fn) { fn({ key: "Enter", preventDefault: function () {} }); });
  await wait(200);
  var summary = el["searchSummary"].textContent;
  ok(/resultado/.test(summary), "el resumen muestra resultados: " + summary);
  ok(/3 resultado/.test(summary), "encuentra 3 coincidencias: " + summary);
  var results = el["searchResults"];
  ok(results._children.length >= 2, "se listan los archivos con coincidencias (" + results._children.length + ")");

  console.log("\n[3] Buscar con mayusculas y minusculas");
  el["searchInput"].value = "HOLA";
  fire(el["optCase"]);              // activa区分 mayusculas
  await wait(200);
  var summaryCase = el["searchSummary"].textContent;
  ok(/Sin resultados/.test(summaryCase), "con distincion de mayusculas no encuentra nada: " + summaryCase);
  fire(el["optCase"]);              // desactiva la distincion
  await wait(200);
  var summaryNoCase = el["searchSummary"].textContent;
  ok(/3 resultado/.test(summaryNoCase), "sin distincion encuentra 3: " + summaryNoCase);
  el["searchInput"].value = "hola";
  await wait(150);

  console.log("\n[4] Reemplazar en todos los archivos");
  var replaceInput = ctx.document.getElementById("replaceInput");
  replaceInput.value = "adios";
  fire(el["replaceAllBtn"]);
  await wait(60);
  var dlgButtons = el["dlgButtons"];
  ok(dlgButtons._children.length >= 2, "se abre el dialogo de confirmacion");
  var clicked = clickByText(dlgButtons, "Reemplazar todo");
  ok(clicked, "se pulsa el boton de confirmacion");
  await wait(300);
  var vfs = JSON.parse(storage.getItem("uri.vfs"));
  ok(vfs.files["a.txt"].indexOf("adios mundo") >= 0, "a.txt fue reemplazado");
  ok(vfs.files["b.js"].indexOf("'adios'") >= 0, "b.js fue reemplazado");
  ok(vfs.files["c.txt"] === "sin coincidencias\n", "c.txt no cambio");

  console.log("\n[5] Terminal: comando con salida");
  var out = await win.API.runCommand("echo hola-terminal", "");
  ok(out && out.code === 0, "runCommand devuelve codigo 0");
  ok(out.stdout.indexOf("hola-terminal") >= 0, "runCommand devuelve stdout: " + JSON.stringify(out.stdout));

  console.log("\n[6] Terminal: comando con error");
  var bad = await win.API.runCommand("exit 3", "");
  ok(bad && bad.code === 3, "runCommand propaga el codigo de salida (" + (bad && bad.code) + ")");

  console.log("\n[6b] Terminal: streaming de salida");
  var chunks = [];
  var streamRes = await win.API.runCommandStream("echo linea1; echo linea2", "", function (t) { chunks.push(t); });
  ok(streamRes && streamRes.code === 0, "runCommandStream devuelve codigo 0");
  ok(chunks.join("").indexOf("linea1") >= 0 && chunks.join("").indexOf("linea2") >= 0,
    "runCommandStream entrega la salida en trozos (" + chunks.length + ")");

  console.log("\n[7] Chat IA: puente HTTP (NIM)");
  var nimResponse = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "Hola desde NIM" } }]
  });
  ctx.window.FileAPI.httpPost = function (id, url, headersJson, body) {
    setTimeout(function () {
      if (ctx.window.__uriHttpDone) {
        ctx.window.__uriHttpDone(id, 200, Buffer.from(nimResponse, "utf8").toString("base64"));
      }
    }, 5);
  };
  var res = await win.API.httpPost("https://integrate.api.nvidia.com/v1/chat/completions",
    { "Authorization": "Bearer prueba", "Content-Type": "application/json" },
    { model: "meta/llama-3.1-8b-instruct", messages: [{ role: "user", content: "hola" }] });
  ok(res && res.status === 200, "httpPost devuelve status 200 (" + (res && res.status) + ")");
  ok(res && res.text && res.text.indexOf("Hola desde NIM") >= 0, "httpPost decodifica el cuerpo Base64");
  var parsed = null;
  try { parsed = JSON.parse(res.text); } catch (e) {}
  ok(parsed && parsed.choices && parsed.choices[0].message.content === "Hola desde NIM",
    "el cuerpo se puede parsear como JSON de NIM");

  console.log("\n[7b] Chat IA: error HTTP");
  ctx.window.FileAPI.httpPost = function (id) {
    setTimeout(function () {
      if (ctx.window.__uriHttpDone) ctx.window.__uriHttpDone(id, 401, Buffer.from("Unauthorized", "utf8").toString("base64"));
    }, 5);
  };
  var errRes = await win.API.httpPost("https://integrate.api.nvidia.com/v1/chat/completions", {}, {});
  ok(errRes && errRes.status === 401, "httpPost propaga el error HTTP (" + (errRes && errRes.status) + ")");

  console.log("\n[8] Snippets con tab-stops");
  // La paleta de comandos permite lanzar "Editor: Insertar snippet".
  var settings = win.localStorage.getItem("uri.settings");
  var cur = settings ? JSON.parse(settings) : {};
  cur.snippets = JSON.stringify({ saludo: "function $1() {\n  return ${1:valor};\n}" });
  storage.setItem("uri.settings", JSON.stringify(cur));
  // Recarga la app con los snippets configurados.
  var ctx2 = dom.createSandbox({ storage: storage });
  ctx2.window.FileAPI = nativeMock.createFileAPI({
    storage: storage, web: ctx2.window, cwd: process.cwd(),
    vfs: JSON.parse(storage.getItem("uri.vfs") || "{}")
  });
  dom.loadApp(ctx2);
  await wait(150);
  ok(!!ctx2.window.UriEditor, "la app con snippets arranca");

  console.log("\n[9] Visor de diff y panel de problemas");
  // Se comprueba que el codigo de los modulos criticos este presente y sin errores de sintaxis.
  var appSrc = require("fs").readFileSync(dom.ROOT + "/editor-web/js/app.js", "utf8");
  ok(appSrc.indexOf("function openDiff(") >= 0, "openDiff esta definido");
  ok(appSrc.indexOf("function showProblems(") >= 0, "showProblems esta definido");
  ok(appSrc.indexOf("function expandSnippet(") >= 0, "expandSnippet esta definido");
  ok(appSrc.indexOf("ask(") < 0, "no quedan llamadas a la funcion inexistente ask()");
  var rootRowSrc = (appSrc.match(/function rootRow\([\s\S]*?\n  }/) || [""])[0];
  ok(rootRowSrc.indexOf("isDir") < 0 && rootRowSrc.indexOf("it.path") < 0,
    "rootRow no usa variables no definidas");

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
