/* Pruebas del cliente LSP real sobre un puente nativo falso.
 *
 * El doble de FileAPI replica el contrato de MainActivity.java:
 *   - startLsp guarda el id y devuelve true (o false si se simula rechazo).
 *   - sendLsp captura los bytes enviados (decodificables desde el test).
 *   - stopLsp marca el proceso como detenido.
 * El "servidor" falso responde empujando chunks base64 via window.__uriLspData,
 * igual que haria el puente nativo con el stdout del proceso.
 *
 * Uso: node tests/lsp.test.js
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

/* ======== utilidades LSP (lado servidor falso, en Node) ======== */

function frameOf(msg) {
  var body = Buffer.from(JSON.stringify(msg), "utf8");
  var head = Buffer.from("Content-Length: " + body.length + "\r\n\r\n", "ascii");
  return Buffer.concat([head, body]);
}

function parseFrames(buf) {
  var msgs = [];
  for (;;) {
    var idx = buf.indexOf("\r\n\r\n");
    if (idx < 0) break;
    var header = buf.slice(0, idx).toString("utf8");
    var m = /Content-Length\s*:\s*(\d+)/i.exec(header);
    if (!m) { buf = buf.slice(idx + 4); continue; }
    var len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    var body = buf.slice(idx + 4, idx + 4 + len).toString("utf8");
    try { msgs.push(JSON.parse(body)); } catch (e) {}
    buf = buf.slice(idx + 4 + len);
  }
  return { msgs: msgs, rest: buf };
}

function frameMethod(s) {
  var i = s.bytes.indexOf("\r\n\r\n");
  if (i < 0) return "";
  try { return JSON.parse(s.bytes.slice(i + 4).toString("utf8")).method || ""; } catch (e) { return ""; }
}

function frameMessage(s) {
  var i = s.bytes.indexOf("\r\n\r\n");
  if (i < 0) return null;
  try { return JSON.parse(s.bytes.slice(i + 4).toString("utf8")); } catch (e) { return null; }
}

/* Monaco minimo con setModelMarkers (como makeFakeMonaco de cursor.test.js).
 * setModelMarkers REEMPLAZA los marcadores de un owner (semantica real de Monaco);
 * se lleva tambien un contador de llamadas para detectar nuevas publicaciones. */
function makeFakeMonaco(uriStr) {
  var markersByOwner = {};
  var model = {
    uri: { path: "/test.py", toString: function () { return uriStr; } },
    getLanguageId: function () { return "python"; }
  };
  var calls = { count: 0 };
  return {
    editor: {
      getModels: function () { return [model]; },
      setModelMarkers: function (m, owner, markers) {
        calls.count++;
        markersByOwner[owner] = { model: m, markers: markers };
      },
      getModelMarkers: function () { return []; },
      defineTheme: function () {},
      setTheme: function () {},
      onDidChangeMarkers: function () { return { dispose: function () {} }; }
    },
    model: model,
    markersByOwner: markersByOwner,
    markerCalls: calls
  };
}

/* Puente nativo falso con el contrato de FileAPI. */
function makeFakeNative(win, handlers) {
  handlers = handlers || {};
  var state = { started: {}, stopped: {}, sent: [], buffers: {} };
  var api = {
    startLsp: function (id, command, argsJson, cwd) {
      if (handlers.rejectCommand && String(command) === handlers.rejectCommand) return false;
      var args = [];
      try { args = JSON.parse(argsJson || "[]"); } catch (e) { args = []; }
      state.started[id] = { command: command, args: args, cwd: cwd };
      if (handlers.onStart) handlers.onStart(id);
      return true;
    },
    sendLsp: function (id, b64) {
      var bytes = Buffer.from(String(b64), "base64");
      state.sent.push({ id: id, bytes: bytes, text: bytes.toString("utf8") });
      state.buffers[id] = state.buffers[id] ? Buffer.concat([state.buffers[id], bytes]) : bytes;
      if (handlers.onSend) handlers.onSend(id, state.buffers[id]);
      return true;
    },
    stopLsp: function (id) {
      state.stopped[id] = true;
      delete state.started[id];
      return true;
    }
  };
  return { api: api, state: state };
}

/* Servidor LSP falso: contesta initialize (y completion) empujando tramas al
 * WebView via __uriLspData, como el stdout real en chunks del puente nativo. */
function makeFakeServer(win, opts) {
  opts = opts || {};
  var svc = {
    id: null,
    onClientData: function (id, buf) {
      svc.id = id;
      var parsed = parseFrames(buf);
      parsed.msgs.forEach(function (msg) {
        if (!msg) return;
        if (msg.method === "initialize" && msg.id !== undefined) {
          setTimeout(function () {
            win.__uriLspData(id, frameOf({
              jsonrpc: "2.0", id: msg.id,
              result: { capabilities: { textDocumentSync: 1, completionProvider: {} } }
            }).toString("base64"));
          }, 5);
        } else if (msg.method === "textDocument/completion" && msg.id !== undefined) {
          setTimeout(function () {
            win.__uriLspData(id, frameOf({
              jsonrpc: "2.0", id: msg.id,
              result: { isIncomplete: false, items: [{ label: "print" }, { label: "len" }] }
            }).toString("base64"));
          }, 5);
        } else if (msg.id !== undefined && opts.replyUnknown !== false) {
          setTimeout(function () {
            win.__uriLspData(id, frameOf({
              jsonrpc: "2.0", id: msg.id,
              error: { code: -32601, message: "Method not found: " + msg.method }
            }).toString("base64"));
          }, 5);
        }
      });
    }
  };
  return svc;
}

(async function main() {
  console.log("\n[1] connect: arranca el servidor y envia initialize bien enmarcado");
  var ctx = dom.createSandbox({});
  var monaco = makeFakeMonaco("file:///test.py");
  ctx.window.monaco = monaco;
  var svc = makeFakeServer(ctx.window);
  var native = makeFakeNative(ctx.window, { onSend: function (id, buf) { svc.onClientData(id, buf); } });
  ctx.window.FileAPI = native.api;
  dom.loadScript(ctx, "js/lsp.js");
  var U = ctx.window.UriLSP;
  ok(!!U, "UriLSP expuesto");
  U.registerServer("python", { command: "pylsp", args: ["--stdio"] });

  var conn = await U.connect("python", { command: "pylsp", args: ["--stdio"], rootUri: "file:///data/app/projects", cwd: "" });
  await wait(60);

  var startedIds = Object.keys(native.state.started);
  ok(startedIds.length === 1, "startLsp invocado una vez (" + startedIds.length + ")");
  var procId = startedIds[0];
  var st = native.state.started[procId];
  ok(st && st.command === "pylsp", "el comando arrancado es pylsp");
  ok(st && Array.isArray(st.args) && st.args.indexOf("--stdio") >= 0, "los args viajan como array JSON");

  var first = native.state.sent[0];
  ok(!!first, "se envio una trama al stdin del servidor");
  var headEnd = first ? first.bytes.indexOf("\r\n\r\n") : -1;
  ok(headEnd > 0, "la trama lleva cabecera terminada en \\r\\n\\r\\n");
  var hdrText = first ? first.bytes.slice(0, headEnd).toString("utf8") : "";
  var declaredLen = /Content-Length:\s*(\d+)/i.exec(hdrText) ? parseInt(/Content-Length:\s*(\d+)/i.exec(hdrText)[1], 10) : -1;
  ok(declaredLen > 0 && first && declaredLen === first.bytes.length - (headEnd + 4),
    "Content-Length coincide con el cuerpo (" + declaredLen + ")");
  var initMsg = first ? frameMessage(first) : null;
  ok(initMsg && initMsg.method === "initialize", "la primera trama es el request initialize");
  ok(initMsg && initMsg.params && initMsg.params.rootUri === "file:///data/app/projects", "initialize lleva rootUri");
  ok(initMsg && initMsg.params && initMsg.params.capabilities && typeof initMsg.params.capabilities === "object",
    "initialize lleva capabilities");
  ok(initMsg && typeof initMsg.id === "number", "initialize lleva id numerico");
  ok(conn && conn.connected === true, "connect resolvio con conexion activa");
  ok(U.isConnected("python"), "isConnected('python') es true");
  ok(conn && conn.procId === procId, "la conexion referencia al proceso nativo");
  var second = native.state.sent[1];
  ok(second && frameMethod(second) === "initialized", "tras la respuesta se envia initialized");

  console.log("\n[2] publishDiagnostics produce marcadores de Monaco");
  ctx.window.__uriLspData(procId, frameOf({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: "file:///test.py",
      diagnostics: [{
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 9 } },
        severity: 2,
        code: "W001",
        source: "pylsp",
        message: "variable sin usar 'valor'"
      }]
    }
  }).toString("base64"));
  await wait(20);
  var owned = monaco.markersByOwner["urilsp"];
  ok(!!owned, "setModelMarkers fue llamado con owner 'urilsp'");
  ok(owned && owned.markers.length === 1, "se publica un marcador");
  var mk = owned && owned.markers[0];
  ok(mk && mk.message === "variable sin usar 'valor'", "el marcador lleva el mensaje");
  ok(mk && mk.startLineNumber === 3 && mk.startColumn === 5, "posicion 1-based (linea 3, col 5)");
  ok(owned && owned.model === monaco.model, "los marcadores van al modelo con ese uri");

  console.log("\n[2b] Tramas partidas entre chunks se reconstruyen");
  var f2 = frameOf({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: "file:///test.py",
      diagnostics: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 } }, severity: 1, message: "nombre 'x' no definido" }]
    }
  });
  var b64full = f2.toString("base64");
  // Cada chunk base64 debe ser decodificable: se corta en multiplos de 4
  // (igual que hacen los chunks crudos del nativo).
  var a = b64full.slice(0, 16), b = b64full.slice(16, 40), c = b64full.slice(40);
  var callsBefore = monaco.markerCalls.count;
  ctx.window.__uriLspData(procId, a);
  ctx.window.__uriLspData(procId, b);
  ok(monaco.markerCalls.count === callsBefore, "sin la trama completa no se publica nada");
  ctx.window.__uriLspData(procId, c);
  await wait(20);
  ok(monaco.markerCalls.count === callsBefore + 1, "la trama reconstruida publico marcadores una vez");
  var owned2 = monaco.markersByOwner["urilsp"];
  ok(owned2 && owned2.markers.length === 1, "un marcador reconstruido desde chunks (" + (owned2 ? owned2.markers.length : 0) + ")");
  ok(owned2 && owned2.markers[0] && owned2.markers[0].message === "nombre 'x' no definido",
    "el marcador reconstruido tiene el mensaje correcto");
  ok(owned2 && owned2.markers[0] && owned2.markers[0].startLineNumber === 1, "linea 1 (0-based + 1)");

  console.log("\n[3] request(method, params) resuelve con el resultado del servidor");
  var res = await U.request("textDocument/completion", {
    textDocument: { uri: "file:///test.py", languageId: "python" },
    position: { line: 0, column: 0 }
  });
  ok(res && Array.isArray(res.items), "completion devuelve items");
  ok(res && res.items && res.items[0] && res.items[0].label === "print", "el primer item es 'print'");
  var reqFrames = native.state.sent.filter(function (s) { return frameMethod(s) === "textDocument/completion"; });
  ok(reqFrames.length >= 1, "la peticion viajo con framing LSP (" + reqFrames.length + ")");

  var errBack = null;
  var errRes = await U.request("textDocument/metodoInexistente", {
    textDocument: { uri: "file:///test.py", languageId: "python" },
    position: { line: 0, column: 0 }
  }).catch(function (e) { errBack = e; return null; });
  ok(errRes === null && errBack !== null, "una respuesta de error rechaza la promesa");
  ok(errBack && /-32601|Method not found/.test(String(errBack.message)), "el rechazo lleva el error del servidor: " + (errBack && errBack.message));

  console.log("\n[4] didOpen/didChange/didClose envian notificaciones");
  U.didOpen("python", "file:///test.py", "python", "x = 1\n");
  U.didChange("python", "file:///test.py", [{ text: "x = 2\n" }], 2);
  U.didClose("python", "file:///test.py");
  await wait(10);
  var methods = native.state.sent.map(frameMethod);
  ok(methods.indexOf("textDocument/didOpen") >= 0, "didOpen enviada");
  ok(methods.indexOf("textDocument/didChange") >= 0, "didChange enviada");
  ok(methods.indexOf("textDocument/didClose") >= 0, "didClose enviada");

  console.log("\n[4b] provideCompletions mezcla los items del servidor");
  var merged = await U.provideCompletions(monaco, monaco.model, { lineNumber: 1, column: 1 });
  ok(Array.isArray(merged) && merged.length === 2, "los items del servidor llegan mezclados (" + (merged && merged.length) + ")");
  var sv = U.getServers();
  ok(sv.python && sv.python.command === "pylsp" && sv.python.args[0] === "--stdio", "getServers conserva la metadata registrada");

  console.log("\n[5] disconnect detiene el proceso nativo");
  U.disconnect("python");
  ok(native.state.stopped[procId] === true, "stopLsp llamado con el id del proceso");
  ok(!U.isConnected("python"), "la conexion se elimina");

  console.log("\n[6] Sin FileAPI.startLsp: adaptadores locales (compatibilidad)");
  var ctx2 = dom.createSandbox({});
  dom.loadScript(ctx2, "js/lsp.js");
  var U2 = ctx2.window.UriLSP;
  var c1 = await U2.connect("javascript");
  ok(c1 && c1.adapter === "monaco-ts" && c1.connected, "JS usa monaco-ts sin puente nativo");
  var c2 = await U2.connect("python");
  ok(c2 && c2.adapter === "empty" && c2.connected, "python usa el adaptador empty sin puente nativo");
  var er = await U2.request("textDocument/completion", {
    textDocument: { uri: "file:///a.py", languageId: "python" },
    position: { line: 0, column: 0 }
  });
  ok(er && Array.isArray(er.items) && er.items.length === 0, "request en modo adaptador devuelve vacio");

  console.log("\n[7] Comandos rechazados caen al adaptador local sin romper nada");
  var ctx3 = dom.createSandbox({});
  var nat3 = makeFakeNative(ctx3.window, { rejectCommand: "pyright-langserver" });
  ctx3.window.FileAPI = nat3.api;
  dom.loadScript(ctx3, "js/lsp.js");
  var U3 = ctx3.window.UriLSP;
  var c3 = await U3.connect("python", { command: "powershell" });
  ok(c3 && c3.connected && c3.procId === null, "comando fuera de la allowlist: adaptador local");
  ok(Object.keys(nat3.state.started).length === 0, "no se llamo a startLsp");
  var c4 = await U3.connect("python", { command: "pyright-langserver", args: ["--stdio"] });
  ok(c4 && c4.connected && c4.procId === null, "si el nativo rechaza, connect resuelve igualmente");
  ok(Object.keys(nat3.state.started).length === 0, "ningun proceso quedo registrado");

  console.log("\n[7b] Peticiones en cola se resuelven cuando llega initialize");
  var ctx5 = dom.createSandbox({});
  var nat5 = makeFakeNative(ctx5.window, {});
  ctx5.window.FileAPI = nat5.api;
  dom.loadScript(ctx5, "js/lsp.js");
  var U5 = ctx5.window.UriLSP;
  var connP5 = U5.connect("python", { command: "gopls", args: [] });
  var reqP5 = U5.request("textDocument/completion", {
    textDocument: { uri: "file:///a.py", languageId: "python" },
    position: { line: 0, column: 0 }
  });
  await wait(20);
  var compBefore = nat5.state.sent.filter(function (s) { return frameMethod(s) === "textDocument/completion"; }).length;
  ok(compBefore === 0, "la peticion no se envia antes de initialize");
  var id5 = Object.keys(nat5.state.started)[0];
  var initFrame = nat5.state.sent.map(frameMessage).filter(function (m) { return m && m.method === "initialize"; })[0];
  ok(!!initFrame, "el initialize salio y esta capturado");
  ctx5.window.__uriLspData(id5, frameOf({ jsonrpc: "2.0", id: initFrame.id, result: { capabilities: {} } }).toString("base64"));
  await wait(20);
  var compFrame = nat5.state.sent.map(frameMessage).filter(function (m) { return m && m.method === "textDocument/completion"; })[0];
  ok(!!compFrame, "al estar listo el servidor se envio la peticion encolada");
  ctx5.window.__uriLspData(id5, frameOf({ jsonrpc: "2.0", id: compFrame.id, result: { items: [{ label: "len" }] } }).toString("base64"));
  var conn5 = await connP5;
  var r5 = await reqP5;
  ok(conn5 && conn5.connected, "connect resolvio tras el initialize tardio");
  ok(r5 && r5.items && r5.items[0] && r5.items[0].label === "len", "la peticion encolada se resolvio ('len')");
  U5.disconnect("python");

  console.log("\n[8] stderr y cierre del servidor");
  var ctx4 = dom.createSandbox({});
  var monaco4 = makeFakeMonaco("file:///t.py");
  ctx4.window.monaco = monaco4;
  var svc4 = makeFakeServer(ctx4.window, { replyUnknown: false });
  var nat4 = makeFakeNative(ctx4.window, { onSend: function (id, buf) { svc4.onClientData(id, buf); } });
  ctx4.window.FileAPI = nat4.api;
  dom.loadScript(ctx4, "js/lsp.js");
  var U4 = ctx4.window.UriLSP;
  var conn4 = await U4.connect("python", { command: "pylsp", args: [], rootUri: null });
  var id4 = Object.keys(nat4.state.started)[0];
  ok(!!conn4 && U4.isConnected("python"), "conexion de preparacion lista");
  ctx4.window.__uriLspError(id4, Buffer.from("servidor: aviso de prueba", "utf8").toString("base64"));
  var rejected = null;
  var reqP = U4.request("textDocument/hover", {
    textDocument: { uri: "file:///t.py", languageId: "python" },
    position: { line: 0, column: 0 }
  }).catch(function (e) { rejected = e; return null; });
  await wait(20);
  ctx4.window.__uriLspClosed(id4, 0);
  var rq = await reqP;
  ok(rq === null && rejected !== null, "la peticion pendiente se rechaza al cerrar el servidor");
  ok(!U4.isConnected("python"), "tras __uriLspClosed la conexion queda inactiva");

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
