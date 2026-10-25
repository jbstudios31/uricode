/* Pruebas de la vista de Ajustes: que no quede vacia al abrirla y que
 * refreshSettingsUI se auto-recupere si faltan controles renderizados.
 *
 * Uso: node tests/settings-view.test.js
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

(function () {
  var storage = dom.makeStorage();

  var ctx = dom.createSandbox({ storage: storage });

  // Elementos para simular la barra de actividad (setView es local del IIFE).
  var settingsBtn = dom.makeElement("activitySettings", "button");
  settingsBtn.setAttribute("data-view", "settings");
  var settingsView = dom.makeElement("view-settings", "section");
  settingsView.classList = {
    add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; }
  };

  var querySelectorAll = ctx.document.querySelectorAll;
  ctx.document.querySelectorAll = function (selector) {
    if (selector === ".ab-item") return [settingsBtn];
    if (selector === ".view") return [settingsView];
    return querySelectorAll.call(this, selector);
  };

  dom.loadApp(ctx);
  var win = ctx.window;
  var el = ctx.elements;

  (async function main() {
    await wait(150);

    console.log("\n[1] Abrir vista de ajustes renderiza controles");
    ok(!!el.settingsContent, "existe #settingsContent");

    // Simular que la vista quedo vacia (como reporta el usuario).
    el.settingsContent.innerHTML = "";
    ok(el.settingsContent._children.length === 0, "settingsContent vaciado manualmente");

    // Abrir la vista de ajustes haciendo clic en el boton de actividad.
    settingsBtn.click();
    await wait(50);

    var afterChildren = el.settingsContent._children.length;
    ok(afterChildren > 0, "setView('settings') renderiza controles (" + afterChildren + " secciones)");
    ok(afterChildren >= 5, "se renderizan las 5 categorias (" + afterChildren + ")");

    console.log("\n[2] Los controles reflejan S.settings");
    var setTabSize = el.setTabSize;
    ok(!!setTabSize, "existe el control #setTabSize");
    ok(setTabSize.value === "4",
      "el valor del control coincide con el defecto (4), obtuvo: " + setTabSize.value);

    var setTheme = el.setTheme;
    ok(!!setTheme, "existe el control #setTheme");
    ok(setTheme.value === "dark",
      "el tema coincide con el defecto (dark), obtuvo: " + setTheme.value);

    console.log("\n[3] refreshSettingsUI se auto-recupera si faltan controles");
    if (setTabSize) setTabSize.remove ? setTabSize.remove() : null;
    win.UriCodeSettings.refreshSettingsUI();
    await wait(20);
    var recovered = el.settingsContent._children.length > 0;
    ok(recovered, "refreshSettingsUI recupera el render si faltan controles (" + el.settingsContent._children.length + " secciones)");

    console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
    process.exit(failures ? 1 : 0);
  })().catch(function (e) {
    console.error("Error inesperado en las pruebas:", e);
    process.exit(1);
  });
})();
