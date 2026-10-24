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
  var DEFAULTS = { fontSize: 14, wordWrap: true, minimap: null, autoSave: true, nimKey: "", nimModel: "meta/llama-3.1-8b-instruct", snippets: "" };
  var APP_VERSION = "3.0.0";
  var UPDATE_REPO = "jbstudios31/uricode";

  var S = {
    settings: Object.assign({}, DEFAULTS),
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
    searchToken: 0
  };

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem("uri.settings")) || {}; } catch (e) {}
    S.settings = Object.assign({}, DEFAULTS, s);
    if (S.settings.minimap === null) S.settings.minimap = !isNarrow();
  }
  function saveSettings() {
    try { localStorage.setItem("uri.settings", JSON.stringify(S.settings)); } catch (e) {}
  }

  /* ================= Avisos, diálogos y menús ================= */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "show" + (kind === "error" ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ""; }, 2600);
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
    if (isNarrow()) document.body.classList.toggle("sidebar-open", v);
    else document.body.classList.toggle("sidebar-hidden", !v);
    updateActivity();
  }
  function updateActivity() {
    var vis = sidebarVisible();
    document.querySelectorAll(".ab-item").forEach(function (b) {
      b.classList.toggle("active", vis && b.getAttribute("data-view") === S.view);
    });
  }
  function setView(name, focusInput) {
    if (S.view === name && sidebarVisible() && !focusInput) { showSidebar(false); return; }
    S.view = name;
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    showSidebar(true);
    if (name === "search") setTimeout(function () { $("searchInput").focus(); $("searchInput").select(); }, 50);
    if (name === "ai" && !isCoarse()) setTimeout(function () { Chat.focus(); }, 50);
    if (name === "settings") refreshSettingsUI();
  }
  function closeSidebarIfNarrow() { if (isNarrow()) showSidebar(false); }

  /* ================= Explorador ================= */
  function targetDir() {
    if (S.selectedType === "dir") return S.selected;
    return dirName(S.selected);
  }

  function loadDirs() {
    var paths = [""].concat(Object.keys(S.expanded));
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

  function renderTree() {
    var tree = $("tree");
    var rows = [];
    (function walk(path, depth) {
      (S.dirCache[path] || []).forEach(function (it) {
        rows.push(rowEl(it, depth));
        if (it.type === "dir" && S.expanded[it.path]) walk(it.path, depth + 1);
      });
    })("", 0);

    tree.innerHTML = "";
    if (!rows.length) {
      tree.innerHTML = '<div class="empty-note">Todavía no tienes archivos.' +
        '<button id="emptyNewFile">Nuevo archivo</button>' +
        '<button id="emptyNewDir" class="secondary">Nueva carpeta</button></div>';
      $("emptyNewFile").onclick = function () { newItem("file"); };
      $("emptyNewDir").onclick = function () { newItem("dir"); };
      return;
    }
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(r); });
    tree.appendChild(frag);
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
    var jobs = [];
    for (var i = 0; i < parts.length - 1; i++) {
      acc = join(acc, parts[i]);
      S.expanded[acc] = true;
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

  function deleteItem(path, type) {
    var what = type === "dir" ? "la carpeta «" + baseName(path) + "» y todo su contenido" : "«" + baseName(path) + "»";
    return askConfirm("Eliminar", "¿Seguro que quieres eliminar " + what + "? Esta acción no se puede deshacer.", "Eliminar").then(function (ok) {
      if (!ok) return;
      return API.deleteItem(path).then(function (done) {
        if (!done) { toast("No se pudo eliminar", "error"); return; }
        var doomed = S.tabs.filter(function (t) { return t.path === path || t.path.indexOf(path + "/") === 0; });
        var closeChain = Promise.resolve();
        doomed.forEach(function (t) { closeChain = closeChain.then(function () { return closeTabByPath(t.path); }); });
        return closeChain.then(function () {
          Object.keys(S.expanded).forEach(function (k) { if (k === path || k.indexOf(path + "/") === 0) delete S.expanded[k]; });
          if (S.selected === path || S.selected.indexOf(path + "/") === 0) selectPath("", "dir");
          S.dirCache = {};
          return refreshTree().then(function () { persistSession(); toast("Eliminado"); });
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
    var ver = UriEditor.getVersion(t.path);
    var text = UriEditor.getValue(t.path);
    return API.writeFile(t.path, text).then(function (ok) {
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
    });
  }

  /* ================= Barra de estado ================= */
  function onCursor(c) {
    $("sbPos").textContent = "Ln " + c.line + ", Col " + c.col + (c.selected ? " (" + c.selected + " seleccionados)" : "");
    $("sbSpaces").textContent = "Espacios: " + c.tabSize;
    $("sbEol").textContent = c.eol;
  }
  function onMarkers(m) {
    $("sbErrCount").textContent = m.errors;
    $("sbWarnCount").textContent = m.warnings;
  }

  /* ================= Lista de archivos (Ir a archivo / búsqueda) ================= */
  var SKIP_DIRS = { "node_modules": 1, ".git": 1 };

  function allFiles() {
    if (S.fileListCache) return Promise.resolve(S.fileListCache);
    if (S.fileListPromise) return S.fileListPromise;
    var out = [], gen = (S.fileListGen = (S.fileListGen || 0) + 1), myGen = gen;
    function walk(path) {
      return API.listDir(path).then(function (items) {
        items = items || [];
        var chain = Promise.resolve();
        items.forEach(function (it) {
          if (it.type === "file") out.push(it);
          else if (!SKIP_DIRS[it.name] && out.length < 8000) chain = chain.then(function () { return walk(it.path); });
        });
        return chain;
      }).catch(function () { return null; });
    }
    S.fileListPromise = walk("").then(function () {
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
      var list = COMMANDS.map(function (c) { return { cmd: c, score: q ? fuzzyScore(q, c.label) : 0 }; })
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

  var COMMANDS = [
    { label: "Archivo: Nuevo archivo", key: "Ctrl+N", run: function () { newItem("file"); } },
    { label: "Archivo: Nueva carpeta", run: function () { newItem("dir"); } },
    { label: "Archivo: Importar archivos…", run: importFiles },
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
  function getRecent() {
    try { var r = JSON.parse(localStorage.getItem("uri.recent")); return Array.isArray(r) ? r : []; } catch (e) { return []; }
  }
  function setRecent(r) { try { localStorage.setItem("uri.recent", JSON.stringify(r.slice(0, 6))); } catch (e) {} }
  function pushRecent(path) {
    var r = getRecent().filter(function (p) { return p !== path; });
    r.unshift(path); setRecent(r);
  }
  function removeRecent(path) { setRecent(getRecent().filter(function (p) { return p !== path; })); }
  function renderWelcomeRecent() {
    var box = $("welcomeRecent");
    var list = getRecent();
    box.innerHTML = "";
    if (!list.length) return;
    var title = document.createElement("div");
    title.className = "wr-title"; title.textContent = "Recientes";
    box.appendChild(title);
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
      UriEditor.insertAtCursor(String(code));
      toast("Snippet insertado");
    });
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
        if (!latest) { if (status) status.textContent = "No se pudo obtener la versión."; return; }
        if (cmpVer(latest, APP_VERSION) > 0) {
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
          if (status) status.textContent = "Ya tienes la última versión (" + APP_VERSION + ").";
          if (manual) toast("Ya tienes la última versión");
        }
      })
      .catch(function () {
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
        { label: "Guardar", hint: "Ctrl+S", disabled: !has, run: saveCurrent },
        { label: "Guardar todo", disabled: !has, run: function () { saveAll(false); } },
        { label: "Cerrar editor", hint: "Ctrl+W", disabled: !has, run: function () { if (S.active >= 0) closeTab(S.active); } },
        { label: "Cerrar todos los editores", disabled: !has, run: closeAllTabs }
      ],
      edit: [
        { label: "Deshacer", hint: "Ctrl+Z", disabled: !has, run: function () { UriEditor.undo(); } },
        { label: "Rehacer", hint: "Ctrl+Y", disabled: !has, run: function () { UriEditor.redo(); } },
        { separator: true },
        { label: "Buscar", hint: "Ctrl+F", disabled: !has, run: act("actions.find") },
        { label: "Reemplazar", hint: "Ctrl+H", disabled: !has, run: act("editor.action.startFindReplace") },
        { label: "Buscar en archivos", hint: "Ctrl+Shift+F", run: function () { setView("search", true); } },
        { separator: true },
        { label: "Alternar comentario de línea", hint: "Ctrl+/", disabled: !has, run: act("editor.action.commentLine") },
        { label: "Formatear documento", disabled: !has, run: act("editor.action.formatDocument") },
        { label: "Ir a símbolo", disabled: !has, run: act("editor.action.quickOutline") },
        { label: "Insertar snippet…", disabled: !has, run: insertSnippet }
      ],
      view: [
        { label: "Paleta de comandos…", hint: "Ctrl+Shift+P", run: function () { openPalette(">"); } },
        { separator: true },
        { label: "Explorador", hint: "Ctrl+Shift+E", run: function () { setView("explorer", true); } },
        { label: "Buscar", run: function () { setView("search", true); } },
        { label: "Chat IA", run: function () { setView("ai", true); } },
        { label: "Ajustes", hint: "Ctrl+,", run: function () { setView("settings", true); } },
        { separator: true },
        { label: "Alternar barra lateral", hint: "Ctrl+B", run: function () { showSidebar(!sidebarVisible()); } },
        { label: (S.settings.wordWrap ? "✓ " : "") + "Ajuste de línea", run: function () { S.settings.wordWrap = !S.settings.wordWrap; saveSettings(); applySettings(); } },
        { label: (S.settings.minimap ? "✓ " : "") + "Minimapa", run: function () { S.settings.minimap = !S.settings.minimap; saveSettings(); applySettings(); } },
        { label: "Aumentar fuente", run: function () { changeFont(1); } },
        { label: "Reducir fuente", run: function () { changeFont(-1); } }
      ],
      go: [
        { label: "Ir a archivo…", hint: "Ctrl+P", run: function () { openPalette(""); } },
        { label: "Ir a línea…", hint: "Ctrl+G", disabled: !has, run: function () { openPalette(":"); } },
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
    var lines = ["Ir a archivo\t\tCtrl+P", "Paleta de comandos\tCtrl+Shift+P", "Guardar\t\t\tCtrl+S", "Nuevo archivo\t\tCtrl+N",
      "Cerrar editor\t\tCtrl+W", "Barra lateral\t\tCtrl+B", "Buscar en archivos\tCtrl+Shift+F", "Ir a línea\t\tCtrl+G",
      "Siguiente / anterior\tCtrl+PgDn / PgUp"];
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
  function applySettings() {
    UriEditor.applyOptions({ fontSize: S.settings.fontSize, wordWrap: S.settings.wordWrap, minimap: S.settings.minimap });
    refreshSettingsUI();
    Chat.refresh();
  }

  function refreshSettingsUI() {
    $("fontVal").textContent = S.settings.fontSize;
    $("setWrap").checked = !!S.settings.wordWrap;
    $("setMinimap").checked = !!S.settings.minimap;
    $("setAutosave").checked = !!S.settings.autoSave;
    if (document.activeElement !== $("setKey")) $("setKey").value = S.settings.nimKey || "";
    if (document.activeElement !== $("setModel")) $("setModel").value = S.settings.nimModel || "";
    if (document.activeElement !== $("setSnippets")) $("setSnippets").value = S.settings.snippets || "";
  }

  function getSnippets() {
    var s = S.settings.snippets || "";
    try { var o = JSON.parse(s); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; }
  }

  function bindSettings() {
    $("fontMinus").onclick = function () { changeFont(-1); };
    $("fontPlus").onclick = function () { changeFont(1); };
    $("setWrap").onchange = function (e) { S.settings.wordWrap = e.target.checked; saveSettings(); applySettings(); };
    $("setMinimap").onchange = function (e) { S.settings.minimap = e.target.checked; saveSettings(); applySettings(); };
    $("setAutosave").onchange = function (e) { S.settings.autoSave = e.target.checked; saveSettings(); if (!S.settings.autoSave) { clearTimeout(S.autoTimer); S.autoTimer = null; } };
    $("setKey").oninput = function (e) { S.settings.nimKey = e.target.value.trim(); saveSettings(); };
    $("setModel").oninput = function (e) {
      S.settings.nimModel = e.target.value.trim() || DEFAULTS.nimModel; saveSettings(); Chat.refresh();
    };
    $("setSnippets").oninput = function (e) { S.settings.snippets = e.target.value; saveSettings(); };
    var cu = $("checkUpdate");
    if (cu) cu.onclick = function () { checkUpdate(true); };
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

  function bindTermGit() {
    function runTerm() {
      var cmd = ($("termCmd").value || "").trim();
      var cwd = ($("termCwd").value || "").trim();
      if (!cmd) return;
      $("termOut").textContent = "Ejecutando…";
      API.runCommand(cmd, cwd).then(function (r) {
        var out = (r.stdout || "") + (r.stderr ? "\n[stderr]\n" + r.stderr : "");
        $("termOut").textContent = (out.trim() ? out : "(sin salida)") + "\n[código " + r.code + "]";
      });
    }
    $("termRun").addEventListener("click", runTerm);
    $("termCmd").addEventListener("keydown", function (e) { if (e.key === "Enter") runTerm(); });

    function showGit(r) { $("gitOut").textContent = (r.stdout || "") + (r.stderr ? "\n[stderr]\n" + r.stderr : "") || "(sin salida)"; }
    $("gitStatus").addEventListener("click", function () {
      $("gitOut").textContent = "Ejecutando…";
      API.runCommand("git status", ($("termCwd").value || "").trim()).then(showGit);
    });
    $("gitLog").addEventListener("click", function () {
      $("gitOut").textContent = "Ejecutando…";
      API.runCommand("git log --oneline -20", ($("termCwd").value || "").trim()).then(showGit);
    });
    $("gitDiff").addEventListener("click", function () {
      $("gitOut").textContent = "Ejecutando…";
      API.runCommand("git diff", ($("termCwd").value || "").trim()).then(showGit);
    });
    $("gitCommit").addEventListener("click", function () {
      var msg = ($("gitMsg").value || "").trim();
      if (!msg) { toast("Escribe un mensaje de commit", "error"); return; }
      $("gitOut").textContent = "Ejecutando…";
      var cwd = ($("termCwd").value || "").trim();
      API.runCommand("git add -A && git commit -m " + JSON.stringify(msg), cwd).then(function (r) {
        showGit(r);
        if (r.code === 0) toast("Commit realizado");
      });
    });
    $("gitPull").addEventListener("click", function () {
      $("gitOut").textContent = "Ejecutando…";
      API.runCommand("git pull", ($("termCwd").value || "").trim()).then(showGit);
    });
    $("gitPush").addEventListener("click", function () {
      $("gitOut").textContent = "Ejecutando…";
      API.runCommand("git push", ($("termCwd").value || "").trim()).then(showGit);
    });
  }

  function updateCoarse() { document.body.classList.toggle("coarse", isCoarse() || isNarrow()); }

  /* ================= Atajos de teclado ================= */
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
      if (e.key === "F1") { e.preventDefault(); openPalette(">"); return; }
      if (!ctrl) return;
      if (e.key === "PageDown") { e.preventDefault(); cycleTab(1); return; }
      if (e.key === "PageUp") { e.preventDefault(); cycleTab(-1); return; }
      if (k === "s") { e.preventDefault(); saveCurrent(); }
      else if (k === "p" && e.shiftKey) { e.preventDefault(); openPalette(">"); }
      else if (k === "p") { e.preventDefault(); openPalette(""); }
      else if (k === "b") { e.preventDefault(); showSidebar(!sidebarVisible()); }
      else if (k === "w") { e.preventDefault(); if (S.active >= 0) closeTab(S.active); }
      else if (k === "n") { e.preventDefault(); newItem("file"); }
      else if (k === "f" && e.shiftKey) { e.preventDefault(); setView("search", true); }
      else if (k === "e" && e.shiftKey) { e.preventDefault(); setView("explorer", true); }
      else if (k === "g" && !e.shiftKey) { e.preventDefault(); openPalette(":"); }
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
    $("sbPos").onclick = function () { if (currentTab()) openPalette(":"); };
    $("wNewFile").onclick = function () { newItem("file"); };
    $("wOpen").onclick = function () { openPalette(""); };
    $("wPalette").onclick = function () { openPalette(">"); };
    $("menu-backdrop").addEventListener("click", closeMenu);
    $("palette-backdrop").addEventListener("mousedown", function (e) { if (e.target === this) closePalette(); });
    $("paletteInput").addEventListener("input", refreshPalette);
    $("dialog-backdrop").addEventListener("mousedown", function (e) { if (e.target === this) closeDialog("cancel"); });

    $("searchInput").addEventListener("keydown", function (e) { if (e.key === "Enter") runSearch(); });
    $("optCase").onclick = function () { searchOpts.caseSensitive = !searchOpts.caseSensitive; this.classList.toggle("on", searchOpts.caseSensitive); runSearch(); };
    $("optRegex").onclick = function () { searchOpts.regex = !searchOpts.regex; this.classList.toggle("on", searchOpts.regex); runSearch(); };

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

  function boot() {
    loadSettings();
    bindUI();
    bindKeys();
    refreshSettingsUI();
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
      fontSize: S.settings.fontSize, wordWrap: S.settings.wordWrap, minimap: S.settings.minimap
    }).then(function (mode) {
      $("welcomeLoading").classList.add("hidden");
      if (mode === "fallback") toast("Sin conexión: usando el editor básico (sin resaltado). Reinicia con internet para cargar Monaco.");
      return restoreSession();
    }).catch(function () {});
  }

  boot();
})();
