/* Sistema de extensiones de Uri Code.
 *
 * Formato de manifiesto:
 *   {
 *     id: "sample",
 *     name: "Ejemplo",
 *     version: "1.0.0",
 *     main: function (api) { api.registerCommand("sample.hello", function () { api.toast("Hola"); }); },
 *     contributes: { commands: [{ id: "sample.hello", title: "Ejemplo: Saludar" }] }
 *   }
 *
 * Las extensiones se cargan desde window.URI_EXTENSIONS (array de manifiestos)
 * o mediante loadManifest() en tiempo de ejecución.
 */
(function (root) {
  "use strict";

  var manifests = {};   // id -> manifest
  var actives = {};     // id -> { api, exports, deactivate }
  var commands = {};    // commandId -> { fn, title, extensionId }
  var hosts = [];       // handlers de UI (toast, etc.)

  function log(msg) { try { console.log("[extensions] " + msg); } catch (e) {} }

  /* La API que recibe cada extensión. */
  function makeApi(id) {
    return {
      id: id,
      registerCommand: function (cmdId, fn, title) {
        commands[cmdId] = { fn: fn, title: title || cmdId, extensionId: id };
        log("comando registrado: " + cmdId);
      },
      contribute: function (contrib) {
        var m = manifests[id];
        if (!m) return;
        m.contributes = m.contributes || {};
        Object.keys(contrib || {}).forEach(function (k) {
          m.contributes[k] = (m.contributes[k] || []).concat(contrib[k]);
        });
      },
      toast: function (msg, kind) {
        hosts.forEach(function (h) { try { h.toast(msg, kind); } catch (e) {} });
      },
      getCommand: function (cmdId) { return commands[cmdId] ? commands[cmdId].fn : null; }
    };
  }

  /* Registra un host que provee servicios de UI (toast, diálogo...). */
  function registerHost(h) { if (h && typeof h === "object") hosts.push(h); }

  function loadManifest(manifest) {
    if (!manifest || !manifest.id) return null;
    if (manifests[manifest.id]) return manifests[manifest.id];
    manifests[manifest.id] = manifest;
    log("manifiesto cargado: " + manifest.id);
    return manifest;
  }

  function activate(id) {
    var m = manifests[id];
    if (!m) return false;
    if (actives[id]) return true;
    var api = makeApi(id);
    var exports = {};
    try {
      if (typeof m.main === "function") exports = m.main(api) || {};
      else if (typeof m.main === "string") {
        // eval dentro de un scope con la API disponible
        exports = (new Function("api", "exports", m.main))(api, exports) || {};
      }
      actives[id] = { api: api, exports: exports, manifest: m };
      log("activada: " + id);
      return true;
    } catch (e) {
      log("error al activar " + id + ": " + (e && e.message || e));
      return false;
    }
  }

  function deactivate(id) {
    var a = actives[id];
    if (!a) return false;
    try { if (typeof a.exports.deactivate === "function") a.exports.deactivate(); } catch (e) {}
    delete actives[id];
    log("desactivada: " + id);
    return true;
  }

  function getContributions() {
    var out = { commands: [], extensions: [] };
    Object.keys(manifests).forEach(function (id) {
      var m = manifests[id];
      var cmds = (m.contributes && m.contributes.commands) || [];
      cmds.forEach(function (c) { out.commands.push({ id: c.id, title: c.title, extensionId: id }); });
      out.extensions.push({ id: id, name: m.name, version: m.version, active: !!actives[id] });
    });
    return out;
  }

  function registerCommand(cmdId, fn, title) {
    commands[cmdId] = { fn: fn, title: title || cmdId, extensionId: "externo" };
  }

  function runCommand(cmdId, arg) {
    var c = commands[cmdId];
    if (!c || typeof c.fn !== "function") return false;
    try { c.fn(arg); return true; } catch (e) { log("error en comando " + cmdId + ": " + (e && e.message || e)); return false; }
  }

  function getCommands() {
    return Object.keys(commands).map(function (k) {
      return { id: k, title: commands[k].title, extensionId: commands[k].extensionId };
    });
  }

  /* Carga las extensiones empaquetadas en window.URI_EXTENSIONS. */
  function loadBundled() {
    var list = root.URI_EXTENSIONS || [];
    for (var i = 0; i < list.length; i++) {
      var m = loadManifest(list[i]);
      if (m) activate(m.id);
    }
    return list.length;
  }

  var API = {
    loadManifest: loadManifest,
    activate: activate,
    deactivate: deactivate,
    getContributions: getContributions,
    getCommands: getCommands,
    registerCommand: registerCommand,
    runCommand: runCommand,
    registerHost: registerHost,
    loadBundled: loadBundled
  };

  root.UriExtensions = API;
})(typeof window !== "undefined" ? window : this);
