"use strict";

var dom = require("./dom.js");

var failures = 0, checks = 0;
function ok(condition, message) {
  checks++;
  if (condition) console.log("  ok  - " + message);
  else { failures++; console.log("  FAIL- " + message); }
}
function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function descendants(element) {
  var result = [];
  (element._children || []).forEach(function (child) {
    result.push(child);
    result = result.concat(descendants(child));
  });
  return result;
}
function settingRows(container) {
  return descendants(container).filter(function (element) {
    return element._attrs["data-setting-id"] && element.className.indexOf("setting-item") >= 0;
  });
}
function keybindingInputs(container) {
  return descendants(container).filter(function (element) {
    return element._attrs["data-command"] && element.className.indexOf("keybinding-input") >= 0;
  });
}

(async function main() {
  console.log("\n[1] Renderizado del editor de ajustes");
  var storage = dom.makeStorage();
  var ctx = dom.createSandbox({ storage: storage });
  dom.loadApp(ctx);
  await wait(150);

  var win = ctx.window;
  var elements = ctx.elements;
  var content = elements.settingsContent;
  var sections = (content._children || []).filter(function (element) {
    return element._attrs["data-category"];
  });
  var rows = settingRows(content);

  ok(!!elements.setSearch, "el buscador #setSearch está disponible");
  ok(sections.length === 5, "se renderizan las cinco categorías (" + sections.length + ")");
  ok((elements.settingsCategories._children || []).length === 5, "la navegación lateral muestra cinco categorías");
  ok(rows.length >= 15, "la lista declarativa renderiza los ajustes (" + rows.length + ")");
  ok(!!elements.setTabSize && !!elements.setInsertSpaces && !!elements.setRenderWhitespace,
    "los ajustes nuevos del editor están disponibles");
  ok(typeof win.UriEditor.formatDocument === "function", "UriEditor.formatDocument está expuesto");

  console.log("\n[2] Filtrado por nombre y descripción");
  elements.setSearch.value = "tabSize";
  elements.setSearch.oninput({ target: elements.setSearch });
  var filteredRows = settingRows(content);
  ok(filteredRows.length === 1 && filteredRows[0]._attrs["data-setting-id"] === "tabSize",
    "la búsqueda filtra la lista de ajustes");
  elements.setSearch.value = "carácter de tabulación";
  elements.setSearch.oninput({ target: elements.setSearch });
  filteredRows = settingRows(content);
  ok(filteredRows.length === 1 && filteredRows[0]._attrs["data-setting-id"] === "insertSpaces",
    "la búsqueda también filtra por descripción");

  console.log("\n[3] Persistencia de un cambio");
  var tabSize = elements.setTabSize;
  tabSize.value = "8";
  tabSize.onchange({ target: tabSize });
  var savedSettings = JSON.parse(storage.getItem("uri.settings") || "{}");
  ok(savedSettings.tabSize === 8, "el cambio se guarda en uri.settings");

  console.log("\n[4] Atajo reconfigurable");
  var keyStorage = dom.makeStorage();
  keyStorage.setItem("uri.keybindings", JSON.stringify([
    { command: "file.goToFile", key: "Ctrl+K" }
  ]));
  var keyCtx = dom.createSandbox({ storage: keyStorage });
  dom.loadApp(keyCtx);
  await wait(150);

  var bindings = keyCtx.window.UriCodeSettings.getKeybindings();
  var quickOpen = bindings.filter(function (binding) { return binding.command === "file.goToFile"; })[0];
  ok(!!quickOpen && quickOpen.key === "Ctrl+K", "el atajo personalizado queda registrado");
  var storedBindings = JSON.parse(keyStorage.getItem("uri.keybindings") || "[]");
  ok(Array.isArray(storedBindings) && storedBindings[0].command === "file.goToFile" && storedBindings[0].key === "Ctrl+K",
    "el atajo se guarda como {command, key}");

  var prevented = false;
  var listeners = keyCtx.window._l.keydown || [];
  listeners.forEach(function (listener) {
    listener({
      key: "k",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      target: keyCtx.document.body,
      preventDefault: function () { prevented = true; },
      stopPropagation: function () {}
    });
  });
  ok(prevented && keyCtx.document.body.classList.contains("palette-open"),
    "bindKeys ejecuta la acción con la nueva combinación");

  var quickInput = keybindingInputs(keyCtx.elements.settingsContent).filter(function (element) {
    return element._attrs["data-command"] === "file.goToFile";
  })[0];
  quickInput.value = "";
  quickInput.onchange({ target: quickInput });
  var restored = keyCtx.window.UriCodeSettings.getKeybindings().filter(function (binding) {
    return binding.command === "file.goToFile";
  })[0];
  ok(restored && restored.key === "Ctrl+P", "al borrar el atajo se restaura el predeterminado");
  ok(keyStorage.getItem("uri.keybindings") === "[]", "el atajo borrado se elimina de uri.keybindings");

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (error) {
  console.error("Error inesperado en las pruebas:", error);
  process.exit(1);
});
