#!/usr/bin/env python3
"""Uri Code — servidor de escritorio para Linux/macOS/Windows.

Permite usar Uri Code en cualquier navegador sin instalar Electron ni npm.
Sirve la interfaz web (editor-web/) y expone un puente FileAPI por HTTP/JSON
equivalente al puente nativo de Android (MainActivity.java FileAPI).

Uso:
    python3 server.py [carpeta-raiz] [puerto]

Por defecto la raiz es el directorio actual y el puerto 8765.
Abrir en el navegador: http://127.0.0.1:8765
"""
import http.server
import json
import os
import shutil
import subprocess
import sys
import urllib.parse

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
PORT = int(sys.argv[2] if len(sys.argv) > 2 else 8765)
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "editor-web")

# Procesos activos (shells y LSP) — estado en memoria
PROCS = {}
PROCS_LOCK = __import__("threading").Lock()


def resolve(rel):
    """Resuelve una ruta relativa dentro del sandbox ROOT."""
    if rel is None or rel == "" or rel == "/":
        return ROOT
    parts = [p for p in str(rel).split("/") if p and p != "."]
    if ".." in parts:
        return None
    resolved = os.path.realpath(os.path.join(ROOT, *parts))
    if not (resolved == ROOT or resolved.startswith(ROOT + os.sep)):
        return None
    return resolved


def rel_of(abs_path):
    if not abs_path or not abs_path.startswith(ROOT):
        return ""
    return abs_path[len(ROOT):].lstrip(os.sep).replace(os.sep, "/")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.serve_index()
            return
        super().do_GET()

    def serve_index(self):
        """Sirve index.html inyectando el puente FileAPI (REST) en el HTML."""
        full = os.path.join(WEB_DIR, "index.html")
        try:
            with open(full, "r", encoding="utf-8") as fh:
                html = fh.read()
            bridge = self._bridge_script()
            html = html.replace("</head>", bridge + "</head>", 1)
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except Exception:
            pass
        super().do_GET()

    def _bridge_script(self):
        return r"""
<script>
  (function () {
    function call(endpoint, data) {
      return fetch("/api/" + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {})
      }).then(function (r) { return r.json(); }).then(function (j) { return j.result || {}; });
    }
    window.FileAPI = {
      getRoot: function () { return call("getRoot", {}); },
      listDir: function (rel) { return call("listDir", { rel: rel || "" }); },
      exists: function (rel) { return call("exists", { rel: rel || "" }); },
      readFile: function (rel) { return call("readFile", { rel: rel || "" }); },
      writeFile: function (rel, content) { return call("writeFile", { rel: rel || "", content: content == null ? "" : String(content) }); },
      mkdir: function (rel) { return call("mkdir", { rel: rel || "" }); },
      deleteItem: function (rel) { return call("deleteItem", { rel: rel || "" }); },
      renameItem: function (a, b) { return call("renameItem", { oldRel: a || "", newRel: b || "" }); },
      shareText: function (name, text) { try { navigator.clipboard.writeText(text); } catch (e) {} return true; },
      runCommand: function (cmd, cwd) { return call("runCommand", { cmd: cmd || "", relCwd: cwd || "" }); },
      runCommandStream: function (id, cmd, cwd) {
        call("runCommand", { cmd: cmd || "", relCwd: cwd || "" }).then(function (r) {
          if (r && r.stdout) {
            var b64 = btoa(unescape(encodeURIComponent(r.stdout)));
            if (window.__uriTermChunk) window.__uriTermChunk(id, b64);
          }
          if (r && r.stderr) {
            var b64e = btoa(unescape(encodeURIComponent(r.stderr)));
            if (window.__uriTermChunk) window.__uriTermChunk(id, b64e);
          }
          if (window.__uriTermDone) window.__uriTermDone(id, r ? r.code : -1);
        }).catch(function () {
          if (window.__uriTermDone) window.__uriTermDone(id, -1);
        });
      },
      startShell: function () { return false; },
      sendToShell: function () { return false; },
      stopShell: function () { return false; },
      startLsp: function () { return false; },
      sendLsp: function () { return false; },
      stopLsp: function () { return false; },
      httpPost: function (id, url, headersJson, body) {
        fetch(url, {
          method: "POST",
          headers: (function () { try { return JSON.parse(headersJson || "{}"); } catch (e) { return {}; } })(),
          body: (typeof body === "string" ? body : JSON.stringify(body || {}))
        }).then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); })
          .then(function (res) {
            var b64 = btoa(unescape(encodeURIComponent(res.text)));
            if (window.__uriHttpDone) window.__uriHttpDone(id, res.status, b64);
          }).catch(function (e) {
            var b64 = btoa(unescape(encodeURIComponent(String(e.message))));
            if (window.__uriHttpDone) window.__uriHttpDone(id, 0, b64);
          });
      }
    };
    window.__nativeCallbacks = window.__nativeCallbacks || {};
  })();
</script>
"""

    def do_POST(self):
        if not self.path.startswith("/api/"):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                data = {}
            endpoint = self.path[len("/api/"):]
            result = dispatch(endpoint, data)
            body = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            body = json.dumps({"result": None, "error": str(e)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def dispatch(endpoint, data):
    if endpoint == "getRoot":
        return {"result": ROOT}

    if endpoint == "listDir":
        d = resolve(data.get("rel", ""))
        if d is None or not os.path.isdir(d):
            return {"result": []}
        try:
            entries = []
            for name in sorted(os.listdir(d), key=lambda x: (not os.path.isdir(os.path.join(d, x)), x.lower())):
                full = os.path.join(d, name)
                try:
                    st = os.stat(full)
                    entries.append({
                        "name": name,
                        "path": rel_of(full),
                        "type": "dir" if os.path.isdir(full) else "file",
                        "size": st.st_size if os.path.isfile(full) else 0
                    })
                except OSError:
                    pass
            return {"result": entries}
        except OSError:
            return {"result": []}

    if endpoint == "exists":
        f = resolve(data.get("rel", ""))
        return {"result": f is not None and os.path.exists(f)}

    if endpoint == "readFile":
        f = resolve(data.get("rel", ""))
        if f is None or not os.path.isfile(f):
            return {"result": ""}
        try:
            if os.path.getsize(f) > 10000000:
                return {"result": ""}
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                return {"result": fh.read()}
        except OSError:
            return {"result": ""}

    if endpoint == "writeFile":
        f = resolve(data.get("rel", ""))
        if f is None or f == ROOT or os.path.isdir(f):
            return {"result": False}
        try:
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(data.get("content", "") or "")
            return {"result": True}
        except OSError:
            return {"result": False}

    if endpoint == "mkdir":
        f = resolve(data.get("rel", ""))
        if f is None:
            return {"result": False}
        try:
            if os.path.isdir(f):
                return {"result": True}
            os.makedirs(f, exist_ok=True)
            return {"result": True}
        except OSError:
            return {"result": False}

    if endpoint == "deleteItem":
        f = resolve(data.get("rel", ""))
        if f is None or f == ROOT:
            return {"result": False}
        try:
            if os.path.isdir(f) and not os.path.islink(f):
                shutil.rmtree(f)
            else:
                os.remove(f)
            return {"result": True}
        except OSError:
            return {"result": False}

    if endpoint == "renameItem":
        old_f = resolve(data.get("oldRel", ""))
        new_f = resolve(data.get("newRel", ""))
        if old_f is None or new_f is None or old_f == ROOT or os.path.exists(new_f):
            return {"result": False}
        try:
            os.makedirs(os.path.dirname(new_f), exist_ok=True)
            os.rename(old_f, new_f)
            return {"result": True}
        except OSError:
            return {"result": False}

    if endpoint == "runCommand":
        cmd = data.get("cmd", "")
        if not cmd or not str(cmd).strip():
            return {"result": {"code": -1, "stdout": "", "stderr": "empty"}}
        cwd = resolve(data.get("relCwd", ""))
        if cwd is None or not os.path.isdir(cwd):
            cwd = ROOT
        try:
            proc = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=30)
            return {"result": {"code": proc.returncode, "stdout": proc.stdout or "", "stderr": proc.stderr or ""}}
        except subprocess.TimeoutExpired:
            return {"result": {"code": -1, "stdout": "", "stderr": "timeout"}}
        except Exception as e:
            return {"result": {"code": -1, "stdout": "", "stderr": str(e)}}

    if endpoint == "httpPost":
        return {"result": {"status": 200, "text": "{}"}}

    if endpoint == "shareText":
        return {"result": True}

    return {"result": None}


def main():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Uri Code — servidor en http://127.0.0.1:%d" % PORT)
    print("Raiz de archivos: %s" % ROOT)
    print("Interfaz web: %s" % WEB_DIR)
    print("Pulsa Ctrl+C para detener.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")
        httpd.shutdown()


if __name__ == "__main__":
    main()