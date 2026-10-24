/* Uri Code - Minimal LSP client infrastructure (browser).
 *
 * Usage:
 *   UriLSP.registerServer('python', { command: 'pylsp', args: ['--stdio'] }); // metadata only
 *   await UriLSP.connect('python');          // resolves when "connected" (no process spawned)
 *   UriLSP.onNotification(function (n) { console.log(n.method, n.params); });
 *   var res = await UriLSP.request('textDocument/completion', { textDocument: { uri, languageId: 'python' }, position });
 *   UriLSP.disconnect('python');
 *
 * Local adapter mode:
 *   - JS/TS: delegates to Monaco's built-in TS service (no-op passthrough; Monaco keeps providing IntelliSense).
 *   - Other languages: returns empty results gracefully.
 *
 * UriLSP.provideCompletions(monaco, model, position) merges local Monaco results with (currently none) server results.
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
  var connections = {};    // lang -> { lang, adapter, connected }
  var notificationHandlers = [];

  function normLang(lang) { return String(lang || "").toLowerCase(); }

  function isJsTs(lang) {
    var l = normLang(lang);
    return l === "javascript" || l === "js" || l === "typescript" || l === "ts" ||
      l === "jsx" || l === "tsx" || l === "json";
  }

  function adapterFor(lang) { return isJsTs(lang) ? "monaco-ts" : "empty"; }

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

    connect: function (lang) {
      lang = normLang(lang);
      var conn = { lang: lang, adapter: adapterFor(lang), connected: true, server: servers[lang] || null };
      connections[lang] = conn;
      // Local adapter: no process spawning. Resolve on next tick.
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(conn); }, 0);
      });
    },

    disconnect: function (lang) {
      lang = normLang(lang);
      delete connections[lang];
    },

    onNotification: function (handler) {
      if (typeof handler !== "function") return function () {};
      notificationHandlers.push(handler);
      return function () {
        var i = notificationHandlers.indexOf(handler);
        if (i >= 0) notificationHandlers.splice(i, 1);
      };
    },

    request: function (method, params) {
      params = params || {};
      var lang = langFromParams(params);
      // Resolve target connection if possible, but local adapters return empty results.
      var conn = null;
      if (lang) conn = connections[normLang(lang)] || null;
      if (!conn) {
        var keys = Object.keys(connections);
        if (keys.length) conn = connections[keys[0]];
      }
      // JS/TS delegates to Monaco's built-in TS service: no-op passthrough.
      if (conn && conn.adapter === "monaco-ts") {
        return Promise.resolve(emptyResult(method));
      }
      // Other languages (or none): empty results gracefully.
      return Promise.resolve(emptyResult(method));
    },

    provideCompletions: function (monaco, model, position) {
      var self = api;
      var lang = null;
      try { if (model && typeof model.getLanguageId === "function") lang = model.getLanguageId(); } catch (e) {}
      // Local Monaco results are provided by Monaco itself; gather (none) server results.
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
        // Monaco built-in suggestions are delivered by Monaco's own providers;
        // this hook only merges in any LSP/server suggestions (none yet).
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
