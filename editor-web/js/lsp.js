/* Uri Code - Cliente LSP real sobre el puente nativo (FileAPI).
 *
 * Modo nativo (Android, window.FileAPI.startLsp disponible):
 *   FileAPI.startLsp(id, command, argsJson, cwd) -> arranca el servidor (allowlist nativa)
 *   FileAPI.sendLsp(id, base64)                  -> escribe en el stdin del proceso
 *   FileAPI.stopLsp(id)                          -> mata el proceso
 *   window.__uriLspData(id, b64chunk)            -> stdout crudo del proceso
 *   window.__uriLspError(id, b64line)            -> stderr del proceso (por lineas)
 *   window.__uriLspClosed(id, exitCode)          -> el proceso termino
 *
 * Framing: tramas estandar "Content-Length: N\r\n\r\n{json}". Los chunks base64
 * se decodifican a bytes, se acumulan en un buffer y se reconstruyen las tramas
 * (una trama puede llegar partida entre varios chunks).
 *
 * Responsabilidades del cliente:
 *   - connect(lang, {command, args, rootUri, cwd}): arranca el proceso, envia
 *     "initialize" (con capabilities y rootUri) y luego "initialized"; la promesa
 *     se resuelve cuando llega la respuesta de initialize.
 *   - didOpen/didChange/didClose: notificaciones textDocument/*.
 *   - request(method, params): promesa con el resultado (por id); rechaza ante
 *     respuestas de error o timeout.
 *   - publishDiagnostics -> marcadores de Monaco; window/logMessage -> consola.
 *   - disconnect(lang): stopLsp nativo y limpieza de estado.
 *
 * Modo adaptador (navegador / sin FileAPI.startLsp): igual que antes, sin procesos.
 *   - JS/TS: delega en el servicio TS de Monaco (passthrough; Monaco sigue dando
 *     IntelliSense). Otros lenguajes: resultados vacios.
 *
 * UriLSP.provideCompletions(monaco, model, position) sigue mezclando los resultados
 * locales de Monaco con los items que devuelva el servidor.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.UriLSP = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var servers = {};        // lang -> { command, args }
  var connections = {};    // lang -> conexion (adaptador local o proceso real)
  var notificationHandlers = [];
  var idCounter = 0;

  var INIT_TIMEOUT = 20000; // ms de espera maxima por la respuesta de initialize
  var REQ_TIMEOUT = 15000;  // ms de espera maxima por respuesta a un request

  /* Espejo de la allowlist nativa: evita llamadas al puente que caeran rechazadas. */
  var NATIVE_SERVERS = {
    "pylsp": 1, "pyright-langserver": 1, "typescript-language-server": 1, "clangd": 1,
    "gopls": 1, "rust-analyzer": 1, "jdtls": 1, "lua-language-server": 1
  };

  function normLang(lang) { return String(lang || "").toLowerCase(); }

  function isJsTs(lang) {
    var l = normLang(lang);
    return l === "javascript" || l === "js" || l === "typescript" || l === "ts" ||
      l === "jsx" || l === "tsx" || l === "json";
  }

  function adapterFor(lang) { return isJsTs(lang) ? "monaco-ts" : "empty"; }

  function nativeBridge() {
    if (typeof window === "undefined") return null;
    var f = window.FileAPI;
    if (f && typeof f.startLsp === "function" && typeof f.sendLsp === "function" && typeof f.stopLsp === "function") {
      return f;
    }
    return null;
  }

  function emptyResult(method) {
    method = String(method || "");
    if (method.indexOf("completion") >= 0) return { items: [], isIncomplete: false };
    if (method === "textDocument/hover") return null;
    if (method.indexOf("definition") >= 0) return [];
    if (method.indexOf("references") >= 0) return [];
    if (method.indexOf("documentSymbol") >= 0) return [];
    if (method.indexOf("diagnostic") >= 0) return [];
    if (method.indexOf("signatureHelp") >= 0) return null;
    return null;
  }

  function notify(method, params) {
    var n = { method: method, params: params || null };
    notificationHandlers.forEach(function (h) {
      try { h(n); } catch (e) {}
    });
  }

  function langFromParams(params) {
    params = params || {};
    if (params.languageId) return params.languageId;
    if (params.textDocument && params.textDocument.languageId) return params.textDocument.languageId;
    return null;
  }

  /* ================= base64 y UTF-8 sin dependencias ================= */

  function base64ToBytes(b64) {
    try {
      if (typeof atob !== "function") return null;
      var bin = atob(String(b64));
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
      return out;
    } catch (e) { return null; }
  }

  function bytesToBase64(bytes) {
    try {
      if (typeof btoa !== "function") return null;
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    } catch (e) { return null; }
  }

  function utf8Decode(bytes) {
    try {
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {}
    var out = "";
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      var cp;
      if (b < 0x80) { cp = b; i += 1; }
      else if ((b & 0xe0) === 0xc0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2; }
      else if ((b & 0xf0) === 0xe0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); i += 3; }
      else { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); i += 4; }
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  function utf8Encode(str) {
    try {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(str));
    } catch (e) {}
    var out = [];
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* ================= buffer de bytes y tramas LSP ================= */

  function newBuf() { return { data: new Uint8Array(0), start: 0 }; }

  function bufAppend(buf, bytes) {
    var nd = new Uint8Array(buf.data.length + bytes.length);
    nd.set(buf.data, 0);
    nd.set(bytes, buf.data.length);
    buf.data = nd;
  }

  function bufCompact(buf) {
    if (buf.start > 0) {
      buf.data = buf.data.subarray(buf.start);
      buf.start = 0;
    }
  }

  function bufFindHeaderEnd(buf) {
    var d = buf.data;
    for (var i = buf.start; i + 3 < d.length; i++) {
      if (d[i] === 13 && d[i + 1] === 10 && d[i + 2] === 13 && d[i + 3] === 10) return i;
    }
    return -1;
  }

  function contentLengthOf(header) {
    var m = /Content-Length\s*:\s*(\d+)/i.exec(header);
    return m ? parseInt(m[1], 10) : -1;
  }

  function handleData(conn, b64) {
    var bytes = base64ToBytes(b64);
    if (!bytes || !bytes.length) return;
    if (!conn.buf) conn.buf = newBuf();
    bufAppend(conn.buf, bytes);
    var guard = 0;
    while (guard++ < 10000) {
      bufCompact(conn.buf);
      var headEnd = bufFindHeaderEnd(conn.buf);
      if (headEnd < 0) return;
      var header = utf8Decode(conn.buf.data.subarray(conn.buf.start, headEnd));
      var len = contentLengthOf(header);
      if (len < 0) { conn.buf.start = headEnd + 4; continue; }
      var bodyStart = headEnd + 4;
      if (conn.buf.data.length - bodyStart < len) return; // trama incompleta: esperar mas chunks
      var body = utf8Decode(conn.buf.data.subarray(bodyStart, bodyStart + len));
      conn.buf.start = bodyStart + len;
      var msg = null;
      try { msg = JSON.parse(body); } catch (e) { msg = null; }
      if (msg) handleMessage(conn, msg);
    }
  }

  /* ================= envio y seguimiento de peticiones ================= */

  function sendFrame(conn, msg) {
    if (!conn || !conn.procId) return false;
    var bridge = nativeBridge();
    if (!bridge) return false;
    var body = utf8Encode(JSON.stringify(msg));
    var head = utf8Encode("Content-Length: " + body.length + "\r\n\r\n");
    var frame = new Uint8Array(head.length + body.length);
    frame.set(head, 0);
    frame.set(body, head.length);
    var b64 = bytesToBase64(frame);
    if (!b64) return false;
    try { return bridge.sendLsp(conn.procId, b64) !== false; } catch (e) { return false; }
  }

  function trackPending(conn, key, resolve, reject, timeoutMs) {
    conn.pending = conn.pending || {};
    var entry = { resolve: resolve, reject: reject, timer: null };
    entry.timer = setTimeout(function () {
      if (conn.pending && conn.pending[key]) {
        delete conn.pending[key];
        reject(new Error("LSP timeout: sin respuesta a " + key));
      }
    }, timeoutMs);
    conn.pending[key] = entry;
  }

  function untrackPending(conn, key) {
    if (conn && conn.pending && conn.pending[key]) {
      if (conn.pending[key].timer) clearTimeout(conn.pending[key].timer);
      delete conn.pending[key];
    }
  }

  function failPending(conn, err) {
    if (!conn || !conn.pending) return;
    var keys = Object.keys(conn.pending);
    for (var i = 0; i < keys.length; i++) {
      var p = conn.pending[keys[i]];
      if (p && p.timer) clearTimeout(p.timer);
      try { p.reject(err); } catch (e) {}
    }
    conn.pending = {};
  }

  function sendRequest(conn, method, params, resolve, reject) {
    var id = conn.nextId++;
    var key = String(id);
    trackPending(conn, key, resolve, reject, REQ_TIMEOUT);
    if (!sendFrame(conn, { jsonrpc: "2.0", id: id, method: String(method || ""), params: params })) {
      untrackPending(conn, key);
      reject(new Error("LSP: no se pudo enviar " + method));
    }
  }

  /* ================= mensajes entrantes ================= */

  function handleMessage(conn, msg) {
    if (!msg || typeof msg !== "object") return;
    var hasId = msg.id !== undefined && msg.id !== null;
    if (hasId && !msg.method) {
      var key = String(msg.id);
      var p = conn.pending ? conn.pending[key] : null;
      if (p) {
        delete conn.pending[key];
        if (p.timer) clearTimeout(p.timer);
        if (msg.error) {
          try { p.reject(new Error("LSP " + (msg.error.code || "") + ": " + (msg.error.message || "error"))); } catch (e) {}
        } else {
          try { p.resolve(msg.result); } catch (e) {}
        }
      }
      if (conn.onInit && !conn.ready && String(msg.id) === String(conn.initId)) {
        var f = conn.onInit;
        conn.onInit = null;
        try { f(); } catch (e) {}
      }
      return;
    }
    if (hasId && msg.method) {
      // Peticion del servidor (workspace/configuration, etc.): respuesta de cortesia.
      var result = null;
      if (msg.method === "workspace/configuration" && msg.params && msg.params.items) {
        result = [];
        for (var i = 0; i < msg.params.items.length; i++) result.push({});
      }
      sendFrame(conn, { jsonrpc: "2.0", id: msg.id, result: result });
      return;
    }
    if (msg.method) {
      handleNotification(conn, msg.method, msg.params);
    }
  }

  function handleNotification(conn, method, params) {
    try {
      if (method === "textDocument/publishDiagnostics") {
        publishDiagnostics(params);
      } else if (method === "window/logMessage") {
        var txt = params && params.message ? params.message : JSON.stringify(params || {});
        if (typeof console !== "undefined") console.log("[LSP" + (conn && conn.lang ? ":" + conn.lang : "") + "]", txt);
      }
    } catch (e) {}
    notify(method, params);
  }

  /* ================= diagnostics -> marcadores de Monaco ================= */

  function monacoSeverity(lspSev) {
    var MS = (typeof window !== "undefined" && window.monaco && window.monaco.MarkerSeverity) ? window.monaco.MarkerSeverity : null;
    if (MS) {
      if (lspSev === 2) return MS.Warning;
      if (lspSev === 3) return MS.Info;
      if (lspSev === 4) return MS.Hint;
      return MS.Error;
    }
    if (lspSev === 2) return 4;
    if (lspSev === 3) return 2;
    if (lspSev === 4) return 1;
    return 8;
  }

  function modelForUri(monaco, uri) {
    try {
      if (!monaco || !monaco.editor || typeof monaco.editor.getModels !== "function") return null;
      var models = monaco.editor.getModels();
      if (!models || !models.length) return null;
      for (var i = 0; i < models.length; i++) {
        var u = models[i].uri;
        var s = u && typeof u.toString === "function" ? u.toString() : String(u);
        if (s === uri) return models[i];
      }
      return null;
    } catch (e) { return null; }
  }

  function publishDiagnostics(params) {
    if (!params || !params.uri || !params.diagnostics) return;
    if (typeof window === "undefined" || !window.monaco || !window.monaco.editor ||
        typeof window.monaco.editor.setModelMarkers !== "function") return;
    var model = modelForUri(window.monaco, params.uri);
    if (!model) return;
    var markers = [];
    var diags = params.diagnostics;
    for (var i = 0; i < diags.length; i++) {
      var d = diags[i] || {};
      var r = d.range || {};
      var st = r.start || {};
      var en = r.end || {};
      markers.push({
        startLineNumber: (st.line || 0) + 1,
        startColumn: (st.column || 0) + 1,
        endLineNumber: (en.line || st.line || 0) + 1,
        endColumn: (en.column || st.column || 0) + 1,
        message: String(d.message || ""),
        severity: monacoSeverity(d.severity),
        source: d.source || "lsp"
      });
    }
    window.monaco.editor.setModelMarkers(model, "urilsp", markers);
  }

  /* ================= ciclo de vida de la conexion ================= */

  function connectReal(conn, bridge) {
    return new Promise(function (resolve) {
      var id = "lsp-" + (++idCounter) + "-" + conn.lang;
      conn.procId = id;
      conn.real = true;
      var launched = false;
      try {
        launched = bridge.startLsp(id, conn.command, JSON.stringify(conn.args || []), conn.cwd || "") === true;
      } catch (e) { launched = false; }
      if (!launched) {
        // Sin binario o comando rechazado por la allowlist: adaptador local.
        conn.real = false;
        conn.procId = null;
        conn.connected = true;
        setTimeout(function () { resolve(conn); }, 0);
        return;
      }
      conn.connected = true;
      var settled = false;
      conn.onInit = function () {
        if (conn.initTimer) { clearTimeout(conn.initTimer); conn.initTimer = null; }
        sendFrame(conn, { jsonrpc: "2.0", method: "initialized", params: {} });
        conn.ready = true;
        var q = conn.queue || [];
        conn.queue = [];
        for (var i = 0; i < q.length; i++) {
          try { q[i](); } catch (e) {}
        }
        if (!settled) { settled = true; resolve(conn); }
      };
      conn.onClosed = function (code) {
        if (conn.initTimer) { clearTimeout(conn.initTimer); conn.initTimer = null; }
        failPending(conn, new Error("LSP cerrado (code " + code + ")"));
        var q = conn.queue || [];
        conn.queue = [];
        for (var j = 0; j < q.length; j++) {
          try { q[j](); } catch (e) {} // procId ya es null: cada una rechaza
        }
        if (!settled) { settled = true; resolve(conn); }
      };
      conn.initTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (typeof console !== "undefined") console.log("[LSP] initialize timeout: " + conn.lang);
        resolve(conn);
      }, INIT_TIMEOUT);
      var params = {
        processId: null,
        rootUri: conn.rootUri || null,
        capabilities: {
          textDocument: {
            synchronization: { didSave: true, dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: false, labelDetailsSupport: false } },
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { relatedInformation: true }
          },
          workspace: { configuration: true, workspaceFolders: false }
        }
      };
      var initId = conn.nextId++;
      conn.initId = initId;
      sendFrame(conn, { jsonrpc: "2.0", id: initId, method: "initialize", params: params });
    });
  }

  /* ================= hooks llamados por el nativo ================= */

  function connById(id) {
    var keys = Object.keys(connections);
    for (var i = 0; i < keys.length; i++) {
      var c = connections[keys[i]];
      if (c && c.procId === id) return c;
    }
    return null;
  }

  function installNativeHooks() {
    if (typeof window === "undefined") return;
    if (typeof window.__uriLspData !== "function") {
      window.__uriLspData = function (id, b64) {
        var c = connById(String(id));
        if (c) handleData(c, b64);
      };
    }
    if (typeof window.__uriLspError !== "function") {
      window.__uriLspError = function (id, b64line) {
        try {
          var bytes = base64ToBytes(b64line);
          if (bytes && typeof console !== "undefined") console.log("[LSP stderr]", utf8Decode(bytes));
        } catch (e) {}
      };
    }
    if (typeof window.__uriLspClosed !== "function") {
      window.__uriLspClosed = function (id, code) {
        var c = connById(String(id));
        if (!c) return;
        c.connected = false;
        c.ready = false;
        c.procId = null;
        failPending(c, new Error("LSP cerrado (code " + code + ")"));
        if (c.onClosed) {
          var f = c.onClosed;
          c.onClosed = null;
          try { f(code); } catch (e) {}
        }
        delete connections[c.lang];
      };
    }
  }
  installNativeHooks();

  /* ================= API publica ================= */

  var api = {
    registerServer: function (lang, meta) {
      lang = normLang(lang);
      meta = meta || {};
      servers[lang] = {
        command: meta.command || null,
        args: Array.isArray(meta.args) ? meta.args.slice() : []
      };
      return api;
    },

    /**
     * Conecta un lenguaje. Con puente nativo y comando permitido arranca el
     * proceso real y resuelve cuando llega la respuesta de initialize; si no,
     * usa el adaptador local (monaco-ts para JS/TS, vacio para el resto).
     */
    connect: function (lang, opts) {
      lang = normLang(lang);
      opts = opts || {};
      var meta = servers[lang] || {};
      var command = opts.command || meta.command || null;
      var args = Array.isArray(opts.args) ? opts.args.slice() : (Array.isArray(meta.args) ? meta.args.slice() : []);
      var conn = {
        lang: lang,
        adapter: adapterFor(lang),
        connected: false,
        server: servers[lang] || null,
        command: command,
        args: args,
        rootUri: opts.rootUri || null,
        cwd: opts.cwd || "",
        real: false,
        procId: null,
        ready: false,
        nextId: 1,
        initId: null,
        pending: {},
        queue: [],
        buf: null,
        onInit: null,
        onClosed: null,
        initTimer: null
      };
      connections[lang] = conn;
      var bridge = nativeBridge();
      if (bridge && command && NATIVE_SERVERS[command]) {
        return connectReal(conn, bridge);
      }
      // Adaptador local (navegador): igual que antes, sin procesos.
      conn.connected = true;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(conn); }, 0);
      });
    },

    disconnect: function (lang) {
      lang = normLang(lang);
      var conn = connections[lang];
      if (conn) {
        failPending(conn, new Error("LSP desconectado"));
        if (conn.initTimer) { clearTimeout(conn.initTimer); conn.initTimer = null; }
        var bridge = nativeBridge();
        if (bridge && conn.procId) {
          try { bridge.stopLsp(conn.procId); } catch (e) {}
        }
      }
      delete connections[lang];
    },

    /** textDocument/didOpen. */
    didOpen: function (lang, uri, languageId, text, version) {
      var conn = connections[normLang(lang)];
      if (!conn || !conn.real) return false;
      return sendFrame(conn, {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: String(uri || ""),
            languageId: String(languageId || lang),
            version: typeof version === "number" ? version : 1,
            text: String(text == null ? "" : text)
          }
        }
      });
    },

    /** textDocument/didChange. changes: array LSP de cambios o texto completo. */
    didChange: function (lang, uri, changes, version) {
      var conn = connections[normLang(lang)];
      if (!conn || !conn.real) return false;
      var arr = changes;
      if (typeof arr === "string") arr = [{ text: arr }];
      if (!Array.isArray(arr) || !arr.length) arr = [{ text: "" }];
      return sendFrame(conn, {
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri: String(uri || ""), version: typeof version === "number" ? version : 1 },
          contentChanges: arr
        }
      });
    },

    /** textDocument/didClose. */
    didClose: function (lang, uri) {
      var conn = connections[normLang(lang)];
      if (!conn || !conn.real) return false;
      return sendFrame(conn, {
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri: String(uri || "") } }
      });
    },

    onNotification: function (handler) {
      if (typeof handler !== "function") return function () {};
      notificationHandlers.push(handler);
      return function () {
        var i = notificationHandlers.indexOf(handler);
        if (i >= 0) notificationHandlers.splice(i, 1);
      };
    },

    /**
     * Peticion JSON-RPC. En conexion real resuelve con result y rechaza con
     * errores del servidor; en modo adaptador devuelve resultados vacios.
     */
    request: function (method, params) {
      params = params || {};
      var lang = langFromParams(params);
      var conn = null;
      if (lang) conn = connections[normLang(lang)] || null;
      if (!conn) {
        var keys = Object.keys(connections);
        if (keys.length) conn = connections[keys[0]];
      }
      if (conn && conn.real && conn.procId) {
        if (conn.ready) {
          return new Promise(function (resolve, reject) {
            sendRequest(conn, method, params, resolve, reject);
          });
        }
        // El servidor aun no termino initialize: encola y resuelve al estar listo.
        return new Promise(function (resolve, reject) {
          var queued = false;
          var run = function () {
            if (queued) return;
            queued = true;
            sendRequest(conn, method, params, resolve, reject);
          };
          conn.queue.push(run);
          setTimeout(function () {
            if (queued) return;
            var i = conn.queue ? conn.queue.indexOf(run) : -1;
            if (i >= 0 && conn.queue) conn.queue.splice(i, 1);
            queued = true;
            reject(new Error("LSP timeout: servidor sin inicializar"));
          }, INIT_TIMEOUT);
        });
      }
      // Adaptadores locales: resultados vacios (compatibilidad).
      return Promise.resolve(emptyResult(method));
    },

    provideCompletions: function (monaco, model, position) {
      var self = api;
      var lang = null;
      try { if (model && typeof model.getLanguageId === "function") lang = model.getLanguageId(); } catch (e) {}
      // Los resultados locales los da Monaco; aqui se mezclan los del servidor.
      var serverPromise = self.request("textDocument/completion", {
        textDocument: { uri: (model && typeof model.uri !== "undefined" && model.uri) ? String(model.uri) : null, languageId: lang },
        position: position || null
      }).then(function (r) {
        if (Array.isArray(r)) return r;
        if (r && Array.isArray(r.items)) return r.items;
        return [];
      }).catch(function () { return []; });

      return serverPromise.then(function (serverItems) {
        var localItems = [];
        // Monaco entrega sus sugerencias con sus propios providers; este gancho
        // solo anade las sugerencias del servidor LSP.
        var merged = localItems.concat(serverItems || []);
        return merged;
      });
    },

    // Helpers
    isConnected: function (lang) { return !!connections[normLang(lang)]; },
    getServers: function () { return JSON.parse(JSON.stringify(servers)); }
  };

  return api;
});
