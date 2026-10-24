/* Smoke tests de Uri Code.
 * Comprueba que todos los scripts del editor no tienen errores de sintaxis
 * y que los módulos clave existen y exponen su API.
 *
 * Uso: node tests/smoke.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.resolve(__dirname, "..");
var JS_DIR = path.join(ROOT, "editor-web", "js");
var EXT_DIR = path.join(ROOT, "editor-web", "extensions");

var failures = 0;
var checks = 0;

function ok(cond, msg) {
  checks++;
  if (cond) { console.log("  ok  - " + msg); }
  else { failures++; console.log("  FAIL- " + msg); }
}

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return f.endsWith(".js"); })
    .map(function (f) { return path.join(dir, f); });
}

/* 1. Sintaxis de todos los scripts. */
console.log("\n[1] Sintaxis JS");
var files = listJs(JS_DIR).concat(listJs(EXT_DIR));
ok(files.length > 0, "se encontraron scripts para comprobar (" + files.length + ")");
files.forEach(function (f) {
  var src = fs.readFileSync(f, "utf8");
  var valid = true, err = "";
  try { new vm.Script(src, { filename: f }); }
  catch (e) { valid = false; err = e.message; }
  ok(valid, "sintaxis válida: " + path.relative(ROOT, f) + (valid ? "" : " -> " + err));
});

/* 2. Carga de módulos en un contexto de navegador simulado. */
console.log("\n[2] Carga de módulos");
function loadInSandbox(file, extraGlobals) {
  var sandbox = {
    window: {}, document: {
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; },
      addEventListener: function () {}
    },
    localStorage: {
      _d: {},
      getItem: function (k) { return this._d[k] || null; },
      setItem: function (k, v) { this._d[k] = String(v); }
    },
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, JSON: JSON, Math: Math, Date: Date, Object: Object,
    Array: Array, String: String, Number: Number, Error: Error, RegExp: RegExp,
    Uint8Array: Uint8Array, TextDecoder: typeof TextDecoder !== "undefined" ? TextDecoder : undefined,
    monaco: undefined, atob: function (s) { return s; },
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.self = sandbox.window;
  sandbox.self = sandbox.window;
  sandbox.globalThis = sandbox.window;
  Object.keys(extraGlobals || {}).forEach(function (k) { sandbox.window[k] = extraGlobals[k]; });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window;
}

function checkModule(file, globalName) {
  var exists = fs.existsSync(file);
  ok(exists, "existe " + path.relative(ROOT, file));
  if (!exists) return null;
  var win = loadInSandbox(file, {});
  ok(typeof win[globalName] === "object", "expone window." + globalName);
  return win[globalName];
}

var ext = checkModule(path.join(EXT_DIR, "..", "js", "extensions.js"), "UriExtensions");
if (ext) {
  ext.loadManifest({ id: "t1", name: "Test", version: "1.0", main: function (api) { api.registerCommand("t1.run", function () {}); } });
  ok(ext.activate("t1"), "activar extensión");
  var contribs = ext.getContributions();
  ok(contribs.extensions.some(function (e) { return e.id === "t1"; }), "extensión listada en contribuciones");
  ok(ext.getCommands().some(function (c) { return c.id === "t1.run"; }), "comando registrado");
  ok(ext.runCommand("t1.run"), "ejecutar comando");
  ok(ext.deactivate("t1"), "desactivar extensión");
}

var lsp = checkModule(path.join(JS_DIR, "lsp.js"), "UriLSP");
if (lsp) {
  ok(typeof lsp.registerServer === "function", "LSP: registerServer");
  ok(typeof lsp.connect === "function", "LSP: connect");
  ok(typeof lsp.provideCompletions === "function", "LSP: provideCompletions");
}

var dbg = checkModule(path.join(JS_DIR, "debug.js"), "UriDebug");
if (dbg) {
  ok(typeof dbg.setBreakpoint === "function", "Debug: setBreakpoint");
  ok(Array.isArray(dbg.getBreakpoints()), "Debug: getBreakpoints devuelve lista");
}

/* 3. Recursos de la interfaz. */
console.log("\n[3] Recursos");
var html = fs.readFileSync(path.join(ROOT, "editor-web", "index.html"), "utf8");
["termContainer", "replaceAllBtn", "diff-backdrop", "setTheme", "testAi", "debugPanel", "view-debug"].forEach(function (id) {
  ok(html.indexOf('id="' + id + '"') >= 0, "index.html contiene #" + id);
});
ok(fs.existsSync(path.join(ROOT, "editor-web", "vendor", "monaco", "vs", "loader.js")), "Monaco offline presente");

/* 4. Orden de carga de scripts. */
console.log("\n[4] Orden de scripts");
function scriptPos(src) { return html.indexOf('src="' + src + '"'); }
var order = ["js/icons.js", "js/api.js", "js/editor.js", "js/nim-chat.js", "js/lsp.js", "js/debug.js", "js/extensions.js", "extensions/sample.js", "js/app.js"];
var lastPos = -1, orderOk = true;
order.forEach(function (src) {
  var pos = scriptPos(src);
  if (pos < 0) { orderOk = false; ok(false, "script presente: " + src); return; }
  if (pos < lastPos) orderOk = false;
  lastPos = pos;
});
ok(orderOk, "scripts cargados en el orden correcto (app.js al final)");

/* 5. Clasificación de adaptadores LSP (asíncrono). */
console.log("\n[5] Adaptadores LSP");
var lspChecks = Promise.resolve();
if (lsp) {
  var lspWin = loadInSandbox(path.join(JS_DIR, "lsp.js"), {});
  var L = lspWin.UriLSP;
  lspChecks = ["javascript", "typescript", "json"].reduce(function (chain, lang) {
    return chain.then(function () {
      L.registerServer(lang, { command: "monaco" });
      return L.connect(lang).then(function (conn) {
        ok(conn.adapter === "monaco-ts", "LSP: " + lang + " usa el adaptador monaco-ts");
      });
    });
  }, Promise.resolve()).then(function () {
    L.registerServer("python", { command: "pylsp" });
    return L.connect("python").then(function (conn) {
      ok(conn.adapter === "empty", "LSP: python usa el adaptador empty");
    });
  });
}

/* 6. Las extensiones desactivadas retiran sus comandos. */
console.log("\n[6] Ciclo de vida de extensiones");
if (ext) {
  ext.loadManifest({ id: "t2", name: "T2", version: "1.0", main: function (api) { api.registerCommand("t2.run", function () {}); } });
  ext.activate("t2");
  ok(ext.getCommands().some(function (c) { return c.id === "t2.run"; }), "comando t2.run registrado");
  ext.deactivate("t2");
  ok(!ext.getCommands().some(function (c) { return c.id === "t2.run"; }), "comando t2.run retirado al desactivar");
}

lspChecks.then(function () {
  /* 7. Analisis estatico: llamadas a funciones que no existen. */
console.log("\n[7] Llamadas a funciones inexistentes");
var GLOBALS = {
  "if": 1, "for": 1, "while": 1, "switch": 1, "catch": 1, "return": 1, "function": 1,
  "typeof": 1, "new": 1, "delete": 1, "in": 1, "do": 1, "else": 1, "case": 1, "try": 1,
  "Array": 1, "Object": 1, "String": 1, "Number": 1, "Boolean": 1, "Math": 1, "JSON": 1,
  "Date": 1, "Promise": 1, "RegExp": 1, "Error": 1, "TypeError": 1, "RangeError": 1,
  "Map": 1, "Set": 1, "parseInt": 1, "parseFloat": 1, "isNaN": 1, "encodeURIComponent": 1,
  "decodeURIComponent": 1, "setTimeout": 1, "clearTimeout": 1, "setInterval": 1,
  "clearInterval": 1, "requestAnimationFrame": 1, "cancelAnimationFrame": 1, "queueMicrotask": 1,
  "console": 1, "window": 1, "document": 1, "monaco": 1, "API": 1, "UriEditor": 1, "Chat": 1,
  "Icons": 1, "UriLSP": 1, "UriDebug": 1, "UriExtensions": 1, "require": 1, "process": 1,
  "TextDecoder": 1, "TextEncoder": 1, "Uint8Array": 1, "URL": 1, "Blob": 1, "FileReader": 1, "Terminal": 1,
  "atob": 1, "btoa": 1, "navigator": 1, "location": 1, "matchMedia": 1, "getComputedStyle": 1,
  "AbortController": 1, "Event": 1, "Function": 1, "Symbol": 1, "Proxy": 1,
  "Buffer": 1, "fetch": 1, "self": 1, "globalThis": 1, "undefined": 1, "NaN": 1
};
function declaredNames(src) {
  var names = {};
  var m;
  var re1 = /function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re1.exec(src))) names[m[1]] = 1;
  // var/const/let, con o sin inicializador
  var re2 = /\b(?:var|const|let)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re2.exec(src))) names[m[1]] = 1;
  // parametros de funciones: function f(a, b) y function (a, b)
  var re3 = /function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g;
  while ((m = re3.exec(src))) {
    m[1].split(",").forEach(function (p) {
      p = p.trim().replace(/^\.\.\./, "");
      var pm = /^([A-Za-z_$][\w$]*)/.exec(p);
      if (pm) names[pm[1]] = 1;
    });
  }
  return names;
}
function collectDeclared(dir) {
  var all = {};
  listJs(dir).forEach(function (f) {
    var d = declaredNames(fs.readFileSync(f, "utf8"));
    Object.keys(d).forEach(function (k) { all[k] = 1; });
  });
  return all;
}
var declared = collectDeclared(JS_DIR);
declared = Object.assign(declared, collectDeclared(EXT_DIR));
Object.keys(GLOBALS).forEach(function (k) { declared[k] = 1; });

var appSrc = fs.readFileSync(path.join(JS_DIR, "app.js"), "utf8");
var otherFiles = listJs(JS_DIR).concat(listJs(EXT_DIR)).filter(function (f) { return path.basename(f) !== "app.js"; });
/* Quita cadenas y comentarios para evitar falsos positivos. */
function stripLiterals(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^\\])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/(?:\\.|[^\/\\\n])+\/[gimuy]*/g, " 0 ");
}
appSrc = stripLiterals(appSrc);
var callRe = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g, cm, missing = {};
while ((cm = callRe.exec(appSrc))) {
  var name = cm[2];
  if (!declared[name]) missing[name] = (missing[name] || 0) + 1;
}
var missingNames = Object.keys(missing);
ok(missingNames.length === 0, "app.js no llama a funciones inexistentes" +
  (missingNames.length ? ": " + missingNames.join(", ") : ""));

otherFiles.forEach(function (f) {
  var src = stripLiterals(fs.readFileSync(f, "utf8"));
  var re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g, mm, miss = {};
  while ((mm = re.exec(src))) {
    var n = mm[2];
    if (!declared[n]) miss[n] = 1;
  }
  var names = Object.keys(miss);
  ok(names.length === 0, path.basename(f) + " no llama a funciones inexistentes" +
    (names.length ? ": " + names.join(", ") : ""));
});

console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
});
