/* Mock del puente nativo (FileAPI) que replica el contrato de
 * android_app/src/ai/uricode/app/MainActivity.java.
 *
 * Permite probar en Node el lado JS de la puente (sistema de archivos virtual,
 * ejecucion de comandos y llamadas HTTP) sin un dispositivo Android.
 */
"use strict";

var cp = require("child_process");

function norm(p) {
  var parts = String(p || "").split("/").filter(function (x) { return x && x !== "."; });
  if (parts.indexOf("..") >= 0) return null;
  return parts.join("/");
}
function parent(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
function base(p) { var i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }

function makeVfs(initial) {
  var v = initial || { files: {}, dirs: [] };
  return v;
}

/* Crea un FileAPI de prueba sobre un sistema de archivos virtual. */
function createFileAPI(opts) {
  opts = opts || {};
  var vfs = makeVfs(opts.vfs);
  var rootAbs = opts.root || "/data/app/projects";
  var web = opts.web;   // sandbox.window (para los callbacks)
  var lspProcs = {};    // id -> proceso (mismo contrato que MainActivity)

  function save() {
    if (opts.storage) {
      try { opts.storage.setItem("uri.vfs", JSON.stringify(vfs)); } catch (e) {}
    }
  }
  function mkdirp(p) {
    while (p) { if (vfs.dirs.indexOf(p) < 0) vfs.dirs.push(p); p = parent(p); }
  }

  var API = {
    listDir: function (rel) {
      var p = norm(rel);
      if (p === null) return "[]";
      var out = [];
      vfs.dirs.forEach(function (d) { if (parent(d) === p) out.push({ name: base(d), path: d, type: "dir", size: 0 }); });
      Object.keys(vfs.files).forEach(function (f) { if (parent(f) === p) out.push({ name: base(f), path: f, type: "file", size: vfs.files[f].length }); });
      out.sort(function (a, b) {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
      });
      return JSON.stringify(out);
    },
    exists: function (rel) {
      var p = norm(rel);
      if (p === null) return false;
      return p === "" || p in vfs.files || vfs.dirs.indexOf(p) >= 0;
    },
    readFile: function (rel) {
      var p = norm(rel);
      if (p === null || !(p in vfs.files)) return "";
      return vfs.files[p];
    },
    writeFile: function (rel, content) {
      var p = norm(rel);
      if (!p) return false;
      mkdirp(parent(p));
      vfs.files[p] = content == null ? "" : String(content);
      save();
      return true;
    },
    mkdir: function (rel) {
      var p = norm(rel);
      if (!p) return false;
      mkdirp(p);
      save();
      return true;
    },
    deleteItem: function (rel) {
      var p = norm(rel);
      if (!p) return false;
      Object.keys(vfs.files).forEach(function (f) { if (f === p || f.indexOf(p + "/") === 0) delete vfs.files[f]; });
      vfs.dirs = vfs.dirs.filter(function (d) { return !(d === p || d.indexOf(p + "/") === 0); });
      save();
      return true;
    },
    renameItem: function (a, b) {
      var from = norm(a), to = norm(b);
      if (!from || !to) return false;
      if (to in vfs.files || vfs.dirs.indexOf(to) >= 0) return false;
      var files = {}, dirs = [];
      Object.keys(vfs.files).forEach(function (f) {
        if (f === from || f.indexOf(from + "/") === 0) files[to + f.slice(from.length)] = vfs.files[f];
        else files[f] = vfs.files[f];
      });
      vfs.dirs.forEach(function (d) {
        if (d === from || d.indexOf(from + "/") === 0) dirs.push(to + d.slice(from.length));
        else dirs.push(d);
      });
      vfs.files = files; vfs.dirs = dirs;
      mkdirp(parent(to));
      save();
      return true;
    },
    getRoot: function () { return rootAbs; },

    /* Mismo contrato que MainActivity.runCommand: JSON {code,stdout,stderr}. */
    runCommand: function (cmd, relCwd) {
      if (!cmd || !String(cmd).trim()) return JSON.stringify({ code: -1, stdout: "", stderr: "empty" });
      try {
        var r = cp.spawnSync("/bin/sh", ["-c", String(cmd)], {
          cwd: opts.cwd && relCwd ? relCwd : undefined,
          encoding: "utf8",
          timeout: 30000
        });
        return JSON.stringify({
          code: r.status === null ? -1 : r.status,
          stdout: r.stdout || "",
          stderr: r.stderr || ""
        });
      } catch (e) {
        return JSON.stringify({ code: -1, stdout: "", stderr: String(e && e.message || e) });
      }
    },

    /* Contrato de runCommandStream: __uriTermChunk(id, b64) y __uriTermDone(id, code). */
    runCommandStream: function (id, cmd, relCwd) {
      var self = this;
      setTimeout(function () {
        try {
          var r = cp.spawnSync("/bin/sh", ["-c", String(cmd || "")], { encoding: "utf8", timeout: 30000 });
          var out = (r.stdout || "") + (r.stderr || "");
          if (out) {
            var b64 = Buffer.from(out, "utf8").toString("base64");
            if (web && web.__uriTermChunk) web.__uriTermChunk(id, b64);
          }
          if (web && web.__uriTermDone) web.__uriTermDone(id, r.status === null ? -1 : r.status);
        } catch (e) {
          if (web && web.__uriTermDone) web.__uriTermDone(id, -1);
        }
      }, 5);
    },

    /* Contrato de httpPost: __uriHttpDone(id, status, bodyBase64). */
    httpPost: function (id, url, headersJson, body) {
      var self = this;
      setTimeout(function () {
        if (!web || !web.__uriHttpDone) return;
        var parsed = {};
        try { parsed = JSON.parse(headersJson || "{}"); } catch (e) {}
        var payload = body == null ? "" : String(body);
        // Respuesta simulada: devuelve el cuerpo recibido con status 200.
        if (opts.httpResponder) {
          var res = opts.httpResponder(String(url), parsed, payload);
          if (res && typeof res === "object") {
            web.__uriHttpDone(id, res.status || 200, Buffer.from(res.body || "", "utf8").toString("base64"));
            return;
          }
        }
        web.__uriHttpDone(id, 200, Buffer.from(JSON.stringify({ ok: true, echo: payload }), "utf8").toString("base64"));
      }, 5);
    },

    /* Contrato LSP (mismas reglas que MainActivity.java): allowlist, spawn sin
     * shell, stdout en chunks base64 crudos, stderr por lineas, cierre con codigo. */
    startLsp: function (id, command, argsJson, relCwd) {
      var ALLOW = ["pylsp", "pyright-langserver", "typescript-language-server", "clangd",
        "gopls", "rust-analyzer", "jdtls", "lua-language-server"];
      if (!id || ALLOW.indexOf(String(command)) < 0) return false;
      var args;
      try { args = JSON.parse(argsJson || "[]"); } catch (e) { return false; }
      if (!Array.isArray(args)) return false;
      try {
        var pr = cp.spawn(String(command), args.map(String), {
          cwd: relCwd && opts.cwd ? String(relCwd) : undefined
        });
        lspProcs[id] = pr;
        pr.stdout.on("data", function (chunk) {
          if (web && web.__uriLspData) web.__uriLspData(id, chunk.toString("base64"));
        });
        var errRest = "";
        pr.stderr.on("data", function (chunk) {
          errRest += chunk.toString("utf8");
          var lines = errRest.split("\n");
          errRest = lines.pop();
          lines.forEach(function (l) {
            if (web && web.__uriLspError) web.__uriLspError(id, Buffer.from(l, "utf8").toString("base64"));
          });
        });
        pr.on("exit", function (code) {
          delete lspProcs[id];
          if (web && web.__uriLspClosed) web.__uriLspClosed(id, code === null ? -1 : code);
        });
        pr.on("error", function () {
          delete lspProcs[id];
          if (web && web.__uriLspClosed) web.__uriLspClosed(id, -1);
        });
        return true;
      } catch (e) {
        return false;
      }
    },
    sendLsp: function (id, b64) {
      var pr = lspProcs[id];
      if (!pr) return false;
      try {
        pr.stdin.write(Buffer.from(String(b64), "base64"));
        return true;
      } catch (e) {
        return false;
      }
    },
    stopLsp: function (id) {
      var pr = lspProcs[id];
      if (!pr) return false;
      delete lspProcs[id];
      try { pr.kill(); } catch (e) {}
      return true;
    }
  };
  return API;
}

module.exports = { createFileAPI: createFileAPI };
