/* Pruebas de multi-cursor y navegacion de llaves con un doble de Monaco.
 *
 * Uso: node tests/cursor.test.js
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

/* Doble minimo de la API de Monaco que usa editor.js. */
function makeFakeMonaco(text, selLine, selCol) {
  var lines = String(text).split("\n");
  function model() {
    return {
      getValue: function () { return lines.join("\n"); },
      getLineCount: function () { return lines.length; },
      getLineContent: function (n) { return lines[n - 1] == null ? "" : lines[n - 1]; },
      getLineMaxColumn: function (n) { return (lines[n - 1] == null ? "" : lines[n - 1]).length + 1; },
      getOffsetAt: function (pos) {
        var off = 0;
        for (var i = 1; i < pos.lineNumber; i++) off += (lines[i - 1] || "").length + 1;
        return off + (pos.column || 1) - 1;
      },
      getPositionAt: function (offset) {
        var remaining = offset, line = 1, col = 1;
        while (line < lines.length && remaining > (lines[line - 1] || "").length) {
          remaining -= (lines[line - 1] || "").length + 1;
          line++;
        }
        return { lineNumber: line, column: remaining + 1 };
      },
      getValueInRange: function (range) {
        return lines[range.startLineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1);
      },
      getLanguageId: function () { return "javascript"; },
      uri: { path: "/test.js", toString: function () { return "file:///test.js"; } },
      onDidChangeContent: function () { return { dispose: function () {} }; }
    };
  }
  var m = model();
  var selections = [{ startLineNumber: selLine || 1, startColumn: selCol || 1, endLineNumber: selLine || 1, endColumn: selCol || 1 }];
  var fakeEditor = {
    getModel: function () { return m; },
    getSelections: function () { return selections.slice(); },
    setSelections: function (s) { selections = s.map(function (x) {
      return {
        startLineNumber: x.startLineNumber, startColumn: x.startColumn,
        endLineNumber: x.endLineNumber, endColumn: x.endColumn
      };
    }); },
    getSelection: function () { return selections[selections.length - 1]; },
    setSelection: function (s) { selections = [s]; },
    getPosition: function () { return { lineNumber: selections[0].startLineNumber, column: selections[0].startColumn }; },
    setPosition: function (p) {
      selections = [{ startLineNumber: p.lineNumber, startColumn: p.column, endLineNumber: p.lineNumber, endColumn: p.column }];
    },
    getAction: function () { return null; },
    focus: function () {},
    onDidChangeCursorSelection: function () { return { dispose: function () {} }; },
    onDidChangeModel: function () { return { dispose: function () {} }; },
    onKeyDown: function () { return { dispose: function () {} }; },
    onDidChangeModelContent: function () { return { dispose: function () {} }; },
    updateOptions: function () {},
    executeEdits: function () { return true; },
    setPosition2: function () {},
    createDecorationsCollection: function () { return { set: function () {}, clear: function () {} }; }
  };
  return {
    editor: {
      getEditors: function () { return [fakeEditor]; },
      getModelMarkers: function () { return []; },
      defineTheme: function () {},
      setTheme: function () {},
      onDidChangeMarkers: function () { return { dispose: function () {} }; }
    },
    editorInstance: fakeEditor
  };
}

(async function main() {
  console.log("\n[1] La API multi-cursor esta expuesta");
  var ctx = dom.createSandbox({});
  var fake = makeFakeMonaco("var valor = 1;\nvar valor = 2;\nvar otro = 3;\n", 2, 5);
  ctx.window.monaco = fake;
  dom.loadApp(ctx);
  await wait(150);
  var U = ctx.window.UriEditor;
  ok(!!U, "UriEditor expuesto");
  ["addCursorAbove", "addCursorBelow", "selectNextOccurrence", "selectAllOccurrences", "goToMatchingBracket"].forEach(function (m) {
    ok(typeof U[m] === "function", "UriEditor." + m + " existe");
  });

  console.log("\n[2] Anadir cursor arriba y abajo");
  var before = fake.editorInstance.getSelections().length;
  var r1 = U.addCursorAbove();
  var afterUp = fake.editorInstance.getSelections().length;
  ok(r1 === true && afterUp === before + 1, "addCursorAbove anade una seleccion (" + before + " -> " + afterUp + ")");
  var r2 = U.addCursorBelow();
  var afterDown = fake.editorInstance.getSelections().length;
  ok(r2 === true && afterDown === afterUp + 1, "addCursorBelow anade una seleccion (" + afterUp + " -> " + afterDown + ")");

  console.log("\n[3] Seleccionar apariciones");
  // Reinicia las selecciones a una sola.
  fake.editorInstance.setSelections([{ startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 10 }]);
  var next = U.selectNextOccurrence();
  var sels = fake.editorInstance.getSelections();
  ok(next === true && sels.length >= 2, "selectNextOccurrence anade la siguiente coincidencia (" + sels.length + ")");

  console.log("\n[4] Ir a la llave correspondente");
  var ctx2 = dom.createSandbox({});
  // Columna 13: el cursor queda justo despues de ")".
  var fake2 = makeFakeMonaco("function f() {\n  return [1, 2];\n}\n", 1, 13);
  ctx2.window.monaco = fake2;
  dom.loadApp(ctx2);
  await wait(150);
  var U2 = ctx2.window.UriEditor;
  var moved = U2.goToMatchingBracket();
  var pos = fake2.editorInstance.getPosition();
  ok(moved === true, "goToMatchingBracket devuelve true");
  ok(pos.lineNumber !== 1 || pos.column !== 13, "el cursor se movio a la llave pareja (linea " + pos.lineNumber + ", col " + pos.column + ")");
  ok(pos.column === 11, "el cursor quedo sobre la llave de apertura (col " + pos.column + ")");

  console.log("\n[5] Sin crash en modo basico (sin Monaco)");
  var ctx3 = dom.createSandbox({});
  dom.loadApp(ctx3);
  await wait(150);
  var U3 = ctx3.window.UriEditor;
  ok(U3.addCursorAbove() === false, "addCursorAbove devuelve false sin Monaco");
  ok(U3.selectNextOccurrence() === false, "selectNextOccurrence devuelve false sin Monaco");
  ok(U3.goToMatchingBracket() === false, "goToMatchingBracket devuelve false sin Monaco");

  console.log("\n[6] Comandos registrados en la paleta");
  var appSrc = require("fs").readFileSync(dom.ROOT + "/editor-web/js/app.js", "utf8");
  ok(appSrc.indexOf("Añadir cursor arriba") >= 0, "el comando 'Anadir cursor arriba' existe");
  ok(appSrc.indexOf("Añadir cursor abajo") >= 0, "el comando 'Anadir cursor abajo' existe");
  ok(appSrc.indexOf("Seleccionar siguiente aparición") >= 0, "el comando 'Seleccionar siguiente aparicion' existe");
  ok(appSrc.indexOf("Seleccionar todas las apariciones") >= 0, "el comando 'Seleccionar todas las apariciones' existe");
  ok(appSrc.indexOf("Ir a llave correspondiente") >= 0, "el comando 'Ir a llave correspondiente' existe");

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
