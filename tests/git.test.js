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
async function waitFor(predicate, timeout) {
  var deadline = Date.now() + (timeout || 1000);
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(5);
  }
  return predicate();
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
function clickByText(container, text) {
  var found = (container._children || []).filter(function (child) {
    return child.textContent === text;
  })[0];
  if (!found) return false;
  return fire(found);
}
function rowsOf(list) {
  return (list._children || []).filter(function (child) {
    return child.getAttribute("data-git-entry") === "1";
  });
}

(async function main() {
  console.log("\n[1] Parser del estado porcelain");
  var storage = dom.makeStorage();
  storage.setItem("uri.roots", JSON.stringify([""]));
  storage.setItem("uri.vfs", JSON.stringify({
    files: { "src/edited.js": "const edited = true;\n" },
    dirs: ["src"]
  }));

  var ctx = dom.createSandbox({ storage: storage });
  ctx.window.FileAPI = nativeMock.createFileAPI({
    storage: storage,
    web: ctx.window,
    cwd: process.cwd(),
    vfs: JSON.parse(storage.getItem("uri.vfs"))
  });
  dom.loadApp(ctx);
  var win = ctx.window;
  var el = ctx.elements;
  await win.UriEditor.ready();
  ok(!!win.UriGit && typeof win.UriGit.parseStatus === "function", "UriGit.parseStatus está expuesto");

  var porcelain = [
    " M src/edited.js",
    "M  src/staged.js",
    "A  src/added.js",
    " D src/deleted.js",
    "?? src/new.js",
    "MM src/both.js",
    "RM \"old name.txt\" -> \"new name.txt\"",
    "?? \"with space.txt\""
  ].join("\n");
  var entries = win.UriGit.parseStatus(porcelain);

  ok(entries.length === 10, "MM y RM generan una entrada por área (" + entries.length + ")");
  var edited = entries.filter(function (entry) { return entry.path === "src/edited.js"; })[0];
  ok(!!edited && edited.staged === false && edited.status === "M" && edited.kind === "modified",
    "un cambio en el árbol de trabajo queda sin preparar");
  var staged = entries.filter(function (entry) { return entry.path === "src/staged.js"; })[0];
  ok(!!staged && staged.staged === true && staged.status === "M",
    "un cambio en el índice queda preparado");
  var added = entries.filter(function (entry) { return entry.path === "src/added.js"; })[0];
  ok(!!added && added.kind === "added" && added.staged === true,
    "una entrada A se identifica como archivo añadido");
  var deleted = entries.filter(function (entry) { return entry.path === "src/deleted.js"; })[0];
  ok(!!deleted && deleted.kind === "deleted" && deleted.staged === false,
    "una entrada D se identifica como archivo eliminado");
  var untracked = entries.filter(function (entry) { return entry.path === "src/new.js"; })[0];
  ok(!!untracked && untracked.kind === "untracked" && untracked.status === "?",
    "una entrada ?? se identifica como archivo no rastreado");
  var both = entries.filter(function (entry) { return entry.path === "src/both.js"; });
  ok(both.length === 2 && both.some(function (entry) { return entry.staged; }) && both.some(function (entry) { return !entry.staged; }),
    "MM muestra cambios preparados y sin preparar");
  var renamed = entries.filter(function (entry) { return entry.path === "new name.txt"; });
  ok(renamed.length === 2 && renamed[0].status === "R" && renamed[1].status === "M",
    "RM usa la ruta nueva y conserva ambos estados");
  var spaced = entries.filter(function (entry) { return entry.path === "with space.txt"; })[0];
  ok(!!spaced, "se decodifican las rutas entrecomilladas de Git");

  console.log("\n[2] Panel de control de versiones");
  var calls = [];
  win.API.runCommand = function (cmd, cwd) {
    calls.push({ cmd: cmd, cwd: cwd });
    var stdout = "";
    if (cmd === "git status --porcelain") stdout = porcelain;
    else if (cmd === "git branch --show-current") stdout = "main\n";
    else if (cmd === "git branch --all") stdout = "* main\n  feature/demo\n";
    else if (cmd === "git rev-parse --show-toplevel") stdout = process.cwd() + "\n";
    else if (cmd.indexOf("git commit") >= 0) stdout = "[main abc123] commit\n";
    else if (cmd === "git diff") stdout = "diff --git a/src/edited.js b/src/edited.js\n";
    return Promise.resolve({ code: 0, stdout: stdout, stderr: "" });
  };

  el.termCwd = ctx.document.getElementById("termCwd");
  el.termCwd.value = "workspace";
  await win.UriCodePanels.refreshGit();
  var statusCalls = calls.filter(function (call) { return call.cmd === "git status --porcelain"; });
  var branchCalls = calls.filter(function (call) { return call.cmd === "git branch --show-current"; });
  ok(statusCalls.length === 1 && statusCalls[0].cwd === "workspace",
    "el estado se consulta con git status --porcelain y termCwd");
  ok(branchCalls.length === 1 && branchCalls[0].cwd === "workspace",
    "la rama se consulta con git branch --show-current y termCwd");
  ok(el.gitBranch.textContent === "main", "el indicador muestra la rama actual");
  ok(rowsOf(el.gitChangesList).length === 6, "la lista muestra los cambios sin preparar");
  ok(rowsOf(el.gitStagedList).length === 4, "la lista muestra los cambios preparados");

  var editedRow = rowsOf(el.gitChangesList).filter(function (row) {
    return row.getAttribute("data-path") === "src/edited.js";
  })[0];
  ok(!!editedRow && editedRow._children[0].textContent === "M",
    "cada fila muestra la letra de estado");
  var editedName = editedRow._children[1];
  el.tabs = ctx.document.getElementById("tabs");
  fire(editedName);
  await waitFor(function () { return el.tabs._children.length > 0; });
  ok(el.tabs._children.length > 0 && el.tabs._children[0].title === "src/edited.js",
    "al pulsar el archivo se abre en el editor");

  var stageButton = editedRow._children[2]._children[0];
  fire(stageButton);
  await waitFor(function () {
    return calls.some(function (call) { return call.cmd.indexOf("git add --") === 0; });
  });
  var addCall = calls.filter(function (call) { return call.cmd.indexOf("git add --") === 0; })[0];
  ok(!!addCall && addCall.cwd === "workspace" && addCall.cmd.indexOf("src/edited.js") >= 0,
    "Stage ejecuta git add en termCwd");

  var stagedRow = rowsOf(el.gitStagedList).filter(function (row) {
    return row.getAttribute("data-path") === "src/staged.js";
  })[0];
  var unstageButton = stagedRow._children[2]._children[0];
  fire(unstageButton);
  await waitFor(function () {
    return calls.some(function (call) { return call.cmd.indexOf("git restore --staged") === 0; });
  });
  var restoreCall = calls.filter(function (call) { return call.cmd.indexOf("git restore --staged") === 0; })[0];
  ok(!!restoreCall && restoreCall.cwd === "workspace" && restoreCall.cmd.indexOf("src/staged.js") >= 0,
    "Unstage ejecuta git restore --staged en termCwd");

  var discardButton = editedRow._children[2]._children[1];
  fire(discardButton);
  await waitFor(function () {
    return calls.some(function (call) { return call.cmd.indexOf("git checkout --") === 0; });
  });
  var checkoutCall = calls.filter(function (call) { return call.cmd.indexOf("git checkout --") === 0; })[0];
  ok(!!checkoutCall && checkoutCall.cwd === "workspace" && checkoutCall.cmd.indexOf("src/edited.js") >= 0,
    "Descartar cambios ejecuta git checkout -- en termCwd");

  console.log("\n[3] Rama, commit, sync y diff");
  el.dlgInput = ctx.document.getElementById("dlgInput");
  el.dlgButtons = ctx.document.getElementById("dlgButtons");
  fire(el.gitBranchSwitch);
  await waitFor(function () { return el.dlgButtons._children.length >= 2; });
  await wait(10);
  el.dlgInput.value = "feature/demo";
  clickByText(el.dlgButtons, "Aceptar");
  await waitFor(function () {
    return calls.some(function (call) {
      return call.cmd.indexOf("git checkout ") === 0 && call.cmd.indexOf("git checkout --") !== 0;
    });
  });
  var switchCall = calls.filter(function (call) {
    return call.cmd.indexOf("git checkout ") === 0 && call.cmd.indexOf("git checkout --") !== 0;
  })[0];
  ok(!!switchCall && switchCall.cwd === "workspace" && switchCall.cmd.indexOf("feature/demo") >= 0,
    "cambiar de rama ejecuta git checkout con la rama elegida");

  fire(el.gitBranchList);
  await waitFor(function () {
    return calls.filter(function (call) { return call.cmd === "git branch --all"; }).length >= 2;
  });
  ok(calls.some(function (call) { return call.cmd === "git branch --all"; }),
    "el botón Ramas ejecuta git branch --all");

  el.gitMsg = ctx.document.getElementById("gitMsg");
  el.gitMsg.value = "Actualización del panel";
  fire(el.gitCommit);
  await waitFor(function () {
    return calls.some(function (call) { return call.cmd.indexOf("git add -A && git commit -m") === 0; });
  });
  var commitCall = calls.filter(function (call) { return call.cmd.indexOf("git add -A && git commit -m") === 0; })[0];
  ok(!!commitCall && commitCall.cwd === "workspace" && commitCall.cmd.indexOf("Actualización del panel") >= 0,
    "Commit prepara todo y crea el commit en termCwd");

  fire(el.gitSync);
  await waitFor(function () {
    return calls.some(function (call) { return call.cmd === "git pull"; }) && calls.some(function (call) { return call.cmd === "git push"; });
  });
  var pullCall = calls.filter(function (call) { return call.cmd === "git pull"; })[0];
  var pushCall = calls.filter(function (call) { return call.cmd === "git push"; })[0];
  ok(!!pullCall && pullCall.cwd === "workspace", "Sync ejecuta git pull en termCwd");
  ok(!!pushCall && pushCall.cwd === "workspace", "Sync ejecuta git push en termCwd");

  fire(el.gitDiff);
  await waitFor(function () { return calls.some(function (call) { return call.cmd === "git diff"; }); });
  ok(calls.some(function (call) { return call.cmd === "git diff" && call.cwd === "workspace"; }),
    "el botón Diff conserva git diff en termCwd");

  fire(el.gitDiffFile);
  await waitFor(function () { return calls.some(function (call) { return call.cmd.indexOf("git show HEAD:") === 0; }); });
  var rootCall = calls.filter(function (call) { return call.cmd === "git rev-parse --show-toplevel"; })[0];
  var showCall = calls.filter(function (call) { return call.cmd.indexOf("git show HEAD:") === 0; })[0];
  ok(!!rootCall && rootCall.cwd === "workspace", "Diff archivo consulta el repositorio en termCwd");
  ok(!!showCall && showCall.cwd === "workspace" && showCall.cmd.indexOf("src/edited.js") >= 0,
    "Diff archivo conserva la consulta git show en termCwd");

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
