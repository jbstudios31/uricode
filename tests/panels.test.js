"use strict";

var fs = require("fs");
var dom = require("./dom.js");
var nativeMock = require("./native-mock.js");

var failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log("  ok  - " + msg);
  else { failures++; console.log("  FAIL- " + msg); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function makeClassList() {
  var state = {};
  return {
    add: function (c) { state[c] = true; },
    remove: function (c) { delete state[c]; },
    toggle: function (c, force) {
      if (force === undefined) force = !state[c];
      if (force) state[c] = true; else delete state[c];
      return force;
    },
    contains: function (c) { return !!state[c]; }
  };
}
function fire(element) {
  if (!element) return false;
  var event = { preventDefault: function () {}, stopPropagation: function () {}, target: element };
  if (typeof element.onclick === "function") { element.onclick(event); return true; }
  var listeners = element._listeners && element._listeners.click;
  if (!listeners || !listeners.length) return false;
  listeners.slice().forEach(function (fn) { fn(event); });
  return true;
}

(async function main() {
  console.log("\n[1] Markup de los paneles");
  var html = fs.readFileSync(dom.ROOT + "/editor-web/index.html", "utf8");
  var css = fs.readFileSync(dom.ROOT + "/editor-web/css/style.css", "utf8");
  ok(html.indexOf('id="view-problems"') >= 0, "index.html contiene #view-problems");
  ok(html.indexOf('id="view-output"') >= 0, "index.html contiene #view-output");
  ok(html.indexOf('data-view="problems"') >= 0, "la barra de actividad incluye el boton de problemas");
  ok(css.indexOf(".problem-row") >= 0 && css.indexOf(".output-line") >= 0,
    "el CSS incluye estilos para problemas y output");

  console.log("\n[2] Preparacion: app con problemas simulados");
  var storage = dom.makeStorage();
  storage.setItem("uri.roots", JSON.stringify([""]));
  storage.setItem("uri.vfs", JSON.stringify({
    files: { "problem.js": "const value = 1;\n" },
    dirs: []
  }));

  var markers = [
    {
      resource: { path: "/problem.js" },
      severity: 8,
      startLineNumber: 3,
      startColumn: 7,
      endLineNumber: 3,
      endColumn: 10,
      message: "Variable no definida"
    },
    {
      resource: { path: "/problem.js" },
      severity: 4,
      startLineNumber: 8,
      startColumn: 2,
      endLineNumber: 8,
      endColumn: 5,
      message: "Valor sin usar"
    }
  ];

  var ctx = dom.createSandbox({ storage: storage });
  ctx.window.monaco = {
    editor: {
      getModelMarkers: function () { return markers; }
    }
  };

  var activityProblems = dom.makeElement("activityProblems", "button");
  activityProblems.setAttribute("data-view", "problems");
  activityProblems.classList = makeClassList();
  var activityOutput = dom.makeElement("activityOutput", "button");
  activityOutput.setAttribute("data-view", "output");
  activityOutput.classList = makeClassList();
  var activityTerminal = dom.makeElement("activityTerminal", "button");
  activityTerminal.setAttribute("data-view", "terminal");
  activityTerminal.classList = makeClassList();
  var problemsView = ctx.document.getElementById("view-problems");
  problemsView.classList = makeClassList();
  var outputView = ctx.document.getElementById("view-output");
  outputView.classList = makeClassList();
  var terminalView = ctx.document.getElementById("view-terminal");
  terminalView.classList = makeClassList();

  var querySelectorAll = ctx.document.querySelectorAll;
  ctx.document.querySelectorAll = function (selector) {
    if (selector === ".ab-item") return [activityProblems, activityOutput, activityTerminal];
    if (selector === ".view") return [problemsView, outputView, terminalView];
    return querySelectorAll.call(this, selector);
  };

  ctx.window.FileAPI = nativeMock.createFileAPI({
    storage: storage,
    web: ctx.window,
    cwd: process.cwd(),
    vfs: JSON.parse(storage.getItem("uri.vfs"))
  });

  var terminalInput = null;
  ctx.window.Terminal = function () {
    this.write = function () {};
    this.writeln = function () {};
    this.open = function () {};
    this.clear = function () {};
    this.onData = function (fn) { terminalInput = fn; };
  };

  dom.loadApp(ctx);
  await wait(250);
  var win = ctx.window;

  console.log("\n[3] Vista de problemas");
  ok(!!win.UriCodePanels, "la API de paneles está expuesta");
  activityProblems.click();
  ok(problemsView.classList.contains("active"), "el boton de actividad abre PROBLEMAS");
  win.UriCodePanels.refreshProblems();
  var problems = ctx.elements["problemsList"];
  ok(!!problems && problems._children.length === 2, "la vista lista los dos marcadores");
  var problemHtml = problems._children.map(function (row) { return row._html || ""; }).join(" ");
  ok(problemHtml.indexOf("problem.js") >= 0, "la fila muestra el nombre del archivo");
  ok(problemHtml.indexOf("3:7") >= 0 && problemHtml.indexOf("8:2") >= 0, "las filas muestran linea y columna");
  ok(problemHtml.indexOf("problem-severity error") >= 0 && problemHtml.indexOf("problem-severity warning") >= 0,
    "las filas muestran iconos de error y warning");
  ok(problemHtml.indexOf("Variable no definida") >= 0 && problemHtml.indexOf("Valor sin usar") >= 0,
    "las filas muestran el mensaje del marcador");

  console.log("\n[4] Navegacion desde un problema");
  var navigation = null;
  var originalGotoLine = win.UriEditor.gotoLine;
  win.UriEditor.gotoLine = function (line, col, len) {
    navigation = { line: line, col: col, len: len };
    return originalGotoLine.apply(this, arguments);
  };
  fire(problems._children[0]);
  await wait(100);
  ok(!!navigation, "el clic de una fila navega al archivo");
  ok(navigation && navigation.line === 3 && navigation.col === 7 && navigation.len === 3,
    "la navegacion selecciona el rango del marcador: " + JSON.stringify(navigation));

  console.log("\n[5] Actualizacion por marcadores");
  markers = [];
  win.UriCodePanels.onMarkers({ errors: 0, warnings: 0 });
  ok(problems._children.length === 1 && problems._children[0].textContent.indexOf("No hay problemas") >= 0,
    "la vista se actualiza cuando desaparecen los marcadores");
  markers = [{
    resource: { path: "/problem.js" },
    severity: 4,
    startLineNumber: 4,
    startColumn: 1,
    endLineNumber: 4,
    endColumn: 2,
    message: "Problema de la pestana activa"
  }];
  fire(ctx.elements.tabs._children[0]);
  await wait(50);
  var activeTabHtml = problems._children.map(function (row) { return row._html || ""; }).join(" ");
  ok(problems._children.length === 1 && activeTabHtml.indexOf("Problema de la pestana activa") >= 0,
    "la vista se actualiza al cambiar de pestana activa");

  console.log("\n[6] Vista de output");
  activityOutput.click();
  ok(outputView.classList.contains("active"), "el boton de actividad abre OUTPUT");
  var output = ctx.elements["outputLog"];
  ok(!!output && output._children.length > 0, "el output registra eventos de arranque");

  // Iniciar shell interactivo en la terminal (abre la vista terminal).
  activityTerminal.click();
  await wait(100);
  ok(typeof ctx.window.__uriShellData === "function", "el shell interactivo se inicio (__uriShellData definido)");

  fire(ctx.elements.checkUpdate);
  if (terminalInput) {
    "echo panel-terminal\r".split("").forEach(function (ch) { terminalInput(ch); });
  }
  ctx.elements.chatInput.value = "error de chat";
  fire(ctx.elements.chatSend);
  await wait(80);
  var outputText = output._children.map(function (line) { return line.textContent; }).join("\n");
  ok(/App start/.test(outputText) && /Editor mode/.test(outputText) && /Extensions loaded/.test(outputText),
    "el output registra inicio, modo del editor y extensiones");
  ok(/Update check result/.test(outputText), "el output registra el resultado de actualizar");
  ok(/Chat error/.test(outputText), "el output registra los errores del chat");
  win.UriCodePanels.log("evento de prueba");
  var lastLine = output._children[output._children.length - 1];
  ok(!!lastLine && lastLine.textContent.indexOf("evento de prueba") >= 0,
    "el helper log() agrega una linea al output");
  ok(!!lastLine && /^\[\d{2}:\d{2}:\d{2}\]/.test(lastLine.textContent),
    "las lineas del output incluyen timestamp");

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
