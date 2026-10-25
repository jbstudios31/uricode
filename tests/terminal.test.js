/* Pruebas de la terminal tipo Termux: inicializacion, entrada de comandos,
 * runCommandStream, cd persistente y clear.
 *
 * Uso: node tests/terminal.test.js
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

(function () {
  var storage = dom.makeStorage();
  storage.setItem("uri.roots", JSON.stringify([""]));
  storage.setItem("uri.vfs", JSON.stringify({ files: {}, dirs: [] }));

  var ctx = dom.createSandbox({ storage: storage, narrow: false, innerWidth: 1080 });
  ctx.window.FileAPI = nativeMock.createFileAPI({
    storage: storage, web: ctx.window, cwd: process.cwd(),
    vfs: JSON.parse(storage.getItem("uri.vfs"))
  });

  // Elementos para simular la barra de actividad (setView es local del IIFE).
  var terminalBtn = dom.makeElement("activityTerminal", "button");
  terminalBtn.setAttribute("data-view", "terminal");
  var terminalView = dom.makeElement("view-terminal", "section");
  terminalView.classList = makeClassList();

  var querySelectorAll = ctx.document.querySelectorAll;
  ctx.document.querySelectorAll = function (selector) {
    if (selector === ".ab-item") return [terminalBtn];
    if (selector === ".view") return [terminalView];
    return querySelectorAll.call(this, selector);
  };

  // Mock de xterm.js y FitAddon (antes de cargar la app para que app.js los vea).
  var terminalInput = null;
  var fitCalled = 0;
  var clearCalled = 0;
  ctx.window.Terminal = function (opts) {
    this.write = function (s) { /* no-op */ };
    this.writeln = function (s) { /* no-op */ };
    this.open = function (container) { /* no-op */ };
    this.clear = function () { clearCalled++; };
    this.loadAddon = function (addon) { /* no-op */ };
    this.onData = function (fn) { terminalInput = fn; };
    return this;
  };
  ctx.window.FitAddon = {
    FitAddon: function () {
      this.fit = function () { fitCalled++; };
    }
  };

  dom.loadApp(ctx);
  var win = ctx.window;

  (async function main() {
    await wait(150);

    console.log("\n[1] Inicializacion al abrir vista terminal");
    ok(!!win.Terminal, "Terminal global definido");
    ok(!!win.FitAddon, "FitAddon global definido");

    // Abrir la vista de terminal haciendo clic en el boton de actividad.
    terminalBtn.click();
    await wait(50);

    ok(typeof terminalInput === "function", "el handler onData del terminal esta asignado (initTerminal ejecuto)");

    // fitAddon.fit se llama al abrir la vista.
    ok(fitCalled >= 1, "fitAddon.fit() se invoca al abrir la vista (" + fitCalled + " veces)");

    console.log("\n[2] runCommandStream envia salida al terminal");
    var runStreamCalled = false;
    var origRunCommandStream = win.API.runCommandStream;
    win.API.runCommandStream = function (cmd, cwd, onChunk) {
      runStreamCalled = true;
      if (onChunk) onChunk("salida de prueba\n");
      return Promise.resolve({ code: 0 });
    };

    // Simular que el usuario escribe "echo hola" + Enter.
    if (terminalInput) {
      terminalInput("echo hola");
      terminalInput("\r");
    }
    await wait(50);
    ok(runStreamCalled, "runCommandStream se invoca al enviar un comando");

    // Restaurar original.
    win.API.runCommandStream = origRunCommandStream;

    console.log("\n[3] cd persiste en termCwd");
    var origRunCommand = win.API.runCommand;
    var lastCmd = null;
    win.API.runCommand = function (cmd, cwd) {
      lastCmd = cmd;
      return Promise.resolve({ code: 0, stdout: "/data/app/projects/sub\n", stderr: "" });
    };
    ctx.elements["termCwd"].value = "";
    if (terminalInput) {
      terminalInput("cd sub");
      terminalInput("\r");
    }
    await wait(50);
    ok(/cd sub/.test(lastCmd),
      "se ejecuta cd: " + lastCmd);
    ok(ctx.elements["termCwd"].value === "/data/app/projects/sub",
      "termCwd se actualiza con pwd: " + ctx.elements["termCwd"].value);
    win.API.runCommand = origRunCommand;

    console.log("\n[4] clear limpia el terminal");
    if (terminalInput) {
      terminalInput("clear");
      terminalInput("\r");
    }
    await wait(50);
    ok(clearCalled >= 1, "clear se invoca al escribir 'clear' (" + clearCalled + " veces)");

    console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
    process.exit(failures ? 1 : 0);
  })().catch(function (e) {
    console.error("Error inesperado en las pruebas:", e);
    process.exit(1);
  });
})();
