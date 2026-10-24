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
function bodyContent(message) {
  var body = message && message._q && message._q[".body"];
  if (!body) return "";
  return String(body._html || body.textContent || body._text || "");
}
function messageContent(message) {
  return String(message && message._html || "") + " " + bodyContent(message);
}
function hasThinking(messages) {
  return messages._children.some(function (message) {
    var content = messageContent(message);
    return content.indexOf("thinking") >= 0 || content.indexOf("Pensando") >= 0;
  });
}
function findMessage(messages, predicate) {
  return messages._children.filter(predicate)[0] || null;
}
function fire(element) {
  if (!element) return false;
  var event = { preventDefault: function () {}, stopPropagation: function () {} };
  if (typeof element.onclick === "function") { element.onclick(event); return true; }
  var listeners = element._listeners && element._listeners.click;
  if (!listeners || !listeners.length) return false;
  listeners.slice().forEach(function (fn) { fn(event); });
  return true;
}

(async function main() {
  console.log("\n[1] Preparacion: app con API key y archivo abierto");
  var storage = dom.makeStorage();
  var fileContent = "export function suma(a, b) { return a + b; }\n";
  storage.setItem("uri.settings", JSON.stringify({
    nimKey: "nvapi-test-key",
    nimModel: "meta/test-model"
  }));
  storage.setItem("uri.vfs", JSON.stringify({
    files: { "app.js": fileContent },
    dirs: []
  }));
  storage.setItem("uri.session", JSON.stringify({
    tabs: ["app.js"],
    active: "app.js",
    expanded: []
  }));

  var ctx = dom.createSandbox({ storage: storage });
  var activityButton = dom.makeElement("activityAi", "button");
  activityButton.setAttribute("data-view", "ai");
  var aiView = dom.makeElement("view-ai", "section");
  aiView.classList = makeClassList();
  var querySelectorAll = ctx.document.querySelectorAll;
  ctx.document.querySelectorAll = function (selector) {
    if (selector === ".ab-item") return [activityButton];
    if (selector === ".view") return [aiView];
    return querySelectorAll.call(this, selector);
  };

  var responseMode = "success";
  var requests = [];
  ctx.window.FileAPI = nativeMock.createFileAPI({
    storage: storage,
    web: ctx.window,
    cwd: process.cwd(),
    vfs: JSON.parse(storage.getItem("uri.vfs")),
    httpResponder: function (url, headers, payload) {
      requests.push({ url: url, headers: headers, body: JSON.parse(payload) });
      if (responseMode === "unauthorized") return { status: 401, body: "Unauthorized" };
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Respuesta NIM" } }]
        })
      };
    }
  });

  var threw = null;
  try { dom.loadApp(ctx); } catch (e) { threw = e; }
  ok(!threw, "la app carga sin excepciones" + (threw ? " -> " + threw.message : ""));
  await wait(150);

  var win = ctx.window;
  var el = ctx.elements;
  ok(!!win.Chat, "Chat está expuesto");
  ok(el.setKey.value === "nvapi-test-key", "la API key se carga desde uri.settings");
  el.chatIncludeFile.checked = true;

  console.log("\n[2] Apertura del chat y envio de un mensaje");
  activityButton.click();
  ok(aiView.classList.contains("active"), "el boton de actividad abre la vista del chat");
  el.chatInput.value = "Explica la funcion suma";
  el.chatSend.click();
  ok(hasThinking(el.chatMessages), "se muestra el indicador de respuesta pendiente");
  ok(el.chatSend.disabled, "el boton de envio queda bloqueado durante la peticion");

  await waitFor(function () {
    return !!findMessage(el.chatMessages, function (message) {
      return bodyContent(message).indexOf("Respuesta NIM") >= 0;
    });
  });
  var reply = findMessage(el.chatMessages, function (message) {
    return bodyContent(message).indexOf("Respuesta NIM") >= 0;
  });
  ok(!!reply, "la respuesta NIM aparece en #chatMessages");
  ok(!hasThinking(el.chatMessages), "el indicador pendiente se elimina al llegar la respuesta");
  ok(el.chatSend.disabled === false, "el boton de envio se reactiva tras la respuesta");

  var chatRequest = requests.filter(function (request) {
    return request.body.messages && request.body.messages.some(function (message) {
      return message.content.indexOf("Explica la funcion suma") >= 0;
    });
  })[0];
  ok(!!chatRequest && chatRequest.url === "https://integrate.api.nvidia.com/v1/chat/completions",
    "el chat envia la peticion al endpoint de NIM");
  ok(!!chatRequest && chatRequest.headers.Authorization === "Bearer nvapi-test-key",
    "la peticion incluye la API key configurada");
  var sentUserMessage = chatRequest && chatRequest.body.messages.filter(function (message) {
    return message.role === "user";
  }).pop();
  ok(!!sentUserMessage && sentUserMessage.content.indexOf(fileContent.trim()) >= 0,
    "la peticion incluye el contenido del archivo abierto");

  console.log("\n[3] Error HTTP del chat");
  responseMode = "unauthorized";
  el.chatInput.value = "Prueba sin permisos";
  el.chatSend.click();
  ok(hasThinking(el.chatMessages), "se muestra un nuevo indicador pendiente");
  await waitFor(function () {
    return !!findMessage(el.chatMessages, function (message) {
      return /msg err/.test(message.className) && bodyContent(message).indexOf("401") >= 0;
    });
  });
  var errorMessage = findMessage(el.chatMessages, function (message) {
    return /msg err/.test(message.className) && bodyContent(message).indexOf("401") >= 0;
  });
  ok(!!errorMessage, "un HTTP 401 produce un mensaje de error en #chatMessages");
  ok(!hasThinking(el.chatMessages), "el indicador pendiente se elimina tras el error");

  console.log("\n[4] Diagnostico de conexion IA");
  responseMode = "success";
  fire(el.testAi);
  ok(el.testAiStatus.textContent === "Probando…", "el boton iniciar la prueba de conexion");
  await waitFor(function () { return /HTTP 200/.test(el.testAiStatus.textContent); });
  ok(/HTTP 200 OK/.test(el.testAiStatus.textContent),
    "el resultado actualiza #testAiStatus: " + el.testAiStatus.textContent);

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado en las pruebas:", e);
  process.exit(1);
});
