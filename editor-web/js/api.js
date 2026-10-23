/* Puente con el almacenamiento. En Android usa FileAPI (Java); en un navegador usa un sistema de archivos virtual. */
(function () {
  "use strict";

  var native = typeof window.FileAPI !== "undefined" && window.FileAPI &&
    typeof window.FileAPI.listDir === "function";

  /* ----- Sistema de archivos virtual (solo para probar en navegador) ----- */
  var VKEY = "uri.vfs";
  function vload() {
    try { return JSON.parse(localStorage.getItem(VKEY)) || { files: {}, dirs: [] }; }
    catch (e) { return { files: {}, dirs: [] }; }
  }
  function vsave(v) { try { localStorage.setItem(VKEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function vnorm(p) {
    var parts = String(p || "").split("/").filter(function (x) { return x && x !== "."; });
    if (parts.indexOf("..") >= 0) return null;
    return parts.join("/");
  }
  function vparent(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function vbase(p) { var i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
  function vmkdirp(v, p) {
    while (p) { if (v.dirs.indexOf(p) < 0) v.dirs.push(p); p = vparent(p); }
  }
  var virtual = {
    listDir: function (rel) {
      var p = vnorm(rel); if (p === null) return [];
      var v = vload(), out = [];
      v.dirs.forEach(function (d) { if (vparent(d) === p) out.push({ name: vbase(d), path: d, type: "dir", size: 0 }); });
      Object.keys(v.files).forEach(function (f) { if (vparent(f) === p) out.push({ name: vbase(f), path: f, type: "file", size: v.files[f].length }); });
      out.sort(function (a, b) {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
      });
      return out;
    },
    exists: function (rel) { var p = vnorm(rel); if (p === null) return false; var v = vload(); return p === "" || p in v.files || v.dirs.indexOf(p) >= 0; },
    readFile: function (rel) { var p = vnorm(rel); var v = vload(); return p !== null && p in v.files ? v.files[p] : ""; },
    writeFile: function (rel, content) { var p = vnorm(rel); if (!p) return false; var v = vload(); vmkdirp(v, vparent(p)); v.files[p] = content || ""; return vsave(v); },
    mkdir: function (rel) { var p = vnorm(rel); if (!p) return false; var v = vload(); vmkdirp(v, p); return vsave(v); },
    deleteItem: function (rel) {
      var p = vnorm(rel); if (!p) return false; var v = vload();
      Object.keys(v.files).forEach(function (f) { if (f === p || f.indexOf(p + "/") === 0) delete v.files[f]; });
      v.dirs = v.dirs.filter(function (d) { return !(d === p || d.indexOf(p + "/") === 0); });
      return vsave(v);
    },
    renameItem: function (a, b) {
      var from = vnorm(a), to = vnorm(b); if (!from || !to) return false;
      var v = vload(); if (to in v.files || v.dirs.indexOf(to) >= 0) return false;
      var files = {}, dirs = [];
      Object.keys(v.files).forEach(function (f) {
        if (f === from || f.indexOf(from + "/") === 0) files[to + f.slice(from.length)] = v.files[f]; else files[f] = v.files[f];
      });
      v.dirs.forEach(function (d) {
        if (d === from || d.indexOf(from + "/") === 0) dirs.push(to + d.slice(from.length)); else dirs.push(d);
      });
      v.files = files; v.dirs = dirs; vmkdirp(v, vparent(to)); return vsave(v);
    },
    getRoot: function () { return "(navegador)"; }
  };

  var backend = native ? window.FileAPI : virtual;

  function parseList(s) { try { return JSON.parse(s); } catch (e) { return []; } }

  var API = {
    isNative: native,
    listDir: function (rel) {
      var r = backend.listDir(rel || "");
      return Promise.resolve(typeof r === "string" ? parseList(r) : r);
    },
    exists: function (rel) { return Promise.resolve(!!backend.exists(rel || "")); },
    readFile: function (rel) { return Promise.resolve(String(backend.readFile(rel) || "")); },
    writeFile: function (rel, content) { return Promise.resolve(!!backend.writeFile(rel, content == null ? "" : String(content))); },
    mkdir: function (rel) { return Promise.resolve(!!backend.mkdir(rel)); },
    deleteItem: function (rel) { return Promise.resolve(!!backend.deleteItem(rel)); },
    renameItem: function (a, b) { return Promise.resolve(!!backend.renameItem(a, b)); },
    getRoot: function () { return Promise.resolve(String(backend.getRoot())); },
    runCommand: function (cmd, cwd) {
      if (native && typeof window.FileAPI.runCommand === "function") {
        try { return Promise.resolve(JSON.parse(window.FileAPI.runCommand(String(cmd || ""), cwd || ""))); }
        catch (e) { return Promise.resolve({ code: -1, stdout: "", stderr: String(e && e.message || e) }); }
      }
      return Promise.resolve({ code: -1, stdout: "", stderr: "No disponible en navegador" });
    },

    /* Comparte el texto de un archivo (hoja de compartir de Android; descarga en navegador). */
    shareText: function (name, text) {
      if (native && typeof window.FileAPI.shareText === "function") { window.FileAPI.shareText(name, text); return; }
      var url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    /* POST HTTP. En Android se hace desde Java (sin CORS); en navegador con fetch. */
    httpPost: function (url, headers, body) {
      if (native && typeof window.FileAPI.httpPost === "function") {
        return new Promise(function (resolve) {
          var id = "h" + (++API._n);
          var timer = setTimeout(function () {
            delete API._pending[id];
            resolve({ status: -1, text: "Tiempo de espera agotado" });
          }, 130000);
          API._pending[id] = function (status, text) { clearTimeout(timer); resolve({ status: status, text: text }); };
          try {
            window.FileAPI.httpPost(id, url, JSON.stringify(headers || {}), JSON.stringify(body || {}));
          } catch (e) {
            clearTimeout(timer); delete API._pending[id];
            resolve({ status: -1, text: String(e && e.message || e) });
          }
        });
      }
      var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = null;
      if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 130000);
      return fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body || {}), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); })
        .catch(function (e) { return { status: -1, text: String(e && e.message || e) }; })
        .then(function (res) { if (timer) clearTimeout(timer); return res; });
    },
    _n: 0,
    _pending: {}
  };

  /* Llamado desde Java cuando termina una peticion HTTP. */
  window.__uriHttpDone = function (id, status, b64) {
    var cb = API._pending[id];
    if (!cb) return;
    delete API._pending[id];
    var text = "";
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      text = new TextDecoder("utf-8").decode(bytes);
    } catch (e) { text = ""; }
    cb(status, text);
  };

  window.API = API;
})();
