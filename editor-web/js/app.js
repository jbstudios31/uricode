/* Uri Code — aplicación principal */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isNarrow() { return window.matchMedia("(max-width: 760px)").matches; }
  function isCoarse() { return window.matchMedia("(pointer: coarse)").matches; }
  function baseName(p) { var i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
  function dirName(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function join(dir, name) { return dir ? dir + "/" + name : name; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function gitStatusKind(status) {
    status = String(status || "").toUpperCase();
    if (status === "A") return "added";
    if (status === "D") return "deleted";
    if (status === "?") return "untracked";
    return "modified";
  }

  function decodeGitPath(path) {
    path = String(path || "");
    if (path.length < 2 || path.charAt(0) !== '"' || path.charAt(path.length - 1) !== '"') return path;
    var body = path.slice(1, -1), bytes = [], i = 0;
    var escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
    while (i < body.length) {
      var ch = body.charAt(i);
      if (ch !== "\\") {
        var code = body.charCodeAt(i++);
        if (code < 128) bytes.push(code);
        else if (code < 2048) {
          bytes.push(192 | (code >> 6), 128 | (code & 63));
        } else {
          bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
        }
        continue;
      }
      i++;
      var esc = body.charAt(i++);
      if (esc >= "0" && esc <= "7") {
        var octal = esc;
        while (octal.length < 3 && body.charAt(i) >= "0" && body.charAt(i) <= "7") octal += body.charAt(i++);
        bytes.push(parseInt(octal, 8));
      } else {
        bytes.push(escapes[esc] != null ? escapes[esc] : esc.charCodeAt(0));
      }
    }
    try {
      var encoded = bytes.map(function (b) { return "%" + ("0" + b.toString(16)).slice(-2); }).join("");
      return decodeURIComponent(encoded);
    } catch (e) {
      return path;
    }
  }

  function splitGitRenamePath(raw) {
    raw = String(raw || "");
    var quoted = false;
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (quoted && ch === "\\") { i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (!quoted && raw.substr(i, 4) === " -> ") {
        return {
          oldPath: decodeGitPath(raw.slice(0, i)),
          path: decodeGitPath(raw.slice(i + 4))
        };
      }
    }
    return { path: decodeGitPath(raw) };
  }

  function parseGitStatus(output) {
    var entries = [];
    String(output || "").split(/\r?\n/).forEach(function (line) {
      if (line.length < 4 || line.charAt(2) !== " ") return;
      var indexStatus = line.charAt(0), worktreeStatus = line.charAt(1);
      if (indexStatus === "!" && worktreeStatus === "!") return;
      var split = splitGitRenamePath(line.slice(3));
      if (!split.path) return;
      if (indexStatus === "?" && worktreeStatus === "?") {
        entries.push({
          path: split.path,
          status: "?",
          staged: false,
          kind: "untracked",
          statusCode: "??",
          indexStatus: "?",
          worktreeStatus: "?"
        });
        return;
      }
      if (indexStatus !== " " && indexStatus !== "?") {
        entries.push({
          path: split.path,
          status: indexStatus,
          staged: true,
          kind: gitStatusKind(indexStatus),
          statusCode: indexStatus + worktreeStatus,
          indexStatus: indexStatus,
          worktreeStatus: worktreeStatus
        });
      }
      if (worktreeStatus !== " " && worktreeStatus !== "?") {
        entries.push({
          path: split.path,
          status: worktreeStatus,
          staged: false,
          kind: gitStatusKind(worktreeStatus),
          statusCode: indexStatus + worktreeStatus,
          indexStatus: indexStatus,
          worktreeStatus: worktreeStatus
        });
      }
    });
    return entries;
  }

  function parseGitBranches(output) {
    var branches = [];
    String(output || "").split(/\r?\n/).forEach(function (line) {
      var name = line.trim();
      if (!name) return;
      if (name.charAt(0) === "*" || name.charAt(0) === "+") name = name.slice(1).trim();
      if (!name || name.indexOf("HEAD detached") >= 0) return;
      var arrow = name.indexOf(" -> ");
      if (arrow >= 0) name = name.slice(0, arrow);
      if (branches.indexOf(name) < 0) branches.push(name);
    });
    return branches;
  }

  /* ================= Lenguajes ================= */
  var EXT_LANG = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", py: "python", pyw: "python",
    html: "html", htm: "html", css: "css", scss: "scss", less: "less",
    json: "json", jsonc: "json", webmanifest: "json", md: "markdown", markdown: "markdown",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp", java: "java",
    kt: "kotlin", kts: "kotlin", rs: "rust", go: "go", sh: "shell", bash: "shell", zsh: "shell",
    bat: "bat", cmd: "bat", ps1: "powershell", xml: "xml", svg: "xml", xsd: "xml",
    yml: "yaml", yaml: "yaml", sql: "sql", php: "php", rb: "ruby", swift: "swift", lua: "lua",
    ini: "ini", toml: "ini", cfg: "ini", conf: "ini", txt: "plaintext", log: "plaintext"
  };
  var NAME_LANG = { "dockerfile": "dockerfile", "makefile": "plaintext", ".gitignore": "plaintext" };
  var LANG_NAMES = {
    javascript: "JavaScript", typescript: "TypeScript", python: "Python", html: "HTML", css: "CSS", scss: "SCSS",
    less: "Less", json: "JSON", markdown: "Markdown", c: "C", cpp: "C++", csharp: "C#", java: "Java", kotlin: "Kotlin",
    rust: "Rust", go: "Go", shell: "Shell Script", bat: "Batch", powershell: "PowerShell", xml: "XML", yaml: "YAML",
    sql: "SQL", php: "PHP", ruby: "Ruby", swift: "Swift", lua: "Lua", ini: "INI", dockerfile: "Dockerfile",
    plaintext: "Texto sin formato"
  };
  function langOf(path) {
    var name = baseName(path).toLowerCase();
    if (NAME_LANG[name]) return NAME_LANG[name];
    var dot = name.lastIndexOf(".");
    return (dot >= 0 && EXT_LANG[name.slice(dot + 1)]) || "plaintext";
  }

  /* ================= Estado ================= */
  var SETTINGS = [
    { id: "fontSize", label: "Tamaño de fuente", type: "number", default: 14, min: 8, max: 32, category: "general", description: "Tamaño del texto del editor en píxeles." },
    { id: "wordWrap", label: "Ajuste de línea", type: "checkbox", default: true, category: "general", description: "Ajusta automáticamente las líneas largas al ancho del editor." },
    { id: "minimap", label: "Mostrar minimapa", type: "checkbox", default: null, category: "general", description: "Muestra una vista general del documento junto al editor." },
    { id: "minimapSide", label: "Posición del minimapa", type: "select", default: "right", category: "general", description: "Elige si el minimapa aparece a la izquierda o a la derecha.", options: [
      { value: "right", label: "Derecha" }, { value: "left", label: "Izquierda" }
    ] },
    { id: "autoSave", label: "Guardado automático", type: "checkbox", default: true, category: "general", description: "Guarda los cambios automáticamente después de unos segundos." },
    { id: "theme", label: "Tema", type: "select", default: "dark", domId: "setTheme", category: "general", description: "Selecciona el tema oscuro o claro de Uri Code.", options: [
      { value: "dark", label: "Oscuro (Dark+)" }, { value: "light", label: "Claro (Light+)" }
    ] },
    { id: "tabSize", label: "Tamaño de tabulación", type: "number", default: 4, min: 1, max: 16, category: "editor", description: "Número de espacios que forman una tabulación." },
    { id: "insertSpaces", label: "Insertar espacios", type: "checkbox", default: true, category: "editor", description: "Usa espacios en lugar del carácter de tabulación al indentar." },
    { id: "renderWhitespace", label: "Mostrar espacios en blanco", type: "select", default: "selection", category: "editor", description: "Controla cuándo Monaco dibuja espacios, tabulaciones y saltos de línea.", options: [
      { value: "selection", label: "Solo selección" }, { value: "all", label: "Todo" }, { value: "none", label: "Ninguno" }
    ] },
    { id: "formatOnSave", label: "Formatear al guardar", type: "checkbox", default: false, category: "editor", description: "Ejecuta Prettier antes de escribir un archivo en el disco." },
    { id: "cursorBlink", label: "Cursor parpadeante", type: "checkbox", default: true, category: "editor", description: "Permite que el cursor parpadee mientras el editor está inactivo." },
    { id: "smoothScrolling", label: "Desplazamiento suave", type: "checkbox", default: true, category: "editor", description: "Suaviza el desplazamiento vertical del editor." },
    { id: "snippets", label: "Snippets", type: "textarea", default: "", domId: "setSnippets", category: "editor", description: "Snippets JSON. Usa $1 y ${1:valor} para definir posiciones de tabulación." },
    { id: "nimKey", label: "API Key", type: "text", default: "", domId: "setKey", secret: true, category: "chat", description: "Clave de NVIDIA NIM. Se guarda únicamente en este dispositivo." },
    { id: "nimModel", label: "Modelo", type: "text", default: "meta/llama-3.1-8b-instruct", domId: "setModel", category: "chat", description: "Modelo de NVIDIA NIM utilizado por el chat IA." },
    { id: "extensionsEnabled", label: "Habilitar extensiones", type: "checkbox", default: true, category: "extensions", description: "Activa las extensiones instaladas y sus comandos." },
    { id: "diagnosticsEnabled", label: "Mostrar diagnósticos", type: "checkbox", default: true, category: "diagnostic", description: "Muestra errores y avisos en la vista Problemas." }
  ];
  var CATEGORIES = [
    { id: "general", label: "General" },
    { id: "editor", label: "Editor" },
    { id: "chat", label: "Chat IA" },
    { id: "extensions", label: "Extensiones" },
    { id: "diagnostic", label: "Diagnóstico" }
  ];
  var DEFAULTS = SETTINGS.reduce(function (values, setting) {
    values[setting.id] = setting.default;
    return values;
  }, {});
  var DEFAULT_KEYBINDINGS = [
    { command: "file.goToFile", label: "Ir a archivo", key: "Ctrl+P", aliases: ["file.quickOpen"] },
    { command: "workbench.showCommands", label: "Paleta de comandos", key: "Ctrl+Shift+P", aliases: ["workbench.action.showCommands"] },
    { command: "file.save", label: "Guardar", key: "Ctrl+S", aliases: ["workbench.action.files.save"] },
    { command: "editor.find", label: "Buscar en el editor", key: "Ctrl+F", aliases: ["actions.find", "editor.action.find"] },
    { command: "editor.gotoLine", label: "Ir a línea", key: "Ctrl+G", aliases: ["editor.action.gotoLine"] },
    { command: "workbench.toggleSidebar", label: "Alternar barra lateral", key: "Ctrl+B", aliases: ["workbench.action.toggleSidebar"] },
    { command: "terminal.focus", label: "Mostrar terminal", key: "Ctrl+`", aliases: ["workbench.action.terminal.focus"] }
  ];
  var APP_VERSION = "3.0.0";
  var UPDATE_REPO = "jbstudios31/uricode";

  var S = {
    settings: Object.assign({}, DEFAULTS),
    keybindingOverrides: {},
    registeredKeybindings: [],
    settingsCategory: "general",
    settingsQuery: "",
    tabs: [],             // {path, lang, savedVersion, dirty}
    active: -1,
    expanded: {},         // ruta -> true
    dirCache: {},         // ruta -> [{name,path,type,size}]
    selected: "",         // ruta seleccionada en el explorador
    selectedType: "dir",
    view: "explorer",
    opening: {},
    autoTimer: null,
    fileListCache: null,
    searchToken: 0,
    roots: [],            // carpetas raíz del workspace (rutas relativas al sandbox)
    rootsLoaded: false,
    problemMarkers: [],
    outputLines: [],
    terminalFocusHandler: null,
    keybarVisible: true
  };

  /* ---------- Workspace multi-raíz ---------- */
  function loadRoots() {
    if (S.rootsLoaded) return Promise.resolve(S.roots);
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem("uri.roots") || "[]"); } catch (e) {}
    if (!Array.isArray(saved)) saved = [];
    // Las raices son rutas relativas dentro de la carpeta de proyectos del sandbox.
    saved = saved.filter(function (r) { return typeof r === "string"; })
      .map(function (r) { return r.replace(/^\/+/, "").replace(/\/+$/, ""); })
      .filter(function (r, i, a) { return a.indexOf(r) === i; });
    if (!saved.length) saved = [""];
    S.roots = saved;
    S.rootsLoaded = true;
    S.roots.forEach(function (x) { S.expanded[x] = true; });
    return API.getRoot().then(function (r) {
      S.rootAbs = String(r || "").trim();
      return S.roots;
    }).catch(function () { return S.roots; });
  }
  function saveRoots() {
    try { localStorage.setItem("uri.roots", JSON.stringify(S.roots)); } catch (e) {}
  }
  function rootName(root) {
    if (!root) {
      if (!S.rootAbs || S.rootAbs === "(navegador)") return "Proyecto";
      return baseName(S.rootAbs) || "Proyecto";
    }
    var n = baseName(root);
    return n || root;
  }
  function addRoot(path) {
    path = String(path || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (S.roots.indexOf(path) >= 0) return false;
    S.roots.push(path);
    S.expanded[path] = true;
    saveRoots();
    return true;
  }
  function removeRoot(path) {
    if (S.roots.length <= 1) return false;
    var i = S.roots.indexOf(path);
    if (i < 0) return false;
    S.roots.splice(i, 1);
    // limpiar caché de las rutas bajo esa raíz
    if (path) {
      Object.keys(S.dirCache).forEach(function (k) { if (k.indexOf(path) === 0) delete S.dirCache[k]; });
      Object.keys(S.expanded).forEach(function (k) { if (k.indexOf(path) === 0) delete S.expanded[k]; });
    }
    saveRoots();
    return true;
  }

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem("uri.settings")) || {}; } catch (e) {}
    S.settings = Object.assign({}, DEFAULTS, s);
    if (S.settings.minimap === null) S.settings.minimap = !isNarrow();
  }
  function saveSettings() {
    try { localStorage.setItem("uri.settings", JSON.stringify(S.settings)); } catch (e) {}
  }
  function keybindingDefinition(command) {
    var name = String(command || "");
    return DEFAULT_KEYBINDINGS.find(function (binding) {
      return binding.command === name || binding.aliases.indexOf(name) >= 0;
    }) || null;
  }
  function normalizeKey(value) {
    var parts = String(value == null ? "" : value).trim().split("+").map(function (part) { return part.trim(); }).filter(Boolean);
    if (!parts.length) return "";
    var key = parts.pop();
    var modifiers = { ctrl: "Ctrl", control: "Ctrl", cmd: "Ctrl", meta: "Ctrl", shift: "Shift", alt: "Alt", option: "Alt" };
    var found = { Ctrl: false, Shift: false, Alt: false };
    parts.forEach(function (part) {
      var modifier = modifiers[part.toLowerCase()];
      if (modifier) found[modifier] = true;
      else key = part;
    });
    if (key.length === 1) key = key.toUpperCase();
    var result = [];
    if (found.Ctrl) result.push("Ctrl");
    if (found.Shift) result.push("Shift");
    if (found.Alt) result.push("Alt");
    result.push(key);
    return result.join("+");
  }
  function loadKeybindings() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem("uri.keybindings")) || []; } catch (e) {}
    if (!Array.isArray(saved)) saved = [];
    S.keybindingOverrides = {};
    saved.forEach(function (entry) {
      if (!entry || typeof entry.command !== "string") return;
      var definition = keybindingDefinition(entry.command);
      if (!definition || typeof entry.key !== "string" || !entry.key.trim()) return;
      S.keybindingOverrides[definition.command] = normalizeKey(entry.key);
    });
    registerKeybindings();
    try {
      if (localStorage.getItem("uri.keybindings") === null) localStorage.setItem("uri.keybindings", "[]");
    } catch (e) {}
  }
  function registerKeybindings() {
    S.registeredKeybindings = DEFAULT_KEYBINDINGS.map(function (binding) {
      return {
        command: binding.command,
        label: binding.label,
        key: S.keybindingOverrides[binding.command] || binding.key,
        defaultKey: binding.key
      };
    });
    if (typeof COMMANDS !== "undefined") {
      var hints = {
        "Archivo: Guardar": "file.save",
        "Ir a archivo…": "file.goToFile",
        "Ver: Alternar barra lateral": "workbench.toggleSidebar",
        "Editor: Buscar": "editor.find",
        "Editor: Ir a línea…": "editor.gotoLine"
      };
      Object.keys(hints).forEach(function (label) {
        var command = COMMANDS.find(function (entry) { return entry.label === label; });
        if (command) command.key = keyHint(hints[label]);
      });
    }
  }
  function keyHint(command) {
    var binding = S.registeredKeybindings.find(function (entry) { return entry.command === command; });
    return binding ? binding.key : "";
  }
  function saveKeybindings() {
    var saved = Object.keys(S.keybindingOverrides).map(function (command) {
      return { command: command, key: S.keybindingOverrides[command] };
    });
    try { localStorage.setItem("uri.keybindings", JSON.stringify(saved)); } catch (e) {}
    registerKeybindings();
  }
  function setKeybinding(command, key) {
    var definition = keybindingDefinition(command);
    if (!definition) return false;
    var normalized = normalizeKey(key);
    if (!normalized) delete S.keybindingOverrides[definition.command];
    else S.keybindingOverrides[definition.command] = normalized;
    saveKeybindings();
    return true;
  }
  function resetKeybindings() {
    S.keybindingOverrides = {};
    try { localStorage.setItem("uri.keybindings", "[]"); } catch (e) {}
    registerKeybindings();
  }

  /* ================= Avisos, diálogos y menús ================= */
  var toastTimer = null;
  function outputTimestamp() {
    var d = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function outputLine(time, msg, kind) {
    var line = document.createElement("div");
    line.className = "output-line" + (kind === "error" ? " error" : "");
    line.setAttribute("data-time", time);
    line.textContent = "[" + time + "] " + String(msg == null ? "" : msg);
    return line;
  }
  function log(msg, kind) {
    var time = outputTimestamp();
    var text = String(msg == null ? "" : msg);
    S.outputLines.push({ time: time, text: text, kind: kind || "" });
    if (S.outputLines.length > 500) S.outputLines.shift();
    var box = $("outputLog");
    if (box) {
      box.appendChild(outputLine(time, text, kind));
      var children = box._children || box.children || [];
      while (children.length > 500) box.removeChild(children[0]);
      box.scrollTop = box.scrollHeight;
    }
    return text;
  }
  function renderOutput() {
    var box = $("outputLog");
    if (!box) return;
    box.innerHTML = "";
    S.outputLines.forEach(function (entry) {
      box.appendChild(outputLine(entry.time, entry.text, entry.kind));
    });
    box.scrollTop = box.scrollHeight;
  }
  function haptic(pattern) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(pattern || 12); } catch (e) {}
  }

  function toast(msg, kind, options) {
    log(msg, kind);
    var t = $("toast");
    if (!t) return;
    options = options || {};
    t.textContent = msg;
    t.innerHTML = "";
    var message = document.createElement("span");
    message.className = "toast-message";
    message.textContent = msg;
    t.appendChild(message);
    if (options.action && options.action.label) {
      var action = document.createElement("button");
      action.id = "toastAction";
      action.className = "toast-action";
      action.type = "button";
      action.textContent = options.action.label;
      action.addEventListener("click", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (typeof options.action.run === "function") options.action.run();
      });
      t.appendChild(action);
    }
    t.setAttribute("data-message", msg);
    t.className = "show" + (kind === "error" ? " error" : "") + (options.action ? " has-action" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ""; }, options.duration || 2600);
  }

  var dialogResolve = null;
  function dialog(o) {
    return new Promise(function (resolve) {
      if (dialogResolve) dialogResolve({ button: "cancel", value: "" });
      dialogResolve = resolve;
      $("dlgTitle").textContent = o.title || "";
      $("dlgMsg").textContent = o.message || "";
      var input = $("dlgInput");
      input.className = "dlg-input" + (o.input ? " show" : "");
      input.value = o.value || "";
      input.placeholder = o.placeholder || "";
      var box = $("dlgButtons");
      box.innerHTML = "";
      (o.buttons || [{ label: "Aceptar", value: "ok", primary: true }]).forEach(function (b) {
        var btn = document.createElement("button");
        btn.textContent = b.label;
        if (b.primary) btn.className = "primary";
        btn.addEventListener("click", function () { closeDialog(b.value); });
        box.appendChild(btn);
      });
      document.body.classList.add("dialog-open");
      if (o.input) { setTimeout(function () { input.focus(); input.select(); }, 30); }
    });
  }
  function closeDialog(button) {
    if (!dialogResolve) return;
    var r = dialogResolve;
    dialogResolve = null;
    document.body.classList.remove("dialog-open");
    r({ button: button, value: $("dlgInput").value });
  }
  function askText(title, value, placeholder, message) {
    return dialog({
      title: title, message: message, input: true, value: value, placeholder: placeholder,
      buttons: [{ label: "Cancelar", value: "cancel" }, { label: "Aceptar", value: "ok", primary: true }]
    }).then(function (r) { return r.button === "ok" ? r.value.trim() : null; });
  }
  function askConfirm(title, message, okLabel) {
    return dialog({
      title: title, message: message,
      buttons: [{ label: "Cancelar", value: "cancel" }, { label: okLabel || "Aceptar", value: "ok", primary: true }]
    }).then(function (r) { return r.button === "ok"; });
  }

  var lastMenuAt = 0;
  function showMenu(items, x, y) {
    lastMenuAt = Date.now();
    var menu = $("menu");
    menu.innerHTML = "";
    items.forEach(function (it) {
      var li = document.createElement("li");
      if (it.separator) { li.className = "sep"; menu.appendChild(li); return; }
      if (it.disabled) li.className = "disabled";
      var l = document.createElement("span"); l.textContent = it.label;
      li.appendChild(l);
      if (it.hint) { var h = document.createElement("span"); h.className = "hint"; h.textContent = it.hint; li.appendChild(h); }
      li.addEventListener("click", function () { closeMenu(); setTimeout(it.run, 0); });
      menu.appendChild(li);
    });
    document.body.classList.add("menu-open");
    var r = menu.getBoundingClientRect();
    var left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    var top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    menu.scrollTop = 0;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }
  function closeMenu() {
    document.body.classList.remove("menu-open");
    S.menuName = null;
    document.querySelectorAll("#menubar button.open").forEach(function (b) { b.classList.remove("open"); });
  }

  /* ================= Sidebar / vistas ================= */
  function sidebarVisible() {
    return isNarrow() ? document.body.classList.contains("sidebar-open") : !document.body.classList.contains("sidebar-hidden");
  }
  function showSidebar(v) {
    if (isNarrow()) {
      document.body.classList.toggle("sidebar-open", v);
      if (!v) {
        document.body.classList.remove("terminal-sheet");
        var sidebar = $("sidebar");
        if (sidebar) sidebar.style.transform = "";
      }
    } else document.body.classList.toggle("sidebar-hidden", !v);
    updateActivity();
  }
  function updateActivity() {
    var vis = sidebarVisible();
    document.querySelectorAll(".ab-item").forEach(function (b) {
      b.classList.toggle("active", vis && b.getAttribute("data-view") === S.view);
    });
  }
  function setView(name, focusInput) {
    if (name === "problems") refreshProblems();
    if (name === "output") renderOutput();
    if (name === "git") refreshGit();
    if (S.view === name && sidebarVisible() && !focusInput) { showSidebar(false); return; }
    S.view = name;
    document.body.classList.toggle("terminal-sheet", name === "terminal" && isNarrow());
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    showSidebar(true);
    if (name === "search") setTimeout(function () { $("searchInput").focus(); $("searchInput").select(); }, 50);
    if (name === "ai" && !isCoarse()) setTimeout(function () { Chat.focus(); }, 50);
    if (name === "settings") {
      refreshSettingsUI();
      if (focusInput) setTimeout(function () { $("setSearch").focus(); }, 50);
    }
  }
  function closeSidebarIfNarrow() { if (isNarrow()) showSidebar(false); }

  /* ----- Gestos de borde (solo pantallas estrechas) -----
   * Deslizar desde el borde izquierdo hacia la derecha abre la barra lateral;
   * desde el borde derecho hacia la izquierda la cierra. Solo reacciona si el
   * toque empieza a menos de 30px del borde y el movimiento es horizontal,
   * para no interferir con el scroll ni con la pulsación larga del árbol. */
  function bindEdgeSwipes() {
    var EDGE = 30, TRIGGER = 56;
    var side = null, tracking = false, startX = 0, startY = 0, dx = 0, dy = 0;
    function blocked() {
      return document.body.classList.contains("menu-open") ||
        document.body.classList.contains("palette-open") ||
        document.body.classList.contains("dialog-open");
    }
    document.addEventListener("touchstart", function (e) {
      if (!isNarrow() || !e.touches || e.touches.length !== 1 || blocked()) return;
      var t = e.touches[0];
      var w = window.innerWidth || 720;
      if (t.clientX <= EDGE) side = "left";
      else if (t.clientX >= w - EDGE) side = "right";
      else { side = null; return; }
      tracking = true; startX = t.clientX; startY = t.clientY; dx = 0; dy = 0;
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!tracking || !e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];
      dx = t.clientX - startX; dy = t.clientY - startY;
      // Movimiento predominantemente vertical: es scroll, no un swipe.
      if (Math.abs(dy) > Math.abs(dx)) { tracking = false; side = null; }
    }, { passive: true });
    document.addEventListener("touchend", function () {
      if (!tracking) { side = null; return; }
      tracking = false;
      var s = side; side = null;
      if (Math.abs(dx) < TRIGGER || Math.abs(dy) >= Math.abs(dx)) return;
      if (s === "left" && dx > 0 && !sidebarVisible()) { showSidebar(true); haptic(10); }
      else if (s === "right" && dx < 0 && sidebarVisible()) { showSidebar(false); haptic(10); }
    }, { passive: true });
    document.addEventListener("touchcancel", function () { tracking = false; side = null; }, { passive: true });
  }

  /* ================= Explorador ================= */
  function targetDir() {
    if (S.selectedType === "dir") return S.selected;
    return dirName(S.selected);
  }

  function loadDirs() {
    var roots = S.roots.length ? S.roots : [""];
    var paths = roots.concat(Object.keys(S.expanded));
    return Promise.all(paths.map(function (p) {
      var check = p === "" ? Promise.resolve(true) : API.exists(p);
      return check.then(function (ok) {
        if (!ok) { delete S.expanded[p]; delete S.dirCache[p]; return null; }
        return API.listDir(p).then(function (items) { S.dirCache[p] = items; });
      }).catch(function () { delete S.expanded[p]; delete S.dirCache[p]; return null; });
    }));
  }

  function refreshTree() {
    S.fileListCache = null;
    S.fileListPromise = null;
    S.fileListGen = (S.fileListGen || 0) + 1;
    return loadDirs().then(renderTree);
  }

  function rowEl(it, depth) {
    var row = document.createElement("div");
    var isDir = it.type === "dir";
    row.className = "row" + (S.selected === it.path ? " selected" : "");
    row.setAttribute("data-path", it.path);
    row.setAttribute("data-type", it.type);
    row.style.paddingLeft = (6 + depth * 12) + "px";
    var open = isDir && S.expanded[it.path];
    row.innerHTML =
      '<span class="chev ' + (isDir ? (open ? "open" : "") : "none") + '">' + Icons.svg("chevron-right", 16) + "</span>" +
      '<span class="ficon">' + (isDir ? Icons.folderIcon(open) : Icons.fileIcon(it.name)) + "</span>" +
      '<span class="label"></span>' +
      '<button class="more" title="Más acciones">' + Icons.svg("more", 16) + "</button>";
    row.querySelector(".label").textContent = it.name;
    if (!isDir && currentTab() && currentTab().path === it.path) row.classList.add("current");
    if (depth > 0) {
      var imgs = [], sizes = [], poss = [];
      for (var k = 0; k < depth; k++) {
        imgs.push("linear-gradient(#3b3b3b,#3b3b3b)"); sizes.push("1px 100%"); poss.push((6 + k * 12 + 8) + "px 0");
      }
      row.style.backgroundImage = imgs.join(",");
      row.style.backgroundSize = sizes.join(",");
      row.style.backgroundPosition = poss.join(",");
      row.style.backgroundRepeat = "no-repeat";
    }
    return row;
  }

  function rootRow(root, depth) {
    var row = document.createElement("div");
    row.className = "row root-row" + (S.selected === root ? " selected" : "");
    row.setAttribute("data-path", root);
    row.setAttribute("data-type", "dir");
    row.setAttribute("data-root", "1");
    row.style.paddingLeft = (6 + depth * 12) + "px";
    row.innerHTML =
      '<span class="chev ' + (S.expanded[root] ? "open" : "") + '">' + Icons.svg("chevron-right", 16) + "</span>" +
      '<span class="ficon">' + Icons.folderIcon(!!S.expanded[root]) + "</span>" +
      '<span class="label"></span>';
    row.querySelector(".label").textContent = rootName(root);
    return row;
  }

  function renderTree() {
    var tree = $("tree");
    var rows = [];
    var roots = S.roots.length ? S.roots : [""];
    roots.forEach(function (root) {
      rows.push(rootRow(root, 0));
      if (!S.expanded[root]) return;
      (function walk(path, depth) {
        (S.dirCache[path] || []).forEach(function (it) {
          rows.push(rowEl(it, depth));
          if (it.type === "dir" && S.expanded[it.path]) walk(it.path, depth + 1);
        });
      })(root, 1);
    });

    tree.innerHTML = "";
    var hasContent = rows.length > roots.length;
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(r); });
    if (!hasContent) {
      // Las raices del workspace se mantienen visibles aunque esten vacias.
      var note = document.createElement("div");
      note.className = "empty-note";
      note.innerHTML = 'Todavía no tienes archivos.' +
        '<button id="emptyNewFile">Nuevo archivo</button>' +
        '<button id="emptyNewDir" class="secondary">Nueva carpeta</button>';
      frag.appendChild(note);
    }
    tree.appendChild(frag);
    if (!hasContent) {
      $("emptyNewFile").onclick = function () { newItem("file"); };
      $("emptyNewDir").onclick = function () { newItem("dir"); };
    }
  }

  function selectPath(path, type) {
    S.selected = path;
    S.selectedType = type;
    document.querySelectorAll("#tree .row").forEach(function (r) {
      r.classList.toggle("selected", r.getAttribute("data-path") === path);
    });
  }

  function toggleDir(path) {
    if (S.expanded[path]) {
      delete S.expanded[path];
      renderTree();
      persistSession();
      return Promise.resolve();
    }
    S.expanded[path] = true;
    return API.listDir(path).then(function (items) {
      S.dirCache[path] = items;
      renderTree();
      persistSession();
    });
  }

  function expandParents(path) {
    var parts = path.split("/");
    var acc = "";
    for (var i = 0; i < parts.length - 1; i++) {
      acc = join(acc, parts[i]);
      S.expanded[acc] = true;
    }
    // Asegura que la raiz del workspace este expandida.
    var roots = S.roots.length ? S.roots : [""];
    for (var k = 0; k < roots.length; k++) {
      if (path === roots[k] || path.indexOf(roots[k] + "/") === 0 || roots[k] === "") S.expanded[roots[k]] = true;
    }
    return loadDirs();
  }

  function itemMenu(path, type, x, y) {
    selectPath(path, type);
    var items = [];
    if (type === "dir") {
      items.push({ label: "Nuevo archivo", run: function () { newItem("file"); } });
      items.push({ label: "Nueva carpeta", run: function () { newItem("dir"); } });
      items.push({ separator: true });
    } else {
      items.push({ label: "Abrir", run: function () { openFile(path); } });
      items.push({ separator: true });
    }
    items.push({ label: "Renombrar…", run: function () { renameItem(path, type); } });
    items.push({ label: "Eliminar", run: function () { deleteItem(path, type); } });
    showMenu(items, x, y);
  }

  function bindTree() {
    var tree = $("tree");
    var pressTimer = null, pressed = false, startX = 0, startY = 0;

    tree.addEventListener("click", function (e) {
      if (pressed) { pressed = false; return; }
      var row = e.target.closest(".row");
      if (!row) { selectPath("", "dir"); return; }
      var path = row.getAttribute("data-path"), type = row.getAttribute("data-type");
      if (e.target.closest(".more")) {
        var r = e.target.closest(".more").getBoundingClientRect();
        itemMenu(path, type, r.left - 140, r.bottom);
        return;
      }
      selectPath(path, type);
      if (type === "dir") toggleDir(path);
      else openFile(path);
    });

    tree.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (Date.now() - lastMenuAt < 700) return;
      var row = e.target.closest(".row");
      if (row) itemMenu(row.getAttribute("data-path"), row.getAttribute("data-type"), e.clientX, e.clientY);
      else showMenu([
        { label: "Nuevo archivo", run: function () { selectPath("", "dir"); newItem("file"); } },
        { label: "Nueva carpeta", run: function () { selectPath("", "dir"); newItem("dir"); } }
      ], e.clientX, e.clientY);
    });

    tree.addEventListener("touchstart", function (e) {
      var row = e.target.closest(".row");
      if (!row || e.touches.length !== 1) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      pressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        pressed = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (er) {} }
        itemMenu(row.getAttribute("data-path"), row.getAttribute("data-type"), startX + 8, startY + 8);
      }, 550);
    }, { passive: true });
    tree.addEventListener("touchmove", function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) clearTimeout(pressTimer);
    }, { passive: true });
    tree.addEventListener("touchend", function () { clearTimeout(pressTimer); }, { passive: true });
    tree.addEventListener("touchcancel", function () { clearTimeout(pressTimer); pressed = false; }, { passive: true });
  }

  /* ----- Crear / renombrar / borrar ----- */
  function validName(name) {
    if (!name) return false;
    if (name.charAt(0) === "/" || name.indexOf("\\") >= 0 || name.indexOf("\u0000") >= 0) return false;
    return name.split("/").every(function (s) { return s !== ".." && s !== "." && s.length > 0; });
  }

  function newItem(kind) {
    var dir = targetDir();
    var where = dir ? "en «" + dir + "»" : "en la raíz de proyectos";
    return askText(kind === "file" ? "Nuevo archivo" : "Nueva carpeta", "",
      kind === "file" ? "nombre.js" : "nombre", "Se creará " + where + ".").then(function (name) {
      if (name === null) return;
      name = name.replace(/\/+$/, "");
      if (!validName(name)) { toast("Nombre no válido", "error"); return; }
      var path = join(dir, name);
      return API.exists(path).then(function (ex) {
        if (ex) { toast("Ya existe: " + path, "error"); return; }
        var op = kind === "file" ? API.writeFile(path, "") : API.mkdir(path);
        return op.then(function (ok) {
          if (!ok) { toast("No se pudo crear " + path, "error"); return; }
          if (dir) S.expanded[dir] = true;
          return expandParents(path).then(function () {
            if (kind === "dir") S.expanded[path] = true;
            return loadDirs();
          }).then(function () {
            S.fileListCache = null;
            selectPath(path, kind === "file" ? "file" : "dir");
            renderTree();
            persistSession();
            if (kind === "file") return openFile(path);
          });
        });
      });
    });
  }

  function remapPath(p, oldP, newP) {
    if (p === oldP) return newP;
    if (p.indexOf(oldP + "/") === 0) return newP + p.slice(oldP.length);
    return p;
  }

  function saveTabsUnder(path) {
    var jobs = S.tabs.filter(function (t) { return t.path === path || t.path.indexOf(path + "/") === 0; })
      .map(function (t) { return saveTab(t); });
    return Promise.all(jobs);
  }

  function renameItem(path, type) {
    return askText("Renombrar", baseName(path), "", "").then(function (name) {
      if (name === null || name === baseName(path)) return;
      if (!validName(name) || name.indexOf("/") >= 0) { toast("Nombre no válido", "error"); return; }
      var np = join(dirName(path), name);
      return API.exists(np).then(function (ex) {
        if (ex) { toast("Ya existe: " + np, "error"); return; }
        return saveTabsUnder(path).then(function (results) {
          if (Array.isArray(results) && results.some(function (r) { return r === false; })) {
            toast("No se pudo guardar antes de renombrar", "error"); return false;
          }
          return API.renameItem(path, np);
        }).then(function (ok) {
          if (!ok) { toast("No se pudo renombrar", "error"); return; }
          UriEditor.renamePath(path, np, langOf);
          S.tabs.forEach(function (t) {
            var nt = remapPath(t.path, path, np);
            if (nt !== t.path) {
              t.path = nt; t.lang = langOf(nt);
              UriEditor.setLanguage(nt, t.lang);
              t.savedVersion = UriEditor.getVersion(nt);
              t.dirty = false;
            }
          });
          var ex2 = {};
          Object.keys(S.expanded).forEach(function (k) { ex2[remapPath(k, path, np)] = true; });
          S.expanded = ex2;
          var op2 = {};
          Object.keys(S.opening || {}).forEach(function (k) { op2[remapPath(k, path, np)] = S.opening[k]; });
          S.opening = op2;
          S.selected = remapPath(S.selected, path, np);
          S.dirCache = {};
          return refreshTree().then(function () {
            renderTabs(); updateChrome(); persistSession();
          });
        });
      });
    });
  }

  function captureDeletedItem(path, type) {
    var snapshot = { path: path, type: type === "dir" ? "dir" : "file", dirs: [], files: [] };
    function captureFile(filePath) {
      return API.readFile(filePath).then(function (content) {
        snapshot.files.push({ path: filePath, content: String(content == null ? "" : content) });
      });
    }
    function walk(dir) {
      return API.listDir(dir).then(function (items) {
        var chain = Promise.resolve();
        (items || []).forEach(function (item) {
          chain = chain.then(function () {
            if (item.type === "dir") {
              snapshot.dirs.push(item.path);
              return walk(item.path);
            }
            return captureFile(item.path);
          });
        });
        return chain;
      });
    }
    return API.exists(path).then(function (exists) {
      if (!exists) return null;
      if (snapshot.type === "dir") {
        snapshot.dirs.push(path);
        return walk(path).then(function () { return snapshot; });
      }
      return captureFile(path).then(function () { return snapshot; });
    });
  }

  function restoreDeletedItem(snapshot) {
    if (!snapshot) return Promise.resolve(false);
    return API.exists(snapshot.path).then(function (exists) {
      if (exists) { toast("Ya existe: " + snapshot.path, "error"); return false; }
      var dirs = snapshot.dirs.slice().sort(function (a, b) {
        return a.split("/").length - b.split("/").length;
      });
      var chain = Promise.resolve(true);
      dirs.forEach(function (dir) {
        chain = chain.then(function (ok) { return ok ? API.mkdir(dir) : false; });
      });
      snapshot.files.forEach(function (file) {
        chain = chain.then(function (ok) { return ok ? API.writeFile(file.path, file.content) : false; });
      });
      return chain.then(function (ok) {
        if (!ok) { toast("No se pudo restaurar " + snapshot.path, "error"); return false; }
        S.dirCache = {};
        return refreshTree().then(function () {
          persistSession();
          haptic(18);
          toast("Restaurado: " + baseName(snapshot.path));
          return true;
        });
      });
    });
  }

  function deleteItem(path, type) {
    var what = type === "dir" ? "la carpeta «" + baseName(path) + "» y todo su contenido" : "«" + baseName(path) + "»";
    return askConfirm("Eliminar", "¿Seguro que quieres eliminar " + what + "? Podrás deshacerlo desde el aviso.", "Eliminar").then(function (ok) {
      if (!ok) return false;
      return captureDeletedItem(path, type).then(function (snapshot) {
        if (!snapshot) { toast("No se pudo preparar la eliminación", "error"); return false; }
        return API.deleteItem(path).then(function (done) {
          if (!done) { toast("No se pudo eliminar", "error"); return false; }
          var doomed = S.tabs.filter(function (t) { return t.path === path || t.path.indexOf(path + "/") === 0; });
          var closeChain = Promise.resolve();
          doomed.forEach(function (t) { closeChain = closeChain.then(function () { return closeTabByPath(t.path); }); });
          return closeChain.then(function () {
            Object.keys(S.expanded).forEach(function (k) { if (k === path || k.indexOf(path + "/") === 0) delete S.expanded[k]; });
            if (S.selected === path || S.selected.indexOf(path + "/") === 0) selectPath("", "dir");
            setRecent(getRecent().filter(function (recentPath) {
              return recentPath !== path && recentPath.indexOf(path + "/") !== 0;
            }));
            S.dirCache = {};
            return refreshTree().then(function () {
              persistSession();
              haptic([14, 35, 14]);
              toast("Eliminado: " + baseName(path), "", {
                duration: 8000,
                action: { label: "Deshacer", run: function () { return restoreDeletedItem(snapshot); } }
              });
              return true;
            });
          });
        });
      });
    });
  }

  function collapseAll() { S.expanded = {}; renderTree(); persistSession(); }

  /* ================= Pestañas ================= */
  function currentTab() { return S.active >= 0 ? S.tabs[S.active] : null; }

  function isDirty(t) { return UriEditor.getVersion(t.path) !== t.savedVersion; }

  function renderTabs() {
    S.tabs.forEach(function (t) { try { t.dirty = isDirty(t); } catch (e) {} });
    var bar = $("tabs");
    bar.innerHTML = "";
    var counts = {};
    S.tabs.forEach(function (t) { var n = baseName(t.path); counts[n] = (counts[n] || 0) + 1; });
    S.tabs.forEach(function (t, i) {
      var d = document.createElement("div");
      d.className = "tab" + (i === S.active ? " active" : "") + (t.dirty ? " dirty" : "");
      d.title = t.path;
      var name = baseName(t.path);
      d.innerHTML = '<span class="ficon">' + Icons.fileIcon(name) + '</span><span class="tname"></span>' +
        (counts[name] > 1 && dirName(t.path) ? '<span class="tdir"></span>' : "") +
        '<button class="tclose" title="Cerrar"><span class="tx">' + Icons.svg("close", 14) + '</span><span class="tdot"></span></button>';
      d.querySelector(".tname").textContent = name;
      var td = d.querySelector(".tdir");
      if (td) td.textContent = dirName(t.path);
      d.addEventListener("click", function (e) {
        if (d.__lp && Date.now() - d.__lp < 900) return;
        if (e.target.closest(".tclose")) { closeTab(S.tabs.indexOf(t)); return; }
        activate(S.tabs.indexOf(t));
      });
      d.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        if (Date.now() - lastMenuAt < 700) return;
        tabMenu(t, e.clientX, e.clientY);
      });
      attachLongPress(d, function (x, y) { d.__lp = Date.now(); tabMenu(t, x, y); });
      bar.appendChild(d);
      if (i === S.active) setTimeout(function () { d.scrollIntoView({ block: "nearest", inline: "nearest" }); }, 0);
    });
    renderOpenEditors();
    document.body.classList.toggle("has-tabs", S.tabs.length > 0);
    var dirtyCount = S.tabs.filter(function (t) { return t.dirty; }).length;
    var badge = $("abBadge");
    badge.textContent = dirtyCount;
    badge.classList.toggle("show", dirtyCount > 0);
    if (!S.tabs.length) renderWelcomeRecent();
  }

  function renderOpenEditors() {
    var box = $("openEditors");
    box.innerHTML = "";
    if (!S.tabs.length) {
      box.innerHTML = '<div class="empty-note" style="padding:6px 16px">Ningún archivo abierto.</div>';
      return;
    }
    S.tabs.forEach(function (t, i) {
      var row = document.createElement("div");
      row.className = "row" + (i === S.active ? " selected" : "");
      row.style.paddingLeft = "22px";
      row.innerHTML = '<span class="ficon">' + Icons.fileIcon(baseName(t.path)) + '</span><span class="label"></span>' +
        (t.dirty ? '<span class="dot"></span>' : '<button class="xbtn" title="Cerrar">' + Icons.svg("close", 14) + "</button>");
      row.querySelector(".label").textContent = baseName(t.path);
      row.addEventListener("click", function (e) {
        if (e.target.closest(".xbtn")) { closeTab(S.tabs.indexOf(t)); return; }
        activate(S.tabs.indexOf(t));
      });
      box.appendChild(row);
    });
  }

  function renderBreadcrumbs() {
    var bc = $("breadcrumbs");
    var t = currentTab();
    if (!t) { bc.innerHTML = ""; return; }
    var parts = t.path.split("/");
    var html = "";
    parts.forEach(function (p, i) {
      if (i > 0) html += '<span class="bc-sep">' + Icons.svg("chevron-right", 12) + "</span>";
      if (i === parts.length - 1) html += '<span class="bc-last"><span class="ficon">' + Icons.fileIcon(p) + "</span>" + esc(p) + "</span>";
      else html += "<span>" + esc(p) + "</span>";
    });
    bc.innerHTML = html;
  }

  function updateChrome() {
    var t = currentTab();
    $("titleText").textContent = t ? (t.dirty ? "● " : "") + baseName(t.path) + " — Uri Code" : "Uri Code";
    $("sbLang").textContent = t ? (LANG_NAMES[t.lang] || t.lang) : "";
    renderBreadcrumbs();
    document.querySelectorAll("#tree .row").forEach(function (r) {
      r.classList.toggle("current", !!t && r.getAttribute("data-path") === t.path && r.getAttribute("data-type") === "file");
    });
  }

  function activate(i, pos) {
    if (i < 0 || i >= S.tabs.length) return;
    S.active = i;
    var t = S.tabs[i];
    UriEditor.show(t.path, !pos);
    if (pos && pos.line) UriEditor.gotoLine(pos.line, pos.col, pos.len);
    renderTabs();
    updateChrome();
    refreshProblems();
    closeSidebarIfNarrow();
    persistSession();
  }

  function loadTab(path) {
    var existing = S.tabs.findIndex(function (t) { return t.path === path; });
    if (existing >= 0) return Promise.resolve(S.tabs[existing]);
    if (S.opening[path]) return S.opening[path];
    var p = UriEditor.ready().then(function () { return API.exists(path); }).then(function (ex) {
      if (!ex) { toast("El archivo no existe: " + path, "error"); removeRecent(path); return null; }
      return API.readFile(path);
    }).then(function (content) {
      if (content === null) return null;
      if (content.indexOf("\u0000") >= 0) { toast("Archivo binario: no se puede abrir", "error"); return null; }
      var lang = langOf(path);
      var ver = UriEditor.ensure(path, content, lang);
      var tab = { path: path, lang: lang, savedVersion: ver, dirty: false };
      S.tabs.push(tab);
      return tab;
    }).then(function (tab) { delete S.opening[path]; return tab; },
      function (e) { delete S.opening[path]; throw e; });
    S.opening[path] = p;
    return p;
  }

  function openFile(path, pos) {
    return loadTab(path).then(function (tab) {
      if (!tab) return;
      pushRecent(path);
      var idx = S.tabs.indexOf(tab);
      if (idx >= 0) activate(idx, pos);
    });
  }

  function saveTab(t) {
    if (!t) return Promise.resolve(true);
    var format = S.settings.formatOnSave && typeof UriEditor.formatDocument === "function"
      ? Promise.resolve().then(function () { return UriEditor.formatDocument(t.path); }).catch(function (e) {
        log("Format failed for " + t.path + ": " + String(e && e.message || e), "error");
        return false;
      })
      : Promise.resolve(false);
    var ver;
    return format.then(function () {
      ver = UriEditor.getVersion(t.path);
      var text = UriEditor.getValue(t.path);
      return API.writeFile(t.path, text);
    }).then(function (ok) {
      if (!ok) { toast("Error al guardar " + t.path, "error"); return false; }
      t.savedVersion = ver;
      var nd = isDirty(t);
      if (nd !== t.dirty) { t.dirty = nd; renderTabs(); updateChrome(); }
      return true;
    });
  }

  function saveAll(quiet) {
    var dirty = S.tabs.filter(function (t) { return t.dirty || isDirty(t); });
    return Promise.all(dirty.map(saveTab)).then(function (r) {
      if (!quiet && dirty.length) toast("Guardado");
      return r.every(Boolean);
    });
  }

  function saveCurrent() {
    var t = currentTab();
    if (!t) return Promise.resolve();
    clearTimeout(S.autoTimer); S.autoTimer = null;
    return saveTab(t).then(function (ok) { if (ok) toast("Guardado: " + baseName(t.path)); });
  }

  function onEditorChange(path) {
    var t = S.tabs.find(function (x) { return x.path === path; });
    if (!t) return;
    var nd = isDirty(t);
    if (nd !== t.dirty) { t.dirty = nd; renderTabs(); updateChrome(); }
    if (S.settings.autoSave && nd) {
      clearTimeout(S.autoTimer);
      S.autoTimer = setTimeout(function () { saveAll(true); }, 1200);
    } else {
      clearTimeout(S.autoTimer);
      S.autoTimer = null;
    }
  }

  function closeTabByPath(path) {
    var i = S.tabs.findIndex(function (t) { return t.path === path; });
    if (i >= 0) closeTab(i, true);
  }

  function closeTab(i, force) {
    var t = S.tabs[i];
    if (!t) return Promise.resolve(true);
    var pre = Promise.resolve("discard");
    if (!force && (t.dirty || isDirty(t))) {
      pre = dialog({
        title: "Uri Code",
        message: "¿Quieres guardar los cambios de «" + baseName(t.path) + "»?",
        buttons: [
          { label: "No guardar", value: "discard" },
          { label: "Cancelar", value: "cancel" },
          { label: "Guardar", value: "save", primary: true }
        ]
      }).then(function (r) { return r.button; });
    }
    return pre.then(function (choice) {
      if (choice === "cancel") return false;
      var step = choice === "save" ? saveTab(t) : Promise.resolve(true);
      return step.then(function (ok) {
        if (!ok) return false;
        var idx = S.tabs.indexOf(t);
        if (idx < 0) return true;
        UriEditor.closeModel(t.path);
        S.tabs.splice(idx, 1);
        if (!S.tabs.length) {
          S.active = -1;
          renderTabs(); updateChrome();
        } else if (idx < S.active) {
          S.active--;
          renderTabs(); updateChrome();
        } else if (idx === S.active) {
          S.active = Math.min(idx, S.tabs.length - 1);
          UriEditor.show(S.tabs[S.active].path, false);
          renderTabs(); updateChrome();
        } else {
          renderTabs(); updateChrome();
        }
        refreshProblems();
        persistSession();
        return true;
      });
    });
  }

  function closeAllTabs() {
    var chain = Promise.resolve(true);
    S.tabs.slice().forEach(function (t) {
      chain = chain.then(function (cont) {
        if (!cont) return false;
        return closeTab(S.tabs.indexOf(t));
      });
    });
    return chain;
  }

  /* ================= Sesión ================= */
  function persistSession() {
    try {
      localStorage.setItem("uri.session", JSON.stringify({
        tabs: S.tabs.map(function (t) { return t.path; }),
        active: currentTab() ? currentTab().path : null,
        expanded: Object.keys(S.expanded)
      }));
    } catch (e) {}
  }

  function restoreSession() {
    var ses = null;
    try { ses = JSON.parse(localStorage.getItem("uri.session")); } catch (e) {}
    if (!ses) return Promise.resolve();
    var chain = Promise.resolve();
    (ses.tabs || []).forEach(function (p) {
      chain = chain.then(function () { return loadTab(p); }).catch(function () {});
    });
    return chain.then(function () {
      var i = S.tabs.findIndex(function (t) { return t.path === ses.active; });
      if (i < 0 && S.tabs.length) i = S.tabs.length - 1;
      if (i >= 0) {
        S.active = i;
        UriEditor.show(S.tabs[i].path, false);
      }
      renderTabs(); updateChrome();
      refreshProblems();
    });
  }

  /* ================= Barra de estado ================= */
  function onCursor(c) {
    $("sbPos").textContent = "Ln " + c.line + ", Col " + c.col + (c.selected ? " (" + c.selected + " seleccionados)" : "");
    $("sbSpaces").textContent = "Espacios: " + c.tabSize;
    $("sbEol").textContent = c.eol;
  }
  function onMarkers(m) {
    m = m || {};
    $("sbErrCount").textContent = String(m.errors || 0);
    $("sbWarnCount").textContent = String(m.warnings || 0);
    refreshProblems();
  }

  /* ================= Lista de archivos (Ir a archivo / búsqueda) ================= */
  var SKIP_DIRS = { "node_modules": 1, ".git": 1 };

  function allFiles() {
    if (S.fileListCache) return Promise.resolve(S.fileListCache);
    if (S.fileListPromise) return S.fileListPromise;
    var out = [], seen = {}, gen = (S.fileListGen = (S.fileListGen || 0) + 1), myGen = gen;
    function walk(path, skipRoot) {
      return API.listDir(path).then(function (items) {
        items = items || [];
        var chain = Promise.resolve();
        items.forEach(function (it) {
          if (it.type === "file") { if (!seen[it.path]) { seen[it.path] = 1; out.push(it); } }
          else if (!SKIP_DIRS[it.name] && out.length < 8000) {
            if (skipRoot && skipRoot[it.path]) return; // ya cubierta por otra raiz
            chain = chain.then(function () { return walk(it.path, skipRoot); });
          }
        });
        return chain;
      }).catch(function () { return null; });
    }
    var roots = S.roots.length ? S.roots : [""];
    // Si una raiz esta dentro de otra, se salta para no duplicar archivos.
    var skipRoot = {};
    roots.forEach(function (r) {
      roots.forEach(function (o) {
        if (r !== o && o && r.indexOf(o + "/") === 0) skipRoot[r] = 1;
      });
    });
    S.fileListPromise = roots.reduce(function (chain, r) {
      return chain.then(function () { return walk(r, skipRoot); });
    }, Promise.resolve()).then(function () {
      if (myGen !== S.fileListGen) return S.fileListCache || [];
      S.fileListCache = out;
      S.fileListPromise = null;
      return out;
    });
    return S.fileListPromise;
  }

  /* ================= Paleta / Ir a archivo ================= */
  var Pal = { open: false, mode: "files", items: [], sel: 0, token: 0 };

  function fuzzyScore(q, s) {
    q = q.toLowerCase(); s = s.toLowerCase();
    var qi = 0, score = 0, last = -2;
    for (var i = 0; i < s.length && qi < q.length; i++) {
      if (s.charAt(i) === q.charAt(qi)) {
        score += (last === i - 1) ? 5 : 1;
        if (i === 0 || "/._- ".indexOf(s.charAt(i - 1)) >= 0) score += 3;
        last = i; qi++;
      }
    }
    return qi === q.length ? score : -1;
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    var lower = text.toLowerCase(), ql = q.toLowerCase(), out = "", qi = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = esc(text.charAt(i));
      if (qi < ql.length && lower.charAt(i) === ql.charAt(qi)) { out += "<mark>" + ch + "</mark>"; qi++; } else out += ch;
    }
    return qi === ql.length ? out : esc(text);
  }

  function openPalette(prefix) {
    closeMenu();
    Pal.open = true;
    document.body.classList.add("palette-open");
    var input = $("paletteInput");
    input.value = prefix || "";
    input.focus();
    refreshPalette();
    setTimeout(function () { input.focus(); }, 30);
  }
  function closePalette() {
    Pal.open = false;
    document.body.classList.remove("palette-open");
  }

  function refreshPalette() {
    var raw = $("paletteInput").value;
    var token = ++Pal.token;
    if (raw.charAt(0) === ">") {
      Pal.mode = "commands";
      var q = raw.slice(1).trim();
      var all = COMMANDS.concat(extensionCommands());
      var list = all.map(function (c) { return { cmd: c, score: q ? fuzzyScore(q, c.label) : 0 }; })
        .filter(function (x) { return x.score >= 0; });
      if (q) list.sort(function (a, b) { return b.score - a.score; });
      Pal.items = list.slice(0, 60).map(function (x) {
        return { html: highlight(x.cmd.label, q), key: x.cmd.key || "", run: x.cmd.run };
      });
      renderPalette();
    } else if (raw.charAt(0) === ":") {
      Pal.mode = "goto";
      var n = parseInt(raw.slice(1), 10);
      Pal.items = [{ html: isNaN(n) ? "Escribe un número de línea" : "Ir a la línea " + n, run: function () {
        if (!isNaN(n) && currentTab()) UriEditor.gotoLine(n, 1);
      }, noop: isNaN(n) }];
      renderPalette();
    } else {
      Pal.mode = "files";
      allFiles().then(function (files) {
        if (!Pal.open || token !== Pal.token) return;
        var q2 = raw.trim();
        var scored = [];
        files.forEach(function (f) {
          var sc;
          if (!q2) sc = 0;
          else {
            var a = fuzzyScore(q2, f.name), b = fuzzyScore(q2, f.path);
            sc = Math.max(a >= 0 ? a + 10 : -1, b);
          }
          if (sc >= 0) scored.push({ f: f, sc: sc });
        });
        scored.sort(function (x, y) { return y.sc - x.sc || x.f.path.length - y.f.path.length; });
        Pal.items = scored.slice(0, 60).map(function (x) {
          return { icon: Icons.fileIcon(x.f.name), html: highlight(x.f.name, q2), dim: dirName(x.f.path),
            run: function () { openFile(x.f.path); } };
        });
        renderPalette();
      });
    }
  }

  function renderPalette() {
    Pal.sel = 0;
    var ul = $("paletteList");
    ul.innerHTML = "";
    if (!Pal.items.length) {
      ul.innerHTML = '<li class="none">' + (Pal.mode === "files" ? "No hay archivos que coincidan" : "Sin resultados") + "</li>";
      return;
    }
    Pal.items.forEach(function (it, i) {
      var li = document.createElement("li");
      if (i === 0) li.className = "sel";
      li.innerHTML = (it.icon ? '<span class="ficon">' + it.icon + "</span>" : "") +
        '<span class="pl-main">' + it.html + "</span>" +
        (it.dim ? '<span class="pl-dim">' + esc(it.dim) + "</span>" : "") +
        (it.key ? '<span class="pl-key">' + esc(it.key) + "</span>" : "");
      li.addEventListener("click", function () { runPalette(i); });
      ul.appendChild(li);
    });
  }

  function movePalette(d) {
    if (!Pal.items.length) return;
    var lis = $("paletteList").children;
    lis[Pal.sel].classList.remove("sel");
    Pal.sel = (Pal.sel + d + Pal.items.length) % Pal.items.length;
    lis[Pal.sel].classList.add("sel");
    lis[Pal.sel].scrollIntoView({ block: "nearest" });
  }

  function runPalette(i) {
    var it = Pal.items[i == null ? Pal.sel : i];
    if (!it || it.noop) return;
    closePalette();
    setTimeout(it.run, 0);
  }

  /* ================= Comandos ================= */
  function needTab() { if (!currentTab()) { toast("Abre un archivo primero"); return false; } return true; }
  function editorAction(id) { return function () { if (needTab()) UriEditor.action(id); }; }
  function changeFont(d) {
    S.settings.fontSize = Math.max(8, Math.min(32, S.settings.fontSize + d));
    saveSettings(); applySettings();
  }

  function addRootCommand() {
    askText("Agregar carpeta al workspace", "", "carpeta dentro del workspace (ej. frontend)",
      "Actual: " + (S.roots.length ? S.roots.map(rootName).join(", ") : "(ninguna)")).then(function (path) {
      if (!path) return;
      path = path.trim();
      API.exists(path).then(function (ok) {
        if (!ok) { toast("La carpeta no existe: " + path, "error"); return; }
        if (!addRoot(path)) { toast("Esa carpeta ya está en el workspace", "error"); return; }
        refreshTree().then(function () { toast("Carpeta agregada: " + rootName(path)); });
      });
    });
  }

  function removeRootCommand() {
    if (S.roots.length <= 1) { toast("El workspace necesita al menos una carpeta", "error"); return; }
    var path = S.selected;
    if (S.roots.indexOf(path) < 0) {
      toast("Selecciona una carpeta raíz del workspace", "error"); return;
    }
    removeRoot(path);
    refreshTree().then(function () { toast("Carpeta quitada: " + rootName(path)); });
  }

  var COMMANDS = [
    { label: "Archivo: Nuevo archivo", key: "Ctrl+N", run: function () { newItem("file"); } },
    { label: "Archivo: Nueva carpeta", run: function () { newItem("dir"); } },
    { label: "Archivo: Importar archivos…", run: importFiles },
    { label: "Archivo: Agregar carpeta al workspace", run: addRootCommand },
    { label: "Depuración: Alternar punto de interrupción", run: toggleBreakpoint },
    { label: "LSP: Estado de los adaptadores", run: lspStatus },
    { label: "Archivo: Quitar carpeta del workspace", run: removeRootCommand },
    { label: "Archivo: Compartir archivo actual", run: shareCurrent },
    { label: "Editor: Insertar snippet", run: insertSnippet },
    { label: "Archivo: Guardar", key: "Ctrl+S", run: saveCurrent },
    { label: "Archivo: Guardar todo", run: function () { saveAll(false); } },
    { label: "Archivo: Cerrar editor", key: "Ctrl+W", run: function () { if (S.active >= 0) closeTab(S.active); } },
    { label: "Archivo: Cerrar todos los editores", run: closeAllTabs },
    { label: "Ir a archivo…", key: "Ctrl+P", run: function () { openPalette(""); } },
    { label: "Ver: Alternar barra lateral", key: "Ctrl+B", run: function () { showSidebar(!sidebarVisible()); } },
    { label: "Ver: Mostrar Explorador", key: "Ctrl+Shift+E", run: function () { setView("explorer", true); } },
    { label: "Ver: Mostrar Búsqueda", key: "Ctrl+Shift+F", run: function () { setView("search", true); } },
    { label: "Ver: Mostrar Chat IA", run: function () { setView("ai", true); } },
    { label: "Ver: Abrir Ajustes", key: "Ctrl+,", run: function () { setView("settings", true); } },
    { label: "Ver: Alternar ajuste de línea", run: function () { S.settings.wordWrap = !S.settings.wordWrap; saveSettings(); applySettings(); } },
    { label: "Ver: Alternar minimapa", run: function () { S.settings.minimap = !S.settings.minimap; saveSettings(); applySettings(); } },
    { label: "Ver: Aumentar tamaño de fuente", run: function () { changeFont(1); } },
    { label: "Ver: Reducir tamaño de fuente", run: function () { changeFont(-1); } },
    { label: "Editor: Buscar", key: "Ctrl+F", run: editorAction("actions.find") },
    { label: "Editor: Reemplazar", key: "Ctrl+H", run: editorAction("editor.action.startFindReplace") },
    { label: "Editor: Ir a línea…", key: "Ctrl+G", run: function () { openPalette(":"); } },
    { label: "Editor: Añadir cursor arriba", key: "Ctrl+Alt+Up", run: editorAction("editor.action.insertCursorAbove") },
    { label: "Editor: Añadir cursor abajo", key: "Ctrl+Alt+Down", run: editorAction("editor.action.insertCursorBelow") },
    { label: "Editor: Seleccionar siguiente aparición", key: "Ctrl+D", run: editorAction("editor.action.addSelectionToNextFindMatch") },
    { label: "Editor: Seleccionar todas las apariciones", key: "Ctrl+Shift+L", run: editorAction("editor.action.selectAllOccurrences") },
    { label: "Ir a llave correspondiente", key: "Ctrl+]", run: editorAction("editor.action.bracketMatch") },
    { label: "Editor: Formatear documento", run: editorAction("editor.action.formatDocument") },
    { label: "Editor: Ir a símbolo en archivo", run: editorAction("editor.action.quickOutline") },
    { label: "Editor: Alternar comentario de línea", key: "Ctrl+/", run: editorAction("editor.action.commentLine") },
    { label: "Editor: Deshacer", key: "Ctrl+Z", run: function () { UriEditor.undo(); } },
    { label: "Editor: Rehacer", key: "Ctrl+Y", run: function () { UriEditor.redo(); } },
    { label: "Ir: Editor siguiente", key: "Ctrl+PgDn", run: function () { cycleTab(1); } },
    { label: "Ir: Editor anterior", key: "Ctrl+PgUp", run: function () { cycleTab(-1); } },
    { label: "Ayuda: Atajos de teclado", run: showShortcuts },
    { label: "Explorador: Actualizar", run: function () { refreshTree(); } },
    { label: "Explorador: Contraer carpetas", run: collapseAll }
  ];


  /* ================= Utilidades nuevas ================= */
  function copyToClipboard(text) {
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      toast(ok ? "Copiado" : "No se pudo copiar", ok ? "" : "error");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copiado"); }, legacy);
    } else { legacy(); }
  }

  function attachLongPress(el, fn) {
    var timer = null, sx = 0, sy = 0;
    el.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (er) {} }
        fn(sx + 8, sy + 8);
      }, 550);
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) clearTimeout(timer);
    }, { passive: true });
    el.addEventListener("touchend", function () { clearTimeout(timer); }, { passive: true });
    el.addEventListener("touchcancel", function () { clearTimeout(timer); }, { passive: true });
  }

  /* ----- Recientes ----- */
  var RECENTS_KEY = "uri.recents";
  var RECENTS_LEGACY_KEY = "uri.recent";
  var RECENTS_MAX = 8;
  function getRecent() {
    try {
      var r = JSON.parse(localStorage.getItem(RECENTS_KEY));
      if (Array.isArray(r)) return r;
    } catch (e) {}
    try {
      var legacy = JSON.parse(localStorage.getItem(RECENTS_LEGACY_KEY));
      return Array.isArray(legacy) ? legacy : [];
    } catch (e) { return []; }
  }
  function setRecent(r) { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(r.slice(0, RECENTS_MAX))); } catch (e) {} }
  function pushRecent(path) {
    var r = getRecent().filter(function (p) { return p !== path; });
    r.unshift(path); setRecent(r);
  }
  function removeRecent(path) { setRecent(getRecent().filter(function (p) { return p !== path; })); }
  function renderWelcomeRecent() {
    var box = $("welcomeRecent");
    if (!box) return;
    var list = getRecent();
    box.innerHTML = "";
    var title = document.createElement("div");
    title.className = "wr-title"; title.textContent = "Recientes";
    box.appendChild(title);
    if (!list.length) {
      var note = document.createElement("div");
      note.className = "welcome-empty";
      note.textContent = "Sin archivos recientes";
      box.appendChild(note);
      return;
    }
    list.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "wr-item";
      b.innerHTML = '<span class="ficon">' + Icons.fileIcon(baseName(p)) + '</span><span class="wr-name"></span><span class="wr-dir"></span>';
      b.querySelector(".wr-name").textContent = baseName(p);
      b.querySelector(".wr-dir").textContent = dirName(p);
      b.addEventListener("click", function () { openFile(p); });
      box.appendChild(b);
    });
  }

  /* ----- Bienvenida: tarjetas de acciones rápidas ----- */
  function buildWelcomeActions() {
    var box = $("welcomeActions");
    if (!box) return;
    var actions = [
      { icon: "new-file", label: "Nuevo archivo", desc: "Crea un archivo en el proyecto", run: function () { newItem("file"); } },
      { icon: "search", label: "Abrir archivo", desc: "Busca y abre por nombre", run: function () { openPalette(""); } },
      { icon: "chevron-right", label: "Paleta de comandos", desc: "Todos los comandos del editor", run: function () { openPalette(">"); } },
      { icon: "sparkle", label: "Chat IA", desc: "Pregunta y genera código", run: function () { setView("ai", true); } },
      { icon: "terminal", label: "Terminal", desc: "Ejecuta comandos del sistema", run: function () { setView("terminal", true); } },
      { icon: "git", label: "Control de versiones", desc: "Estado, commits y ramas", run: function () { setView("git", true); } }
    ];
    box.innerHTML = "";
    actions.forEach(function (a) {
      var b = document.createElement("button");
      b.className = "welcome-card";
      b.innerHTML = '<span class="wc-icon">' + Icons.svg(a.icon, 22) + '</span>' +
        '<span class="wc-text"><span class="wc-label"></span><span class="wc-desc"></span></span>';
      b.querySelector(".wc-label").textContent = a.label;
      b.querySelector(".wc-desc").textContent = a.desc;
      b.addEventListener("click", a.run);
      box.appendChild(b);
    });
  }

  /* ----- Pestañas: menú ----- */
  function closeOthers(keep) {
    var chain = Promise.resolve(true);
    S.tabs.slice().forEach(function (o) {
      if (o === keep) return;
      chain = chain.then(function (c) { return c ? closeTab(S.tabs.indexOf(o)) : false; });
    });
    return chain;
  }
  function revealInExplorer(path) {
    return expandParents(path).then(function () {
      selectPath(path, "file");
      renderTree();
      setView("explorer", true);
      var row = document.querySelector('#tree .row[data-path="' + path.replace(/"/g, '\\"') + '"]');
      if (row) row.scrollIntoView({ block: "center" });
    });
  }
  function tabMenu(t, x, y) {
    showMenu([
      { label: "Cerrar", hint: "Ctrl+W", run: function () { closeTab(S.tabs.indexOf(t)); } },
      { label: "Cerrar otros", disabled: S.tabs.length < 2, run: function () { closeOthers(t); } },
      { label: "Cerrar todos", run: closeAllTabs },
      { separator: true },
      { label: "Copiar ruta", run: function () { copyToClipboard(t.path); } },
      { label: "Mostrar en el explorador", run: function () { revealInExplorer(t.path); } }
    ], x, y);
  }
  function cycleTab(d) {
    if (S.tabs.length < 2) return;
    var base = S.active >= 0 ? S.active : 0;
    activate((base + d + S.tabs.length) % S.tabs.length);
  }

  /* ----- Importar y compartir ----- */
  function uniquePath(path) {
    var d = dirName(path), n = baseName(path), dot = n.lastIndexOf(".");
    var stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : "", i = 0;
    function next() {
      var p = i ? join(d, stem + " (" + i + ")" + ext) : path;
      return API.exists(p).then(function (ex) { if (!ex) return p; i++; return next(); });
    }
    return next();
  }

  function importFiles() {
    var inp = $("importInput");
    inp.value = "";
    inp.click();
  }

  function doImport(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve();
    var dir = targetDir(), done = 0, skipped = 0, first = null;
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        if (f.size > 3000000) { skipped++; return null; }
        return f.text().then(function (text) {
          if (text.indexOf("\u0000") >= 0 || text.indexOf("\uFFFD") >= 0) { skipped++; return null; }
          return uniquePath(join(dir, f.name)).then(function (path) {
            return API.writeFile(path, text).then(function (ok) {
              if (ok) { done++; if (!first) first = path; } else skipped++;
            });
          });
        });
      }).catch(function () { skipped++; });
    });
    return chain.then(function () {
      if (dir) S.expanded[dir] = true;
      return refreshTree();
    }).then(function () {
      var msg = done + " archivo" + (done === 1 ? "" : "s") + " importado" + (done === 1 ? "" : "s");
      if (skipped) msg += " · " + skipped + " omitido" + (skipped === 1 ? "" : "s") + " (binarios o muy grandes)";
      toast(msg, done ? "" : "error");
      if (first) return openFile(first);
    });
  }

  function shareCurrent() {
    var t = currentTab();
    if (!t) { toast("Abre un archivo primero"); return; }
    var text = UriEditor.getValue(t.path);
    if (text.length > 200000) { toast("El archivo es demasiado grande para compartirlo", "error"); return; }
    API.shareText(baseName(t.path), text);
  }

  function insertSnippet() {
    if (!currentTab()) { toast("Abre un archivo primero"); return; }
    var snips = getSnippets();
    var keys = Object.keys(snips);
    if (!keys.length) { toast("No hay snippets configurados (Ajustes)", "error"); return; }
    askText("Insertar snippet", "", "nombre del snippet", "Disponibles: " + keys.join(", ")).then(function (name) {
      if (!name) return;
      var code = snips[name];
      if (code == null) { toast("Snippet no encontrado", "error"); return; }
      expandSnippet(String(code));
      toast("Snippet insertado");
    });
  }

  var snippetSession = null;
  function expandSnippet(code) {
    var ed = (window.monaco && monaco.editor && monaco.editor.getEditors) ? monaco.editor.getEditors()[0] : null;
    if (!ed) { UriEditor.insertAtCursor(code); return; }
    var model = ed.getModel();
    var sel = ed.getSelection();
    var pos = sel.getPosition();
    // Parse placeholders
    var re = /\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g;
    var text = "";
    var stops = []; // {num, start, end} offsets in text
    var last = 0, m;
    while ((m = re.exec(code)) !== null) {
      text += code.slice(last, m.index);
      var num = parseInt(m[1] != null ? m[1] : m[3], 10);
      var def = (m[2] != null) ? m[2] : "";
      var start = text.length;
      text += def;
      stops.push({ num: num, start: start, end: text.length });
      last = m.index + m[0].length;
    }
    text += code.slice(last);
    // Insert
    var startOffset = model.getOffsetAt(pos);
    ed.executeEdits("snippet", [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: text, forceMoveMarkers: true }]);
    // Map stops to absolute offsets
    var absStops = stops.map(function (st) { return { num: st.num, start: startOffset + st.start, end: startOffset + st.end }; });
    // sort by num, with 0 last
    absStops.sort(function (a, b) { var an = a.num === 0 ? 9999 : a.num; var bn = b.num === 0 ? 9999 : b.num; return an - bn; });
    snippetSession = { stops: absStops, idx: 0 };
    // select first
    if (absStops.length) {
      var s0 = absStops[0];
      var p1 = model.getPositionAt(s0.start);
      var p2 = model.getPositionAt(s0.end);
      ed.setSelection(new monaco.Range(p1.lineNumber, p1.column, p2.lineNumber, p2.column));
    }
  }

  function snippetNextTab() {
    if (!snippetSession) return false;
    var ed = (window.monaco && monaco.editor && monaco.editor.getEditors) ? monaco.editor.getEditors()[0] : null;
    if (!ed) { snippetSession = null; return false; }
    var model = ed.getModel();
    snippetSession.idx++;
    if (snippetSession.idx >= snippetSession.stops.length) {
      // end session: place cursor at $0 if exists else end
      var last = snippetSession.stops[snippetSession.stops.length - 1];
      var p = model.getPositionAt(last ? last.end : 0);
      ed.setPosition(p);
      snippetSession = null;
      return true;
    }
    var st = snippetSession.stops[snippetSession.idx];
    var p1 = model.getPositionAt(st.start);
    var p2 = model.getPositionAt(st.end);
    ed.setSelection(new monaco.Range(p1.lineNumber, p1.column, p2.lineNumber, p2.column));
    return true;
  }

  function parseVer(v) { return String(v || "").replace(/^v/i, "").split(".").map(function (x) { return parseInt(x, 10) || 0; }); }
  function cmpVer(a, b) {
    var pa = parseVer(a), pb = parseVer(b), n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function checkUpdate(manual) {
    var status = $("updateStatus");
    if (status) status.textContent = "Buscando…";
    log("Update check started");
    fetch("https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest", { headers: { "Accept": "application/vnd.github+json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var latest = data && data.tag_name ? data.tag_name : "";
        var url = data && data.html_url ? data.html_url : ("https://github.com/" + UPDATE_REPO + "/releases");
        // find apk asset
        var apkUrl = url;
        if (data && Array.isArray(data.assets)) {
          data.assets.forEach(function (a) { if (a && /\.apk$/i.test(a.name) && a.browser_download_url) apkUrl = a.browser_download_url; });
        }
        if (!latest) {
          log("Update check result: no version found", "error");
          if (status) status.textContent = "No se pudo obtener la versión.";
          return;
        }
        if (cmpVer(latest, APP_VERSION) > 0) {
          log("Update check result: " + latest + " available");
          if (status) status.textContent = "Nueva versión disponible: " + latest;
          var msg = "Hay una nueva versión (" + latest + "). ¿Abrir la página de descarga?";
          if (manual || true) {
            dialog({ title: "Actualización disponible", message: msg, buttons: [
              { label: "Cancelar", value: "cancel" },
              { label: "Descargar", value: "ok", primary: true }
            ] }).then(function (r) {
              if (r.button === "ok") {
                try { window.open(apkUrl, "_blank"); } catch (e) { API.shareText("uri-code.apk", apkUrl); }
              }
            });
          }
        } else {
          log("Update check result: up to date (" + APP_VERSION + ")");
          if (status) status.textContent = "Ya tienes la última versión (" + APP_VERSION + ").";
          if (manual) toast("Ya tienes la última versión");
        }
      })
      .catch(function (e) {
        log("Update check result: failed (" + String(e && e.message || e) + ")", "error");
        if (status) status.textContent = "No se pudo comprobar (sin conexión).";
        if (manual) toast("No se pudo comprobar actualizaciones", "error");
      });
  }

  /* ----- Barra de menús ----- */
  function menuGroups() {
    var has = !!currentTab();
    function act(id) { return function () { UriEditor.action(id); }; }
    return {
      file: [
        { label: "Nuevo archivo", hint: "Ctrl+N", run: function () { newItem("file"); } },
        { label: "Nueva carpeta", run: function () { newItem("dir"); } },
        { separator: true },
        { label: "Importar archivos…", run: importFiles },
        { label: "Compartir archivo actual", disabled: !has, run: shareCurrent },
        { separator: true },
        { label: "Guardar", hint: keyHint("file.save"), disabled: !has, run: saveCurrent },
        { label: "Guardar todo", disabled: !has, run: function () { saveAll(false); } },
        { label: "Cerrar editor", hint: "Ctrl+W", disabled: !has, run: function () { if (S.active >= 0) closeTab(S.active); } },
        { label: "Cerrar todos los editores", disabled: !has, run: closeAllTabs }
      ],
      edit: [
        { label: "Deshacer", hint: "Ctrl+Z", disabled: !has, run: function () { UriEditor.undo(); } },
        { label: "Rehacer", hint: "Ctrl+Y", disabled: !has, run: function () { UriEditor.redo(); } },
        { separator: true },
        { label: "Editor: Añadir cursor arriba", hint: "Ctrl+Alt+Up", disabled: !has, run: act("editor.action.insertCursorAbove") },
        { label: "Editor: Añadir cursor abajo", hint: "Ctrl+Alt+Down", disabled: !has, run: act("editor.action.insertCursorBelow") },
        { label: "Editor: Seleccionar siguiente aparición", hint: "Ctrl+D", disabled: !has, run: act("editor.action.addSelectionToNextFindMatch") },
        { label: "Editor: Seleccionar todas las apariciones", hint: "Ctrl+Shift+L", disabled: !has, run: act("editor.action.selectAllOccurrences") },
        { label: "Ir a llave correspondiente", hint: "Ctrl+]", disabled: !has, run: act("editor.action.bracketMatch") },
        { separator: true },
        { label: "Buscar", hint: keyHint("editor.find"), disabled: !has, run: act("actions.find") },
        { label: "Reemplazar", hint: "Ctrl+H", disabled: !has, run: act("editor.action.startFindReplace") },
        { label: "Buscar en archivos", hint: "Ctrl+Shift+F", run: function () { setView("search", true); } },
        { separator: true },
        { label: "Alternar comentario de línea", hint: "Ctrl+/", disabled: !has, run: act("editor.action.commentLine") },
        { label: "Formatear documento", disabled: !has, run: act("editor.action.formatDocument") },
        { label: "Ir a símbolo", disabled: !has, run: act("editor.action.quickOutline") },
        { label: "Insertar snippet…", disabled: !has, run: insertSnippet }
      ],
      view: [
        { label: "Paleta de comandos…", hint: keyHint("workbench.showCommands"), run: function () { openPalette(">"); } },
        { separator: true },
        { label: "Explorador", hint: "Ctrl+Shift+E", run: function () { setView("explorer", true); } },
        { label: "Buscar", run: function () { setView("search", true); } },
        { label: "Chat IA", run: function () { setView("ai", true); } },
        { label: "Ajustes", hint: "Ctrl+,", run: function () { setView("settings", true); } },
        { separator: true },
        { label: "Alternar barra lateral", hint: keyHint("workbench.toggleSidebar"), run: function () { showSidebar(!sidebarVisible()); } },
        { label: (S.settings.wordWrap ? "✓ " : "") + "Ajuste de línea", run: function () { S.settings.wordWrap = !S.settings.wordWrap; saveSettings(); applySettings(); } },
        { label: (S.settings.minimap ? "✓ " : "") + "Minimapa", run: function () { S.settings.minimap = !S.settings.minimap; saveSettings(); applySettings(); } },
        { label: "Aumentar fuente", run: function () { changeFont(1); } },
        { label: "Reducir fuente", run: function () { changeFont(-1); } }
      ],
      go: [
        { label: "Ir a archivo…", hint: keyHint("file.goToFile"), run: function () { openPalette(""); } },
        { label: "Ir a línea…", hint: keyHint("editor.gotoLine"), disabled: !has, run: function () { openPalette(":"); } },
        { separator: true },
        { label: "Editor siguiente", hint: "Ctrl+PgDn", disabled: S.tabs.length < 2, run: function () { cycleTab(1); } },
        { label: "Editor anterior", hint: "Ctrl+PgUp", disabled: S.tabs.length < 2, run: function () { cycleTab(-1); } }
      ],
      help: [
        { label: "Atajos de teclado", run: showShortcuts },
        { label: "Acerca de Uri Code", run: function () {
          dialog({ title: "Uri Code 2.0.0", message: "Editor de código para Android basado en Monaco, el motor de VS Code.\nTus proyectos se guardan en el almacenamiento interno de la app.", buttons: [{ label: "Cerrar", value: "ok", primary: true }] });
        } }
      ]
    };
  }

  function showShortcuts() {
    var lines = S.registeredKeybindings.map(function (binding) {
      return binding.label + "\t" + binding.key;
    });
    lines.push("Nuevo archivo\tCtrl+N", "Cerrar editor\tCtrl+W", "Buscar en archivos\tCtrl+Shift+F", "Siguiente / anterior\tCtrl+PgDn / PgUp");
    dialog({ title: "Atajos de teclado", message: lines.join("\n"), buttons: [{ label: "Cerrar", value: "ok", primary: true }] });
  }

  function openMenuFor(name, btn) {
    if (document.body.classList.contains("menu-open") && S.menuName === name) { closeMenu(); return; }
    var r = btn.getBoundingClientRect();
    showMenu(menuGroups()[name], r.left, r.bottom + 1);
    S.menuName = name;
    btn.classList.add("open");
  }

  function openMainMenu() {
    var g = menuGroups();
    var items = [].concat(g.file, [{ separator: true }], g.go, [{ separator: true }], g.view, [{ separator: true }], g.help);
    var r = $("btnMenu").getBoundingClientRect();
    showMenu(items, r.left, r.bottom + 2);
  }

  /* ----- Separador de la barra lateral ----- */
  function bindSash() {
    var sash = $("sash"), dragging = false;
    var saved = parseInt(localStorage.getItem("uri.sidebarW"), 10);
    if (saved >= 180 && saved <= 560) document.documentElement.style.setProperty("--sidebar-w", saved + "px");
    sash.addEventListener("pointerdown", function (e) {
      e.preventDefault(); dragging = true; sash.setPointerCapture(e.pointerId); sash.classList.add("drag");
    });
    sash.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var left = $("activitybar").getBoundingClientRect().right;
      var w = Math.max(180, Math.min(560, Math.round(e.clientX - left)));
      document.documentElement.style.setProperty("--sidebar-w", w + "px");
    });
    function end(e) {
      if (!dragging) return;
      dragging = false; sash.classList.remove("drag");
      try { sash.releasePointerCapture(e.pointerId); } catch (er) {}
      var w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"), 10);
      if (w) try { localStorage.setItem("uri.sidebarW", String(w)); } catch (er) {}
    }
    sash.addEventListener("pointerup", end);
    sash.addEventListener("pointercancel", end);
    sash.addEventListener("dblclick", function () {
      document.documentElement.style.setProperty("--sidebar-w", "280px");
      try { localStorage.setItem("uri.sidebarW", "280"); } catch (er) {}
    });
  }

  /* ================= Búsqueda en archivos ================= */
  var searchOpts = { caseSensitive: false, regex: false };

  function buildMatcher(q) {
    var flags = searchOpts.caseSensitive ? "g" : "gi";
    var src = searchOpts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(src, flags);
  }

  function runSearch() {
    var q = $("searchInput").value;
    var results = $("searchResults");
    var summary = $("searchSummary");
    var token = ++S.searchToken;
    results.innerHTML = "";
    if (!q) { summary.textContent = ""; return; }
    var re;
    try { re = buildMatcher(q); } catch (e) { summary.textContent = "Expresión regular no válida"; return; }
    summary.textContent = "Buscando…";

    var openContent = {};
    S.tabs.forEach(function (t) { openContent[t.path] = UriEditor.getValue(t.path); });

    var total = 0, filesWith = 0, LIMIT = 1000, BATCH = 25;

    function readOne(f) {
      if (openContent[f.path] !== undefined) return Promise.resolve(openContent[f.path]);
      if (f.size > 1000000) return Promise.resolve(null);
      return API.readFile(f.path);
    }

    function scan(f, text) {
      if (total >= LIMIT) return;
      if (text === null || text.indexOf("\u0000") >= 0) return;
      var lines = text.split("\n"), matches = [];
      for (var n = 0; n < lines.length && matches.length < 200; n++) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(lines[n])) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          matches.push({ line: n + 1, col: m.index + 1, len: m[0].length, text: lines[n] });
          if (matches.length >= 200) break;
        }
      }
      if (matches.length) { filesWith++; total += matches.length; addResultFile(results, f, matches); }
    }

    allFiles().then(function (files) {
      if (token !== S.searchToken) return;
      var i = 0;
      function finish() {
        summary.textContent = total === 0 ? "Sin resultados" :
          total + " resultado" + (total === 1 ? "" : "s") + " en " + filesWith + " archivo" + (filesWith === 1 ? "" : "s") +
          (total >= LIMIT ? " (límite alcanzado)" : "");
      }
      function step() {
        if (token !== S.searchToken) return;
        var batch = files.slice(i, i + BATCH);
        i += batch.length;
        Promise.all(batch.map(readOne)).then(function (texts) {
          if (token !== S.searchToken) return;
          batch.forEach(function (f, k) { if (total < LIMIT) scan(f, texts[k]); });
          if (i < files.length && total < LIMIT) {
            summary.textContent = "Buscando… " + total + " resultados";
            setTimeout(step, 0);
          } else { finish(); }
        });
      }
      if (!files.length) { finish(); return; }
      step();
    });
  }

  function runReplaceAll() {
    var q = $("searchInput").value;
    var repl = $("replaceInput").value;
    if (!q) { toast("Escribe un texto a buscar", "error"); return; }
    var re;
    try { re = buildMatcher(q); } catch (e) { toast("Expresión regular no válida", "error"); return; }
    askConfirm("Reemplazar en todos los archivos",
      "Se reemplazarán todas las coincidencias de «" + q + "» por «" + repl + "» en todos los archivos del workspace.",
      "Reemplazar todo").then(function (ok) {
      if (!ok) return;
      var openContent = {};
      S.tabs.forEach(function (t) { openContent[t.path] = UriEditor.getValue(t.path); });
      allFiles().then(function (files) {
        var totalRepl = 0, filesChanged = 0, i = 0, BATCH = 25;
        function step() {
          var batch = files.slice(i, i + BATCH);
          i += batch.length;
          Promise.all(batch.map(function (f) {
            if (openContent[f.path] !== undefined) return Promise.resolve(openContent[f.path]);
            if (f.size > 1000000) return Promise.resolve(null);
            return API.readFile(f.path);
          })).then(function (texts) {
            var writes = [];
            batch.forEach(function (f, k) {
              var text = texts[k];
              if (text === null || text.indexOf("\u0000") >= 0) return;
              re.lastIndex = 0;
              var count = (text.match(re) || []).length;
              if (!count) return;
              re.lastIndex = 0;
              var newText = text.replace(re, function () { return repl; });
              if (newText === text) return;
              totalRepl += count; filesChanged++;
              if (openContent[f.path] !== undefined) {
                // update open tab editor
                var tab = S.tabs.find(function (t) { return t.path === f.path; });
                if (tab) { UriEditor.setValue(f.path, newText); tab.dirty = true; renderTabs(); }
              }
              writes.push(API.writeFile(f.path, newText));
            });
            Promise.all(writes).then(function () {
              if (i < files.length) { setTimeout(step, 0); }
              else {
                toast("Reemplazados " + totalRepl + " en " + filesChanged + " archivos", "ok");
                runSearch();
              }
            });
          });
        }
        if (!files.length) { toast("Sin archivos", "info"); return; }
        step();
      });
    });
  }
  var diffEditor = null;
  function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function openDiff(path) {
    var cwd = gitCwd();
    API.runCommand("git rev-parse --show-toplevel", cwd).then(function (r) {
      if (r.code !== 0 || !r.stdout.trim()) { toast("No es un repositorio git", "error"); return; }
      var root = r.stdout.trim();
      var rel = path;
      if (rel.indexOf(root) === 0) rel = rel.slice(root.length).replace(/^\/+/, "");
      var current = UriEditor.getValue(path) || "";
      API.runCommand("git show HEAD:" + shellQuote(rel), cwd).then(function (r2) {
        var original = (r2.code === 0) ? (r2.stdout || "") : "";
        // open modal
        $("diff-backdrop").style.display = "flex";
        var host = $("diffHost");
        host.innerHTML = "";
        if (diffEditor) { try { diffEditor.dispose(); } catch (e) {} diffEditor = null; }
        var mon = window.monaco;
        if (!mon) { host.textContent = "Monaco no disponible"; return; }
        var origModel = mon.editor.createModel(original, langOf(path), mon.Uri.parse("original://" + path));
        var modModel = mon.editor.createModel(current, langOf(path), mon.Uri.parse("modified://" + path));
        diffEditor = mon.editor.createDiffEditor(host, { theme: "uri-dark", automaticLayout: true, readOnly: false });
        diffEditor.setModel({ original: origModel, modified: modModel });
        $("diffTitle").textContent = "Diff: " + (path.split("/").pop());
      });
    });
  }
  function closeDiff() {
    $("diff-backdrop").style.display = "none";
    if (diffEditor) { try { diffEditor.dispose(); } catch (e) {} diffEditor = null; }
    $("diffHost").innerHTML = "";
  }

  function markerPath(marker) {
    var resource = marker && marker.resource;
    var path = "";
    if (typeof resource === "string") {
      path = resource;
    } else if (resource) {
      path = resource.path || resource.fsPath || "";
      if (!path && typeof resource.toString === "function") path = resource.toString();
    }
    path = String(path || "");
    if (path.indexOf("file://") === 0) {
      try { path = decodeURIComponent(path.replace(/^file:\/\//, "")); } catch (e) {}
    }
    return path.replace(/^\/+/, "");
  }

  function markerPosition(marker) {
    marker = marker || {};
    var range = marker.range || {};
    var line = marker.startLineNumber || range.startLineNumber || 1;
    var col = marker.startColumn || range.startColumn || 1;
    var endLine = marker.endLineNumber || range.endLineNumber || line;
    var endCol = marker.endColumn || range.endColumn || col;
    var len = marker.length || 1;
    if (endLine === line && endCol > col) len = endCol - col;
    return { line: line, col: col, len: len };
  }

  function collectProblemMarkers() {
    if (!S.settings.diagnosticsEnabled) return [];
    var mon = window.monaco;
    if (!mon && typeof monaco !== "undefined") mon = monaco;
    var markers = [];
    try {
      if (mon && mon.editor && typeof mon.editor.getModelMarkers === "function") {
        markers = mon.editor.getModelMarkers({}) || [];
      }
    } catch (e) {}
    return Array.isArray(markers) ? markers.slice() : [];
  }

  function refreshProblems() {
    var markers = collectProblemMarkers();
    S.problemMarkers = markers;
    var count = $("problemsCount");
    if (count) count.textContent = String(markers.length);
    var list = $("problemsList");
    if (!list) return markers;
    list.innerHTML = "";
    if (!markers.length) {
      var empty = document.createElement("div");
      empty.className = "empty-note problems-empty";
      empty.textContent = S.settings.diagnosticsEnabled ? "No hay problemas." : "Los diagnósticos están desactivados.";
      list.appendChild(empty);
      return markers;
    }
    markers.forEach(function (marker) {
      var path = markerPath(marker);
      var pos = markerPosition(marker);
      var severity = marker && marker.severity === 8 ? "error" : "warning";
      var severityLabel = severity === "error" ? "Error" : "Warning";
      var message = marker && marker.message ? String(marker.message) : "";
      var fileName = path ? baseName(path) : "Archivo";
      var row = document.createElement("div");
      row.className = "row problem-row problem " + severity;
      row.setAttribute("data-path", path);
      row.setAttribute("data-line", String(pos.line));
      row.setAttribute("data-col", String(pos.col));
      row.setAttribute("data-severity", severity);
      row.setAttribute("data-message", message);
      row.setAttribute("aria-label", severityLabel + " " + fileName + ":" + pos.line + ":" + pos.col + " " + message);
      var icon = window.Icons && window.Icons.svg ? window.Icons.svg(severity, 16) : "";
      row.innerHTML = '<span class="problem-severity ' + severity + ' severity-icon" title="' + severityLabel + '" aria-label="' + severityLabel + '">' + icon + "</span>" +
        '<span class="problem-file">' + esc(fileName) + "</span>" +
        '<span class="problem-position">' + pos.line + ":" + pos.col + "</span>" +
        '<span class="problem-message">' + esc(message) + "</span>";
      row.addEventListener("click", function () { openProblem(path, pos); });
      list.appendChild(row);
    });
    return markers;
  }

  function openProblem(path, pos) {
    if (!path) return;
    openFile(path, { line: pos.line, col: pos.col, len: pos.len || 1 });
  }

  function showProblems() {
    refreshProblems();
    setView("problems", true);
  }


  function addResultFile(container, f, matches) {
    var head = document.createElement("div");
    head.className = "res-file";
    head.innerHTML = '<span class="ficon">' + Icons.fileIcon(f.name) + '</span><span class="rname"></span><span class="rdir"></span><span class="rcount">' + matches.length + "</span>";
    head.querySelector(".rname").textContent = f.name;
    head.querySelector(".rdir").textContent = dirName(f.path);
    var body = document.createElement("div");
    head.addEventListener("click", function () { body.style.display = body.style.display === "none" ? "" : "none"; });
    container.appendChild(head);
    matches.forEach(function (m) {
      var d = document.createElement("div");
      d.className = "res-line";
      var t = m.text.replace(/\r$/, ""), start = Math.max(0, m.col - 1 - 20);
      var before = t.slice(start, m.col - 1), hit = t.slice(m.col - 1, m.col - 1 + m.len), after = t.slice(m.col - 1 + m.len, m.col - 1 + m.len + 80);
      d.innerHTML = esc(before.replace(/^\s+/, "")) + "<mark>" + esc(hit) + "</mark>" + esc(after);
      d.title = f.path + ":" + m.line;
      d.addEventListener("click", function () { openFile(f.path, { line: m.line, col: m.col, len: m.len }); });
      body.appendChild(d);
    });
    container.appendChild(body);
  }

  /* ================= Ajustes ================= */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", S.settings.theme || "dark");
    if (window.monaco && monaco.editor) { try { monaco.editor.setTheme((S.settings.theme === "light") ? "vs" : "uri-dark"); } catch (e) {} }
  }
  function applyExtensionSetting() {
    if (!window.UriExtensions || typeof window.UriExtensions.getContributions !== "function") return;
    var extensions = window.UriExtensions.getContributions().extensions || [];
    extensions.forEach(function (extension) {
      if (S.settings.extensionsEnabled && !extension.active) window.UriExtensions.activate(extension.id);
      else if (!S.settings.extensionsEnabled && extension.active) window.UriExtensions.deactivate(extension.id);
    });
  }
  function applySettings() {
    UriEditor.applyOptions({
      fontSize: S.settings.fontSize,
      wordWrap: S.settings.wordWrap,
      minimap: S.settings.minimap,
      minimapSide: S.settings.minimapSide,
      tabSize: S.settings.tabSize,
      insertSpaces: S.settings.insertSpaces,
      renderWhitespace: S.settings.renderWhitespace,
      cursorBlink: S.settings.cursorBlink,
      smoothScrolling: S.settings.smoothScrolling
    });
    applyTheme();
    applyExtensionSetting();
    refreshSettingsUI();
    Chat.refresh();
    refreshProblems();
  }

  function settingControlId(setting) {
    if (setting.domId) return setting.domId;
    return "set" + setting.id.charAt(0).toUpperCase() + setting.id.slice(1);
  }
  function filterSettings(query) {
    var text = String(query == null ? "" : query).trim().toLowerCase();
    if (!text) return SETTINGS.slice();
    return SETTINGS.filter(function (setting) {
      return (setting.id + " " + setting.label + " " + setting.description).toLowerCase().indexOf(text) >= 0;
    });
  }
  function refreshSettingsUI() {
    SETTINGS.forEach(function (setting) {
      var control = $(settingControlId(setting));
      if (!control) return;
      if (setting.type === "checkbox") control.checked = !!S.settings[setting.id];
      else if (document.activeElement !== control) control.value = S.settings[setting.id] == null ? "" : String(S.settings[setting.id]);
    });
  }
  function settingValue(setting, control) {
    var value;
    if (setting.type === "checkbox") value = !!control.checked;
    else if (setting.type === "number") {
      value = Number(control.value);
      if (!Number.isFinite(value)) value = setting.default;
      if (setting.min != null) value = Math.max(setting.min, value);
      if (setting.max != null) value = Math.min(setting.max, value);
    } else value = String(control.value == null ? "" : control.value);
    return value;
  }
  function updateSetting(setting, control) {
    if (!setting) return;
    var value = settingValue(setting, control);
    if (S.settings[setting.id] === value) return;
    S.settings[setting.id] = value;
    if (setting.id === "nimModel" && !S.settings.nimModel) S.settings.nimModel = DEFAULTS.nimModel;
    saveSettings();
    if (setting.id === "autoSave" && !S.settings.autoSave) {
      clearTimeout(S.autoTimer);
      S.autoTimer = null;
    }
    applySettings();
  }
  var domEventCounter = 0;
  function bindDomEvent(element, name, handler) {
    var marker = "__uriHandled" + (++domEventCounter);
    var registry = element.__uriDomHandlers || {};
    if (registry[name]) element.removeEventListener(name, registry[name]);
    function run(event) {
      if (event) {
        if (event[marker]) return;
        event[marker] = true;
      }
      handler(event);
    }
    element["on" + name] = run;
    element.addEventListener(name, run);
    registry[name] = run;
    element.__uriDomHandlers = registry;
  }
  function createSettingControl(setting) {
    var id = settingControlId(setting);
    var control = document.getElementById(id);
    if (!control) control = document.createElement(setting.type === "textarea" ? "textarea" : setting.type === "select" ? "select" : "input");
    control.id = id;
    control.className = "setting-control";
    control.setAttribute("data-setting-id", setting.id);
    control.setAttribute("data-setting-type", setting.type);
    if (setting.type === "checkbox") {
      control.type = "checkbox";
      control.checked = !!S.settings[setting.id];
    } else if (setting.type === "number") {
      control.type = "number";
      if (setting.min != null) control.min = String(setting.min);
      if (setting.max != null) control.max = String(setting.max);
      control.step = "1";
      control.value = String(S.settings[setting.id]);
    } else if (setting.type === "select") {
      control.type = "select-one";
      control.innerHTML = "";
      (setting.options || []).forEach(function (option) {
        var item = document.createElement("option");
        item.value = option.value;
        item.textContent = option.label;
        control.appendChild(item);
      });
      control.value = String(S.settings[setting.id]);
    } else if (setting.type === "textarea") {
      control.rows = "5";
      control.value = String(S.settings[setting.id] == null ? "" : S.settings[setting.id]);
    } else {
      control.type = setting.secret ? "password" : "text";
      control.autocomplete = "off";
      control.value = String(S.settings[setting.id] == null ? "" : S.settings[setting.id]);
    }
    function changed() { updateSetting(setting, control); }
    if (setting.type === "text" || setting.type === "textarea") {
      bindDomEvent(control, "input", changed);
      bindDomEvent(control, "change", changed);
    } else {
      bindDomEvent(control, "change", changed);
    }
    return control;
  }
  function renderSetting(setting) {
    var row = document.createElement("div");
    row.className = "setting-item";
    row.setAttribute("data-setting-id", setting.id);
    row.setAttribute("data-category", setting.category);
    var text = document.createElement("div");
    text.className = "setting-copy";
    var label = document.createElement("label");
    label.className = "setting-label";
    label.setAttribute("for", settingControlId(setting));
    label.textContent = setting.label;
    var description = document.createElement("div");
    description.className = "setting-description";
    description.textContent = setting.description;
    text.appendChild(label);
    text.appendChild(description);
    var controlWrap = document.createElement("div");
    controlWrap.className = "setting-value";
    controlWrap.appendChild(createSettingControl(setting));
    row.appendChild(text);
    row.appendChild(controlWrap);
    return row;
  }
  function renderSettingsCategories(filtered) {
    var nav = $("settingsCategories");
    if (!nav) return;
    nav.innerHTML = "";
    CATEGORIES.forEach(function (category) {
      var button = document.createElement("button");
      var count = filtered.filter(function (setting) { return setting.category === category.id; }).length;
      button.className = "settings-category" + ((!S.settingsQuery && S.settingsCategory === category.id) || (S.settingsQuery && count) ? " active" : "");
      button.setAttribute("data-category", category.id);
      button.textContent = category.label;
      bindDomEvent(button, "click", function () {
        S.settingsCategory = category.id;
        S.settingsQuery = "";
        $("setSearch").value = "";
        renderSettings();
      });
      nav.appendChild(button);
    });
  }
  function renderKeybindings(section) {
    var heading = document.createElement("div");
    heading.className = "settings-subheading";
    heading.textContent = "Atajos de teclado";
    section.appendChild(heading);
    var note = document.createElement("div");
    note.className = "settings-note";
    note.textContent = "Selecciona un atajo y pulsa la nueva combinación. Borra el texto para recuperar el atajo predeterminado.";
    section.appendChild(note);
    var reset = document.createElement("button");
    reset.id = "resetKeybindings";
    reset.className = "btn btn-ghost btn-sm settings-reset";
    reset.textContent = "Restablecer atajos";
    bindDomEvent(reset, "click", function () {
      resetKeybindings();
      renderSettings();
      toast("Atajos restablecidos");
    });
    section.appendChild(reset);
    var list = document.createElement("div");
    list.className = "keybindings-list";
    S.registeredKeybindings.forEach(function (binding, index) {
      var row = document.createElement("div");
      row.className = "keybinding-row";
      row.setAttribute("data-command", binding.command);
      var label = document.createElement("label");
      label.className = "keybinding-label";
      label.setAttribute("for", "setKeybinding-" + index);
      label.textContent = binding.label;
      var input = document.createElement("input");
      input.id = "setKeybinding-" + index;
      input.className = "setting-input keybinding-input";
      input.type = "text";
      input.value = binding.key;
      input.setAttribute("data-command", binding.command);
      input.setAttribute("aria-label", "Atajo para " + binding.label);
      function capture(e) {
        var combo = keyComboFromEvent(e);
        if (!combo) return;
        e.preventDefault();
        e.stopPropagation();
        input.value = combo;
        setKeybinding(binding.command, combo);
      }
      function change() {
        var value = String(input.value || "").trim();
        if (!value) {
          setKeybinding(binding.command, "");
          input.value = binding.defaultKey;
        } else {
          var normalized = normalizeKey(value);
          input.value = normalized;
          setKeybinding(binding.command, normalized);
        }
      }
      bindDomEvent(input, "keydown", capture);
      bindDomEvent(input, "change", change);
      row.appendChild(label);
      row.appendChild(input);
      list.appendChild(row);
    });
    section.appendChild(list);
  }
  function reusableControl(id, tag) {
    var control = document.getElementById(id);
    if (!control) control = document.createElement(tag);
    control.id = id;
    control.hidden = false;
    control.removeAttribute("hidden");
    return control;
  }
  function testAiConnection() {
    var status = $("testAiStatus");
    if (!S.settings.nimKey) { toast("Falta API Key", "error"); return; }
    status.textContent = "Probando…";
    window.API.httpPost("https://integrate.api.nvidia.com/v1/chat/completions", {
      "Authorization": "Bearer " + S.settings.nimKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    }, { model: S.settings.nimModel, messages: [{ role: "user", content: "Di hola" }], temperature: 0.3, max_tokens: 32, stream: false })
      .then(function (r) {
        status.textContent = "HTTP " + r.status + (r.status >= 200 && r.status < 300 ? " OK" : " " + String(r.text).slice(0, 120));
      }).catch(function (e) {
        status.textContent = "Error: " + String(e && e.message || e);
      });
  }
  function renderDiagnosticActions(section) {
    var heading = document.createElement("div");
    heading.className = "settings-subheading";
    heading.textContent = "Estado y pruebas";
    section.appendChild(heading);
    var versionRow = document.createElement("div");
    versionRow.className = "settings-action-row";
    var versionLabel = document.createElement("span");
    versionLabel.textContent = "Versión actual: ";
    var version = reusableControl("verCurrent", "span");
    version.className = "settings-version";
    version.textContent = APP_VERSION;
    versionLabel.appendChild(version);
    var update = reusableControl("checkUpdate", "button");
    update.className = "btn btn-primary btn-sm";
    update.textContent = "Buscar actualizaciones";
    bindDomEvent(update, "click", function () { checkUpdate(true); });
    versionRow.appendChild(versionLabel);
    versionRow.appendChild(update);
    section.appendChild(versionRow);
    var updateStatus = reusableControl("updateStatus", "span");
    updateStatus.className = "settings-note";
    section.appendChild(updateStatus);
    var aiRow = document.createElement("div");
    aiRow.className = "settings-action-row";
    var aiButton = reusableControl("testAi", "button");
    aiButton.className = "btn btn-ghost btn-sm";
    aiButton.textContent = "Probar conexión IA";
    bindDomEvent(aiButton, "click", testAiConnection);
    var aiStatus = reusableControl("testAiStatus", "span");
    aiStatus.className = "settings-note";
    aiRow.appendChild(aiButton);
    aiRow.appendChild(aiStatus);
    section.appendChild(aiRow);
    var about = document.createElement("div");
    about.className = "settings-note";
    about.textContent = "Uri Code · Editor Monaco · Proyectos en el almacenamiento interno de la app.";
    section.appendChild(about);
  }
  function renderSettings() {
    var content = $("settingsContent");
    if (!content) return;
    var filtered = filterSettings(S.settingsQuery);
    content.innerHTML = "";
    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "settings-empty";
      empty.textContent = "No hay ajustes que coincidan con la búsqueda.";
      content.appendChild(empty);
      renderSettingsCategories(filtered);
      return;
    }
    CATEGORIES.forEach(function (category) {
      var definitions = filtered.filter(function (setting) { return setting.category === category.id; });
      if (S.settingsQuery && !definitions.length) return;
      var section = document.createElement("section");
      section.className = "settings-section" + ((!S.settingsQuery && S.settingsCategory === category.id) || S.settingsQuery ? " active" : "");
      section.setAttribute("data-category", category.id);
      var title = document.createElement("h2");
      title.className = "settings-category-title";
      title.textContent = category.label;
      section.appendChild(title);
      definitions.forEach(function (setting) { section.appendChild(renderSetting(setting)); });
      if (category.id === "general") renderKeybindings(section);
      if (category.id === "diagnostic") renderDiagnosticActions(section);
      content.appendChild(section);
    });
    renderSettingsCategories(filtered);
  }

  function getSnippets() {
    var s = S.settings.snippets || "";
    try { var o = JSON.parse(s); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; }
  }

  function bindSettings() {
    renderSettings();
    var search = $("setSearch");
    function filter() {
      S.settingsQuery = String(search.value || "").trim();
      renderSettings();
    }
    bindDomEvent(search, "input", filter);
  }

  /* ================= Barra de teclas (móvil) ================= */
  function buildKeybar() {
    var kb = $("keybar");
    var keys = [
      { l: "Tab", wide: true, f: function () { UriEditor.pressTab(); } },
      { l: "↶", f: function () { UriEditor.undo(); } },
      { l: "↷", f: function () { UriEditor.redo(); } }
    ];
    "{ } ( ) [ ] < > ; : \" ' = / \\ | & $ _ - + * # ! ? , . ` ~ % @".split(" ").forEach(function (ch) {
      keys.push({ l: ch, f: function () { UriEditor.typeText(ch); } });
    });
    keys.forEach(function (k) {
      var b = document.createElement("button");
      b.textContent = k.l;
      if (k.wide) b.className = "wide";
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", k.f);
      kb.appendChild(b);
    });
  }

  var dc = $("diffClose"); if (dc) dc.onclick = closeDiff;
  var db = $("diff-backdrop"); if (db) db.addEventListener("click", function (e) { if (e.target === db) closeDiff(); });

  var gitEntries = [];
  var gitCurrentBranch = "";
  var gitRefreshToken = 0;

  function gitCwd() {
    var input = $("termCwd");
    return input ? String(input.value || "").trim() : "";
  }

  function runGitCommand(cmd, cwd) {
    return API.runCommand(String(cmd || ""), cwd == null ? gitCwd() : String(cwd || ""));
  }

  function showGit(r) {
    var out = $("gitOut");
    if (!out) return;
    r = r || {};
    out.textContent = (r.stdout || "") + (r.stderr ? "\n[stderr]\n" + r.stderr : "") || "(sin salida)";
  }

  function gitEntryRow(entry) {
    var row = document.createElement("div");
    row.className = "git-file-row";
    row.setAttribute("data-git-entry", "1");
    row.setAttribute("data-path", entry.path);
    row.setAttribute("data-status", entry.status);
    row.setAttribute("data-staged", entry.staged ? "1" : "0");

    var badge = document.createElement("button");
    badge.className = "git-status-badge git-status-" + entry.kind;
    badge.textContent = entry.status;
    badge.title = entry.kind;
    badge.setAttribute("aria-label", "Estado: " + entry.status);
    badge.addEventListener("click", function () { openGitEntry(entry); });

    var name = document.createElement("button");
    name.className = "git-file-name";
    name.textContent = entry.path;
    name.title = entry.path;
    name.addEventListener("click", function () { openGitEntry(entry); });

    var actions = document.createElement("span");
    actions.className = "git-file-actions";

    var stage = document.createElement("button");
    stage.className = "git-action git-stage-toggle";
    stage.textContent = entry.staged ? "Unstage" : "Stage";
    stage.title = entry.staged ? "Quitar del área de preparación" : "Preparar cambios";
    stage.setAttribute("data-action", entry.staged ? "unstage" : "stage");
    stage.addEventListener("click", function (e) {
      e.stopPropagation();
      stageGitEntry(entry);
    });

    var discard = document.createElement("button");
    discard.className = "git-action git-discard";
    discard.textContent = "Descartar cambios";
    discard.title = "Descartar cambios del archivo";
    discard.setAttribute("data-action", "discard");
    discard.addEventListener("click", function (e) {
      e.stopPropagation();
      discardGitEntry(entry);
    });

    actions.appendChild(stage);
    actions.appendChild(discard);
    row.appendChild(badge);
    row.appendChild(name);
    row.appendChild(actions);
    row.addEventListener("click", function (e) {
      if (e && e.target && typeof e.target.closest === "function" && e.target.closest(".git-action")) return;
      openGitEntry(entry);
    });
    return row;
  }

  function renderGitFileList(box, entries) {
    if (!box) return;
    box.innerHTML = "";
    if (!entries.length) {
      var empty = document.createElement("div");
      empty.className = "git-empty";
      empty.textContent = "No hay cambios";
      box.appendChild(empty);
      return;
    }
    entries.forEach(function (entry) { box.appendChild(gitEntryRow(entry)); });
  }

  function renderGitEntries(entries) {
    gitEntries = Array.isArray(entries) ? entries : [];
    var staged = [], unstaged = [];
    gitEntries.forEach(function (entry) {
      if (entry.staged) staged.push(entry); else unstaged.push(entry);
    });
    renderGitFileList($("gitChangesList"), unstaged);
    renderGitFileList($("gitStagedList"), staged);
    var changesCount = $("gitChangesCount");
    var stagedCount = $("gitStagedCount");
    if (changesCount) changesCount.textContent = String(unstaged.length);
    if (stagedCount) stagedCount.textContent = String(staged.length);
  }

  function refreshGit(showOutput) {
    var cwd = gitCwd();
    var token = ++gitRefreshToken;
    if (showOutput) showGit({ stdout: "Ejecutando…" });
    return Promise.all([
      API.runCommand("git status --porcelain", cwd),
      API.runCommand("git branch --show-current", cwd)
    ]).then(function (results) {
      if (token !== gitRefreshToken) return null;
      var statusResult = results[0] || { code: -1, stdout: "", stderr: "Sin respuesta" };
      var branchResult = results[1] || { code: -1, stdout: "", stderr: "Sin respuesta" };
      if (statusResult.code === 0) {
        renderGitEntries(parseGitStatus(statusResult.stdout));
        if (showOutput) showGit(statusResult);
      } else {
        renderGitEntries([]);
        showGit(statusResult);
      }
      gitCurrentBranch = branchResult.code === 0 ? String(branchResult.stdout || "").trim() : "";
      var branch = $("gitBranch");
      if (branch) branch.textContent = gitCurrentBranch || "Sin rama";
      return { entries: gitEntries.slice(), branch: gitCurrentBranch };
    }).catch(function (e) {
      if (token !== gitRefreshToken) return null;
      renderGitEntries([]);
      showGit({ code: -1, stdout: "", stderr: String(e && e.message || e) });
      return { entries: [], branch: "" };
    });
  }

  function openGitEntry(entry) {
    return openFile(entry.path);
  }

  function stageGitEntry(entry) {
    var cmd = entry.staged
      ? "git restore --staged -- " + shellQuote(entry.path)
      : "git add -- " + shellQuote(entry.path);
    return runGitCommand(cmd).then(function (r) {
      showGit(r);
      if (r.code !== 0) {
        toast("No se pudo " + (entry.staged ? "quitar los cambios de preparación" : "preparar el archivo"), "error");
        return r;
      }
      toast(entry.staged ? "Cambios quitados de preparación" : "Cambios preparados");
      return refreshGit();
    });
  }

  function discardGitEntry(entry) {
    return runGitCommand("git checkout -- " + shellQuote(entry.path)).then(function (r) {
      showGit(r);
      if (r.code !== 0) {
        toast("No se pudieron descartar los cambios", "error");
        return r;
      }
      toast("Cambios descartados: " + baseName(entry.path));
      return refreshGit();
    });
  }

  function switchGitBranch() {
    var cwd = gitCwd();
    showGit({ stdout: "Obteniendo ramas…" });
    return API.runCommand("git branch --all", cwd).then(function (r) {
      showGit(r);
      if (r.code !== 0) {
        toast("No se pudieron obtener las ramas", "error");
        return null;
      }
      var branches = parseGitBranches(r.stdout);
      var message = branches.length
        ? "Ramas disponibles:\n" + branches.join("\n")
        : "No se encontraron ramas.";
      return askText("Cambiar de rama", gitCurrentBranch, "main", message);
    }).then(function (branchName) {
      if (!branchName) return null;
      return runGitCommand("git checkout " + shellQuote(branchName), cwd).then(function (r) {
        showGit(r);
        if (r.code !== 0) {
          toast("No se pudo cambiar de rama", "error");
          return r;
        }
        toast("Rama cambiada: " + branchName);
        return refreshGit();
      });
    });
  }

  function listGitBranches() {
    showGit({ stdout: "Ejecutando…" });
    return runGitCommand("git branch --all").then(showGit);
  }

  function commitGit() {
    var input = $("gitMsg");
    var msg = input ? String(input.value || "").trim() : "";
    if (!msg) { toast("Escribe un mensaje de commit", "error"); return Promise.resolve(null); }
    showGit({ stdout: "Ejecutando…" });
    return runGitCommand("git add -A && git commit -m " + shellQuote(msg)).then(function (r) {
      showGit(r);
      if (r.code !== 0) {
        toast("No se pudo crear el commit", "error");
        return r;
      }
      if (input) input.value = "";
      toast("Commit realizado");
      return refreshGit();
    });
  }

  function syncGit() {
    var cwd = gitCwd();
    showGit({ stdout: "Ejecutando…" });
    return API.runCommand("git pull", cwd).then(function (pull) {
      showGit(pull);
      if (pull.code !== 0) {
        toast("No se pudo completar el pull", "error");
        return pull;
      }
      return API.runCommand("git push", cwd).then(function (push) {
        showGit(push);
        if (push.code !== 0) {
          toast("No se pudo completar el push", "error");
          return push;
        }
        toast("Sincronización completada");
        return refreshGit();
      });
    });
  }

  function bindTermGit() {
    var term = null, fitAddon = null, history = [], histIdx = -1, inputBuf = "";
    if (typeof Terminal !== "undefined") {
      term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: "Consolas, 'Roboto Mono', monospace", theme: { background: "#0c0c0c", foreground: "#cccccc" } });
      if (typeof FitAddon !== "undefined") { fitAddon = new FitAddon.FitAddon(); term.loadAddon(fitAddon); }
      term.open($("termContainer"));
      S.terminalFocusHandler = function () { if (term && typeof term.focus === "function") term.focus(); };
      if (fitAddon) try { fitAddon.fit(); } catch (e) {}
      window.addEventListener("resize", function () { if (fitAddon) try { fitAddon.fit(); } catch (e) {} });
      term.writeln("Uri Code Terminal. Escribe un comando y presiona Enter.");
      term.write("$ ");
      term.onData(function (data) {
        if (data === "\r") {
          var line = inputBuf; inputBuf = "";
          term.write("\r\n");
          if (line.trim()) {
            history.unshift(line); if (history.length > 50) history.pop(); histIdx = -1;
            runTermCmd(line.trim());
          } else { term.write("$ "); }
        } else if (data === "\u007f") {
          if (inputBuf.length > 0) { inputBuf = inputBuf.slice(0, -1); term.write("\b \b"); }
        } else if (data === "\u001b[A") {
          if (history.length) {
            histIdx = Math.min(histIdx + 1, history.length - 1);
            term.write("\r\x1b[K$ " + history[histIdx]);
            inputBuf = history[histIdx];
          }
        } else if (data === "\u001b[B") {
          if (histIdx > 0) { histIdx--; term.write("\r\x1b[K$ " + (history[histIdx] || "")); inputBuf = history[histIdx] || ""; }
          else { histIdx = -1; term.write("\r\x1b[K$ "); inputBuf = ""; }
        } else if (data.charCodeAt(0) >= 32) {
          inputBuf += data; term.write(data);
        }
      });
    }
    function runTermCmd(cmd) {
      var cwd = ($("termCwd").value || "").trim();
      if (cmd === "clear" || cmd === "cls") {
        log("Terminal command completed: " + cmd + " (code 0)");
        if (term) { term.clear(); term.write("$ "); }
        return;
      }
      if (/^cd(\s|$)/.test(cmd)) {
        var target = cmd.slice(2).trim() || "~";
        API.runCommand("cd " + (target || ".") + " && pwd", cwd).then(function (r) {
          if (r.code === 0 && r.stdout) {
            var np = r.stdout.trim();
            if (np) $("termCwd").value = np;
            if (term) term.write("\r\n$ ");
          } else {
            if (term) term.write("\r\n" + (r.stderr || "cd: error") + "\r\n$ ");
          }
          log("Terminal command completed: " + cmd + " (code " + (r.code != null ? r.code : "?") + ")");
        });
        return;
      }
      API.runCommandStream(cmd, cwd, function (chunk) {
        if (term) term.write(String(chunk).replace(/\n/g, "\r\n"));
      }).then(function (r) {
        if (term) term.write("\r\n[código " + (r.code != null ? r.code : "?") + "]\r\n$ ");
        log("Terminal command completed: " + cmd + " (code " + (r.code != null ? r.code : "?") + ")");
      });
    }

    var gitStatusBtn = $("gitStatus"); if (gitStatusBtn) gitStatusBtn.addEventListener("click", function () {
      refreshGit(true);
    });
    var gitRefreshBtn = $("gitRefresh"); if (gitRefreshBtn) gitRefreshBtn.addEventListener("click", function () {
      refreshGit(false);
    });
    var gitLogBtn = $("gitLog"); if (gitLogBtn) gitLogBtn.addEventListener("click", function () {
      showGit({ stdout: "Ejecutando…" });
      runGitCommand("git log --oneline -20").then(showGit);
    });
    var gitDiffBtn = $("gitDiff"); if (gitDiffBtn) gitDiffBtn.addEventListener("click", function () {
      showGit({ stdout: "Ejecutando…" });
      runGitCommand("git diff").then(showGit);
    });
    var gitDiffFileBtn = $("gitDiffFile"); if (gitDiffFileBtn) gitDiffFileBtn.addEventListener("click", function () {
      var active = currentTab();
      var pth = active ? active.path : null;
      if (!pth) { toast("Abre un archivo primero", "error"); return; }
      openDiff(pth);
    });
    var gitPullBtn = $("gitPull"); if (gitPullBtn) gitPullBtn.addEventListener("click", function () {
      showGit({ stdout: "Ejecutando…" });
      runGitCommand("git pull").then(showGit);
    });
    var gitPushBtn = $("gitPush"); if (gitPushBtn) gitPushBtn.addEventListener("click", function () {
      showGit({ stdout: "Ejecutando…" });
      runGitCommand("git push").then(showGit);
    });
    var gitCommitBtn = $("gitCommit"); if (gitCommitBtn) gitCommitBtn.addEventListener("click", commitGit);
    var gitSyncBtn = $("gitSync"); if (gitSyncBtn) gitSyncBtn.addEventListener("click", syncGit);
    var gitBranchSwitchBtn = $("gitBranchSwitch"); if (gitBranchSwitchBtn) gitBranchSwitchBtn.addEventListener("click", switchGitBranch);
    var gitBranchListBtn = $("gitBranchList"); if (gitBranchListBtn) gitBranchListBtn.addEventListener("click", listGitBranches);
  }

  function updateCoarse() { document.body.classList.toggle("coarse", isCoarse() || isNarrow()); }

  /* ================= Atajos de teclado ================= */
  function keyComboFromEvent(e) {
    var key = String(e.key || "");
    if (key === "Dead" || !key) key = String(e.code || "");
    if (key === "ControlLeft" || key === "ControlRight" || key === "ShiftLeft" || key === "ShiftRight" ||
        key === "AltLeft" || key === "AltRight" || key === "MetaLeft" || key === "MetaRight") return "";
    var ctrl = !!(e.ctrlKey || e.metaKey), shift = !!e.shiftKey, alt = !!e.altKey;
    if (!ctrl && !alt) return "";
    if (key.length === 1) key = key.toUpperCase();
    else if (key === "Space") key = "Space";
    var result = [];
    if (ctrl) result.push("Ctrl");
    if (shift) result.push("Shift");
    if (alt) result.push("Alt");
    result.push(key);
    return result.join("+");
  }
  function matchingKeybinding(e) {
    var combo = keyComboFromEvent(e);
    if (!combo) return null;
    return S.registeredKeybindings.find(function (binding) {
      return normalizeKey(binding.key) === combo;
    }) || null;
  }
  function shadowedDefaultKeybinding(e) {
    var combo = keyComboFromEvent(e);
    if (!combo) return null;
    return DEFAULT_KEYBINDINGS.find(function (definition) {
      var current = S.registeredKeybindings.find(function (binding) { return binding.command === definition.command; });
      return current && normalizeKey(current.key) !== normalizeKey(definition.key) && normalizeKey(definition.key) === combo;
    }) || null;
  }
  function runKeybinding(binding) {
    if (!binding) return;
    if (binding.command === "file.goToFile") openPalette("");
    else if (binding.command === "workbench.showCommands") openPalette(">");
    else if (binding.command === "file.save") saveCurrent();
    else if (binding.command === "editor.find") { if (needTab()) UriEditor.action("actions.find"); }
    else if (binding.command === "editor.gotoLine") openPalette(":");
    else if (binding.command === "workbench.toggleSidebar") showSidebar(!sidebarVisible());
    else if (binding.command === "terminal.focus") {
      setView("terminal", true);
      if (typeof S.terminalFocusHandler === "function") S.terminalFocusHandler();
    }
  }
  function bindKeys() {
    window.addEventListener("keydown", function (e) {
      var ctrl = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
      if (Pal.open) {
        if (e.key === "Escape") { e.preventDefault(); closePalette(); UriEditor.focus(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); return; }
        if (e.key === "Enter") { e.preventDefault(); runPalette(); return; }
      }
      if (document.body.classList.contains("dialog-open")) {
        if (e.key === "Escape") { e.preventDefault(); closeDialog("cancel"); }
        else if (e.key === "Enter") {
          var inputShown = $("dlgInput").classList.contains("show");
          if (inputShown && !(e.target && e.target.id === "dlgInput")) return;
          var prim = document.querySelector("#dlgButtons .primary");
          if (prim) { e.preventDefault(); prim.click(); }
        }
        return;
      }
      if (e.key === "Escape" && document.body.classList.contains("menu-open")) { closeMenu(); return; }
      var binding = matchingKeybinding(e);
      if (binding) { e.preventDefault(); runKeybinding(binding); return; }
      if (shadowedDefaultKeybinding(e)) { e.preventDefault(); return; }
      if (e.key === "F1") { e.preventDefault(); openPalette(">"); return; }
      if (ctrl && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (needTab()) UriEditor.action(e.key === "ArrowUp" ? "editor.action.insertCursorAbove" : "editor.action.insertCursorBelow");
        return;
      }
      if (!ctrl) return;
      if (e.key === "PageDown") { e.preventDefault(); cycleTab(1); return; }
      if (e.key === "PageUp") { e.preventDefault(); cycleTab(-1); return; }
      if (k === "w") { e.preventDefault(); if (S.active >= 0) closeTab(S.active); }
      else if (k === "n") { e.preventDefault(); newItem("file"); }
      else if (k === "f" && e.shiftKey) { e.preventDefault(); setView("search", true); }
      else if (k === "e" && e.shiftKey) { e.preventDefault(); setView("explorer", true); }
      else if (k === ",") { e.preventDefault(); setView("settings", true); }
    }, true);
  }

  /* Botón "atrás" de Android: cierra lo que esté abierto antes de salir. */
  window.uriBack = function () {
    if (document.body.classList.contains("dialog-open")) { closeDialog("cancel"); return true; }
    if (Pal.open) { closePalette(); return true; }
    if (document.body.classList.contains("menu-open")) { closeMenu(); return true; }
    if (isNarrow() && sidebarVisible()) { showSidebar(false); return true; }
    return false;
  };

  /* Guarda los cambios pendientes cuando la app pasa a segundo plano. */
  window.uriFlush = function () { saveAll(true); };

  /* ================= Arranque ================= */
  function bindUI() {
    document.querySelectorAll("[data-icon]").forEach(function (el) {
      el.innerHTML = Icons.svg(el.getAttribute("data-icon"), parseInt(el.getAttribute("data-size"), 10) || 16);
    });
    renderOutput();

    document.querySelectorAll(".ab-item").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
    });
    $("scrim").addEventListener("click", function () { showSidebar(false); });

    document.querySelectorAll(".pane-header").forEach(function (h) {
      h.addEventListener("click", function (e) {
        if (e.target.closest(".pane-actions")) return;
        h.parentNode.classList.toggle("collapsed");
      });
    });
    $("explNewFile").onclick = function () { newItem("file"); };
    $("explNewDir").onclick = function () { newItem("dir"); };
    $("explRefresh").onclick = function () { refreshTree().then(function () { toast("Explorador actualizado"); }); };
    $("explCollapse").onclick = collapseAll;

    $("btnMenu").onclick = openMainMenu;
    document.querySelectorAll("#menubar button").forEach(function (b) {
      b.addEventListener("click", function () { openMenuFor(b.getAttribute("data-menu"), b); });
      b.addEventListener("mouseenter", function () {
        if (document.body.classList.contains("menu-open") && S.menuName && S.menuName !== b.getAttribute("data-menu")) {
          closeMenu(); openMenuFor(b.getAttribute("data-menu"), b);
        }
      });
    });
    $("importInput").addEventListener("change", function () { doImport(this.files); });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) doImport(e.dataTransfer.files);
    });
    bindSash();
    $("btnPalette").onclick = function () { openPalette(">"); };
    $("sbBrand").onclick = function () { openPalette(">"); };
    var sbe = $("sbErrors"); if (sbe) sbe.addEventListener("click", showProblems);
    var problemsRefresh = $("problemsRefresh"); if (problemsRefresh) problemsRefresh.addEventListener("click", refreshProblems);
    var outputClear = $("outputClear"); if (outputClear) outputClear.addEventListener("click", function () {
      S.outputLines = [];
      renderOutput();
    });
    var sbSpaces = $("sbSpaces"); if (sbSpaces) sbSpaces.addEventListener("click", function () {
      if (!currentTab()) return;
      var cur = S.settings.tabSize || 4;
      var next = (cur === 2) ? 4 : (cur === 4 ? 8 : 2);
      S.settings.tabSize = next; saveSettings(); UriEditor.applyOptions({ tabSize: next });
      $("sbSpaces").textContent = "Espacios: " + next;
      toast("Tab size: " + next);
    });
    var sbEol = $("sbEol"); if (sbEol) sbEol.addEventListener("click", function () {
      if (!currentTab()) return;
      var t = currentTab();
      var v = UriEditor.getValue(t.path);
      var eol = v.indexOf("\r\n") >= 0 ? "\n" : "\r\n";
      var nv = v.replace(/\r\n/g, "\n").replace(/\n/g, eol === "\r\n" ? "\r\n" : "\n");
      // simpler: normalize to LF then convert
      nv = v.replace(/\r\n/g, "\n");
      if (eol === "\r\n") nv = nv.replace(/\n/g, "\r\n");
      UriEditor.setValue(t.path, nv);
      t.dirty = true;
      renderTabs();
      toast("EOL: " + (eol === "\r\n" ? "CRLF" : "LF"));
    });
    $("sbPos").onclick = function () { if (currentTab()) openPalette(":"); };
    buildWelcomeActions();
    renderWelcomeRecent();
    bindEdgeSwipes();
    $("menu-backdrop").addEventListener("click", closeMenu);
    $("palette-backdrop").addEventListener("mousedown", function (e) { if (e.target === this) closePalette(); });
    $("paletteInput").addEventListener("input", refreshPalette);
    $("dialog-backdrop").addEventListener("mousedown", function (e) { if (e.target === this) closeDialog("cancel"); });

    $("searchInput").addEventListener("keydown", function (e) { if (e.key === "Enter") runSearch(); });
    $("optCase").onclick = function () { searchOpts.caseSensitive = !searchOpts.caseSensitive; this.classList.toggle("on", searchOpts.caseSensitive); runSearch(); };
    $("optRegex").onclick = function () { searchOpts.regex = !searchOpts.regex; this.classList.toggle("on", searchOpts.regex); runSearch(); };
    var rab = $("replaceAllBtn"); if (rab) rab.onclick = runReplaceAll;

    bindTree();
    bindSettings();
    buildKeybar();
    bindTermGit();
    updateCoarse();

    var mq = window.matchMedia("(max-width: 760px)");
    var onMq = function () {
      document.body.classList.remove("sidebar-open", "sidebar-hidden");
      if (!isNarrow()) { /* escritorio: barra lateral visible */ }
      updateCoarse(); updateActivity();
    };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);

    document.addEventListener("visibilitychange", function () { if (document.hidden) saveAll(true); });
    window.addEventListener("pagehide", function () { saveAll(true); });
  }

  /* ================= Extensiones ================= */
  function setupExtensions() {
    if (!window.UriExtensions) {
      log("Extensions loaded: 0 (unavailable)");
      return;
    }
    try {
      window.UriExtensions.registerHost({
        toast: function (msg, kind) { toast(msg, kind); }
      });
      var n = S.settings.extensionsEnabled ? window.UriExtensions.loadBundled() : 0;
      log("Extensions loaded: " + n);
      if (n) toast(n + " extensión(es) cargada(s)");
    } catch (e) {
      log("Extensions loaded: error (" + String(e && e.message || e) + ")", "error");
    }
  }

  function extensionCommands() {
    if (!window.UriExtensions) return [];
    return window.UriExtensions.getCommands().map(function (c) {
      return { label: "Extensión: " + (c.title || c.id), run: function () { window.UriExtensions.runCommand(c.id); } };
    });
  }

  /* ================= Depuración ================= */
  function setupDebug() {
    if (!window.UriDebug) return;
    try {
      window.UriDebug.renderPanel($("debugPanel"));
    } catch (e) {}
    // Mostrar breakpoints en el margen del editor (espera a que Monaco este listo).
    try {
      if (!window.UriEditor || !window.UriEditor.ready) return;
      window.UriEditor.ready().then(function () {
      var ed = (window.monaco && monaco.editor && monaco.editor.getEditors) ? monaco.editor.getEditors()[0] : null;
      if (ed) {
        var deco = ed.createDecorationsCollection();
        function paint() {
          var model = ed.getModel();
          if (!model) { deco.clear(); return; }
          var mpath = String(model.uri.path || "").replace(/^\/+/, "");
          var bps = window.UriDebug.getBreakpoints().filter(function (b) {
            return String(b.file || "").replace(/^\/+/, "") === mpath;
          });
          deco.set(bps.map(function (b) {
            return {
              range: new monaco.Range(b.line, 1, b.line, 1),
              options: {
                isWholeLine: true,
                glyphMarginClassName: "debug-breakpoint",
                glyphMarginHoverMessage: { value: "Punto de interrupción" },
                className: "debug-breakpoint-line"
              }
            };
          }));
        }
        ed.onDidChangeModel(function () { paint(); });
        window.UriDebug.onEvent(function () { paint(); });
        setInterval(paint, 2000);
        paint();
      }
      });
    } catch (e) {}
  }

  function toggleBreakpoint() {
    if (!currentTab()) { toast("Abre un archivo primero", "error"); return; }
    if (!window.UriDebug) return;
    var c = UriEditor.getCursor ? UriEditor.getCursor() : null;
    var line = (c && c.line) || 1;
    var path = currentTab().path;
    var bps = window.UriDebug.getBreakpoints();
    var exists = bps.some(function (b) { return b.file === path && b.line === line; });
    if (exists) { window.UriDebug.removeBreakpoint(path, line); toast("Breakpoint quitado: línea " + line); }
    else { window.UriDebug.setBreakpoint(path, line); toast("Breakpoint en línea " + line); }
  }

  /* ================= LSP ================= */
  var LSP_LANGS = ["javascript", "typescript", "json"];
  function setupLSP() {
    if (!window.UriLSP) return;
    try {
      // Adaptadores integrados: JS/TS usan el servicio TS de Monaco.
      LSP_LANGS.forEach(function (l) {
        window.UriLSP.registerServer(l, { command: "monaco", args: [] });
        window.UriLSP.connect(l);
      });
      window.UriLSP.onNotification(function (n) { /* punto de extensión para servidores reales */ });
    } catch (e) {}
  }
  function lspStatus() {
    if (!window.UriLSP) { toast("LSP no disponible", "error"); return; }
    var servers = window.UriLSP.getServers();
    var names = Object.keys(servers);
    if (!names.length) { toast("Sin servidores LSP registrados", "info"); return; }
    var conn = names.filter(function (n) { return window.UriLSP.isConnected(n); });
    toast("LSP: " + names.length + " adaptador(es), " + conn.length + " conectado(s)");
  }

  function boot() {
    loadSettings();
    loadKeybindings();
    bindUI();
    log("App start: Uri Code iniciado");
    bindKeys();
    applySettings();
    loadRoots().then(function () { return refreshTree(); });
    setupExtensions();
    setupDebug();
    setupLSP();
    // Tab para saltar entre tab-stops de snippets
    if (window.monaco && monaco.editor && monaco.editor.getEditors) {
      // defer until editor ready
      UriEditor.ready().then(function () {
        var ed = monaco.editor.getEditors()[0];
        if (!ed) return;
        if (typeof ed.onKeyDown !== "function") return;
        ed.onKeyDown(function (e) {
          if (e.keyCode === monaco.KeyCode.Tab && snippetSession) {
            e.preventDefault();
            e.stopPropagation();
            snippetNextTab();
          }
          if (e.keyCode === monaco.KeyCode.Escape && snippetSession) {
            snippetSession = null;
          }
        });
      });
    }
    var vc = $("verCurrent"); if (vc) vc.textContent = APP_VERSION;
    setTimeout(function () { checkUpdate(false); }, 4000);

    Chat.init({
      getSettings: function () { return S.settings; },
      getContext: function () {
        var t = currentTab();
        if (!t) return null;
        return { path: t.path, lang: LANG_NAMES[t.lang] || t.lang, text: UriEditor.getValue(t.path), selection: UriEditor.getSelectedText() };
      },
      insert: function (code) {
        if (!currentTab()) { toast("Abre un archivo para insertar el código", "error"); return; }
        UriEditor.insertAtCursor(code);
        toast("Código insertado");
      },
      replace: function (code) {
        var t = currentTab();
        if (!t) { toast("Abre un archivo para reemplazar su contenido", "error"); return; }
        askConfirm("Reemplazar archivo", "Se reemplazará todo el contenido de «" + baseName(t.path) + "». Podrás deshacerlo con Ctrl+Z.", "Reemplazar").then(function (ok) {
          if (!ok) return;
          UriEditor.replaceAll(t.path, code);
          toast("Archivo reemplazado");
        });
      },
      openSettings: function () { setView("settings", true); },
      toast: toast,
      log: log,
      confirm: askConfirm
    });

    UriEditor.on("change", onEditorChange);
    UriEditor.on("cursor", onCursor);
    UriEditor.on("markers", onMarkers);

    S.view = "explorer";
    document.getElementById("view-explorer").classList.add("active");
    if (isNarrow()) document.body.classList.remove("sidebar-open");
    updateActivity();

    // Restaurar carpetas abiertas y mostrar el árbol enseguida
    var ses = null;
    try { ses = JSON.parse(localStorage.getItem("uri.session")); } catch (e) {}
    if (ses && ses.expanded) ses.expanded.forEach(function (p) { S.expanded[p] = true; });
    refreshTree().catch(function (e) { toast("Error cargando proyectos: " + e, "error"); });

    UriEditor.init($("editor-root"), {
      fontSize: S.settings.fontSize,
      wordWrap: S.settings.wordWrap,
      minimap: S.settings.minimap,
      minimapSide: S.settings.minimapSide,
      tabSize: S.settings.tabSize,
      insertSpaces: S.settings.insertSpaces,
      renderWhitespace: S.settings.renderWhitespace,
      cursorBlink: S.settings.cursorBlink,
      smoothScrolling: S.settings.smoothScrolling
    }).then(function (mode) {
      log("Editor mode: " + (mode === "fallback" ? "fallback" : "monaco"));
      $("welcomeLoading").classList.add("hidden");
      if (mode === "fallback") toast("Sin conexión: usando el editor básico (sin resaltado). Reinicia con internet para cargar Monaco.");
      return restoreSession();
    }).catch(function (e) {
      log("Editor mode: error (" + String(e && e.message || e) + ")", "error");
    });
  }

  window.UriGit = {
    parseStatus: parseGitStatus,
    parseBranches: parseGitBranches
  };

  window.UriCodePanels = {
    refreshProblems: refreshProblems,
    onMarkers: onMarkers,
    getProblems: function () { return S.problemMarkers.slice(); },
    refreshGit: refreshGit,
    getGitEntries: function () { return gitEntries.slice(); },
    log: log,
    showProblems: showProblems,
    setView: setView
  };

  window.UriCodeSettings = {
    getDefinitions: function () { return SETTINGS.map(function (setting) { return Object.assign({}, setting); }); },
    filter: filterSettings,
    getKeybindings: function () { return S.registeredKeybindings.map(function (binding) { return Object.assign({}, binding); }); },
    setKeybinding: setKeybinding,
    resetKeybindings: resetKeybindings,
    render: renderSettings
  };

  boot();
})();
