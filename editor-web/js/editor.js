/* Envoltorio de Monaco (el motor de VS Code). Si no hay conexión usa un editor de texto básico. */
(function () {
  "use strict";

  var CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min";

  var mon = null;          // API global de Monaco
  var editor = null;       // instancia de Monaco
  var mode = "none";       // "monaco" | "fallback" | "none"
  var host = null;
  var currentPath = null;
  var models = {};         // ruta -> model (Monaco)
  var viewStates = {};     // ruta -> estado de vista (cursor, scroll)
  var fb = null;           // textarea del modo básico
  var fbDocs = {};         // ruta -> {value, selStart, selEnd, scroll}
  var cb = {};
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });
  var options = { fontSize: 14, wordWrap: true, minimap: false };

  function emit(name, arg) { if (typeof cb[name] === "function") { try { cb[name](arg); } catch (e) {} } }
  function on(name, fn) { cb[name] = fn; }

  function loadScript(src, ms) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      s.src = src;
      s.onload = function () { clearTimeout(t); resolve(); };
      s.onerror = function () { clearTimeout(t); reject(new Error("load")); };
      document.head.appendChild(s);
    });
  }

  function isCoarse() { return window.matchMedia("(pointer: coarse)").matches; }

  function loadScript2(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }

  function setupPrettier() {
    if (!mon) return;
    var base = "https://cdn.jsdelivr.net/npm/prettier@3.3.3";
    var plugins = [];
    var langs = {
      javascript: "babel", typescript: "typescript", json: "json",
      html: "html", css: "css", scss: "css", less: "css",
      markdown: "markdown", yaml: "yaml", graphql: "graphql"
    };
    function register() {
      if (!window.prettier) return;
      Object.keys(langs).forEach(function (lang) {
        var parser = langs[lang];
        mon.languages.registerDocumentFormattingEditProvider(lang, {
          provideDocumentFormattingEdits: function (model) {
            try {
              var code = model.getValue();
              var out = window.prettier.format(code, { parser: parser, plugins: plugins, semi: true, singleQuote: false });
              if (out === code) return [];
              var last = model.getLineCount();
              var lastCol = model.getLineMaxColumn(last);
              return [{ range: new mon.Range(1, 1, last, lastCol), text: out }];
            } catch (e) { return []; }
          }
        });
      });
    }
    loadScript2(base + "/standalone.js").then(function () {
      return Promise.all([
        loadScript2(base + "/plugins/babel.js").catch(function () {}),
        loadScript2(base + "/plugins/typescript.js").catch(function () {}),
        loadScript2(base + "/plugins/html.js").catch(function () {}),
        loadScript2(base + "/plugins/postcss.js").catch(function () {}),
        loadScript2(base + "/plugins/markdown.js").catch(function () {}),
        loadScript2(base + "/plugins/yaml.js").catch(function () {}),
        loadScript2(base + "/plugins/graphql.js").catch(function () {})
      ]);
    }).then(function () {
      if (window.prettier && window.prettier.plugins) {
        plugins = Object.keys(window.prettier.plugins).map(function (k) { return window.prettier.plugins[k]; });
      } else {
        plugins = [window.prettierPluginBabel, window.prettierPluginTypescript, window.prettierPluginHtml,
          window.prettierPluginPostcss, window.prettierPluginMarkdown, window.prettierPluginYaml,
          window.prettierPluginGraphql].filter(Boolean);
      }
      register();
    }).catch(function () { /* prettier no disponible offline */ });
  }

  /* ---------------- Inicio ---------------- */
  function init(container, opts) {
    host = container;
    if (opts) for (var k in opts) options[k] = opts[k];

    return loadMonaco().then(function () {
      mode = "monaco";
    }).catch(function () {
      startFallback();
      mode = "fallback";
    }).then(function () {
      readyResolve(mode);
      return mode;
    });
  }

  function loadMonaco() {
    window.MonacoEnvironment = {
      getWorkerUrl: function () {
        return "data:text/javascript;charset=utf-8," + encodeURIComponent(
          "self.MonacoEnvironment={baseUrl:'" + CDN + "/'};importScripts('" + CDN + "/vs/base/worker/workerMain.js');");
      }
    };
    return loadScript(CDN + "/vs/loader.js", 15000).then(function () {
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error("timeout")); }, 30000);
        window.require.config({ paths: { vs: CDN + "/vs" } });
        window.require(["vs/editor/editor.main"], function () { clearTimeout(t); resolve(); },
          function (e) { clearTimeout(t); reject(e); });
      });
    }).then(function () {
      mon = window.monaco;
      mon.editor.defineTheme("uri-dark", {
        base: "vs-dark", inherit: true, rules: [],
        colors: {
          "editor.background": "#1e1e1e",
          "editor.foreground": "#d4d4d4",
          "editorLineNumber.foreground": "#858585",
          "editorLineNumber.activeForeground": "#c6c6c6",
          "editor.selectionBackground": "#264f78",
          "editor.inactiveSelectionBackground": "#3a3d41",
          "editor.lineHighlightBackground": "#ffffff0a",
          "editor.lineHighlightBorder": "#00000000",
          "editorCursor.foreground": "#aeafad",
          "editorWhitespace.foreground": "#404040",
          "editorIndentGuide.background1": "#404040",
          "editorIndentGuide.activeBackground1": "#707070",
          "minimap.background": "#1e1e1e"
        }
      });
      editor = mon.editor.create(host, {
        model: null,
        theme: "uri-dark",
        automaticLayout: true,
        fontSize: options.fontSize,
        fontFamily: "Consolas, 'Roboto Mono', 'Droid Sans Mono', 'Courier New', monospace",
        wordWrap: options.wordWrap ? "on" : "off",
        minimap: { enabled: !!options.minimap },
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: true,
        fixedOverflowWidgets: true,
        smoothScrolling: true,
        cursorBlinking: "blink",
        padding: { top: 4 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        accessibilitySupport: "off",
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: "on",
        tabCompletion: "on",
        wordBasedSuggestions: "allDocuments",
        snippetSuggestions: "top",
        parameterHints: { enabled: true },
        suggest: {
          showWords: true, showSnippets: true, showFunctions: true, showVariables: true,
          showClasses: true, showModules: true, showProperties: true, showMethods: true,
          filterGraceful: true, localityBonus: true
        },
        autoClosingBrackets: "always",
        autoClosingQuotes: "always",
        formatOnType: true,
        formatOnPaste: true
      });

      // Configurar IntelliSense para JS/TS
      try {
        if (mon.languages && mon.languages.typescript) {
          var jsDefaults = mon.languages.typescript.javascriptDefaults;
          var tsDefaults = mon.languages.typescript.typescriptDefaults;
          [jsDefaults, tsDefaults].forEach(function (d) {
            d.setCompilerOptions({
              target: mon.languages.typescript.ScriptTarget.ES2020,
              allowNonTsExtensions: true,
              moduleResolution: mon.languages.typescript.ModuleResolutionKind.NodeJs,
              module: mon.languages.typescript.ModuleKind.CommonJS,
              noEmit: true,
              esModuleInterop: true,
              allowJs: true,
              checkJs: false
            });
            d.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
            d.setEagerModelSync(true);
          });
        }
      } catch (e) {}

      editor.onDidChangeCursorSelection(function () { emitCursor(); });
      mon.editor.onDidChangeMarkers(function () {
        var errors = 0, warnings = 0;
        mon.editor.getModelMarkers({}).forEach(function (m) {
          if (m.severity === 8) errors++; else if (m.severity === 4) warnings++;
        });
        emit("markers", { errors: errors, warnings: warnings });
      });
      setupPrettier();
    });
  }

  function emitCursor() {
    if (mode === "monaco" && editor && editor.getModel()) {
      var m = editor.getModel(), pos = editor.getPosition(), sel = editor.getSelection();
      var selected = sel && !sel.isEmpty() ? m.getValueInRange(sel).length : 0;
      emit("cursor", {
        line: pos.lineNumber, col: pos.column, selected: selected,
        tabSize: m.getOptions().tabSize, eol: m.getEOL() === "\r\n" ? "CRLF" : "LF"
      });
    } else if (mode === "fallback" && fb && currentPath) {
      var v = fb.value, s = fb.selectionStart, before = v.slice(0, s);
      var line = before.split("\n").length;
      emit("cursor", {
        line: line, col: s - before.lastIndexOf("\n"), selected: Math.abs(fb.selectionEnd - fb.selectionStart),
        tabSize: 2, eol: v.indexOf("\r\n") >= 0 ? "CRLF" : "LF"
      });
    }
  }

  /* ---------------- Modo básico (sin conexión) ---------------- */
  function startFallback() {
    fb = document.createElement("textarea");
    fb.className = "fallback-editor";
    fb.spellcheck = false;
    fb.setAttribute("autocapitalize", "off");
    fb.setAttribute("autocomplete", "off");
    fb.wrap = options.wordWrap ? "soft" : "off";
    fb.style.fontSize = options.fontSize + "px";
    fb.style.display = "none";
    host.appendChild(fb);
    fb.addEventListener("input", function () {
      if (!currentPath) return;
      var d = fbDocs[currentPath];
      if (!d) return;
      d.value = fb.value;
      emit("change", currentPath);
      emitCursor();
    });
    fb.addEventListener("keyup", emitCursor);
    fb.addEventListener("click", emitCursor);
    fb.addEventListener("select", emitCursor);
    fb.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        insertInTextarea("  ");
      }
    });
  }

  function insertInTextarea(text) {
    if (!fb) return;
    var s = fb.selectionStart, e = fb.selectionEnd;
    fb.value = fb.value.slice(0, s) + text + fb.value.slice(e);
    fb.selectionStart = fb.selectionEnd = s + text.length;
    fb.dispatchEvent(new Event("input"));
  }

  /* ---------------- Documentos ---------------- */
  function uriFor(path) { return mon.Uri.from({ scheme: "file", path: "/" + path }); }

  /* Crea el documento si no existe y devuelve su "versión" (para detectar cambios sin guardar). */
  function ensure(path, content, lang) {
    if (mode === "monaco") {
      if (!models[path]) {
        var uri = uriFor(path);
        var old = mon.editor.getModel(uri);
        if (old) {
          if (editor && editor.getModel() === old) editor.setModel(null);
          old.dispose();
        }
        var model = mon.editor.createModel(content, lang, uri);
        model.__path = path;
        model.__disposable = model.onDidChangeContent(function () { emit("change", model.__path); });
        models[path] = model;
      } else {
        // actualizar contenido/lenguaje si el modelo ya existia y no esta sucio
        try { if (models[path].getValue() !== content) models[path].setValue(content); } catch (e) {}
        try { mon.editor.setModelLanguage(models[path], lang); } catch (e) {}
      }
    } else if (mode === "fallback") {
      if (!fbDocs[path]) fbDocs[path] = { value: content, selStart: 0, selEnd: 0, scroll: 0 };
      else if (currentPath !== path) fbDocs[path].value = content;
    }
    return getVersion(path);
  }

  function show(path, focus) {
    if (mode === "monaco") {
      if (currentPath && models[currentPath] && (editor.getModel() === models[currentPath] || editor.getModel() === null)) {
        try { viewStates[currentPath] = editor.saveViewState(); } catch (e) {}
      }
      var model = models[path];
      if (!model) { emitCursor(); return; }
      editor.setModel(model);
      if (viewStates[path]) editor.restoreViewState(viewStates[path]);
      currentPath = path;
      if (focus !== false && !isCoarse()) editor.focus();
    } else if (mode === "fallback") {
      if (currentPath && fbDocs[currentPath]) {
        var o = fbDocs[currentPath];
        o.value = fb.value; o.selStart = fb.selectionStart; o.selEnd = fb.selectionEnd; o.scroll = fb.scrollTop;
      }
      var d = fbDocs[path];
      if (!d) { emitCursor(); return; }
      fb.style.display = "block";
      fb.value = d.value;
      fb.selectionStart = d.selStart; fb.selectionEnd = d.selEnd; fb.scrollTop = d.scroll;
      currentPath = path;
      if (focus !== false && !isCoarse()) fb.focus();
    }
    emitCursor();
  }

  function closeModel(path) {
    if (mode === "monaco") {
      var m = models[path];
      if (m) {
        if (editor && editor.getModel() === m) editor.setModel(null);
        if (currentPath === path) currentPath = null;
        m.dispose();
        delete models[path];
        delete viewStates[path];
      }
    } else if (mode === "fallback") {
      delete fbDocs[path];
      if (currentPath === path) { currentPath = null; if (fb) { fb.value = ""; fb.style.display = "none"; } }
    }
  }

  /* Cambia la ruta de un documento (o de todos los que cuelgan de una carpeta). */
  function renamePath(oldP, newP, langOf) {
    var keys = Object.keys(mode === "monaco" ? models : fbDocs);
    keys.forEach(function (p) {
      if (p !== oldP && p.indexOf(oldP + "/") !== 0) return;
      var np = newP + p.slice(oldP.length);
      var wasCurrent = currentPath === p;
      if (mode === "monaco") {
        var m = models[p];
        if (!m) return;
        var text = m.getValue();
        var vs = null;
        if (wasCurrent && editor && editor.getModel() === m) { try { vs = editor.saveViewState(); } catch (e) {} }
        if (wasCurrent) { editor.setModel(null); currentPath = null; }
        if (m.__disposable) { try { m.__disposable.dispose(); } catch (e) {} }
        m.dispose(); delete models[p]; delete viewStates[p];
        // avoid collision with an existing model at np
        if (models[np]) { try { models[np].dispose(); } catch (e) {} delete models[np]; delete viewStates[np]; }
        ensure(np, text, langOf(np));
        if (vs) viewStates[np] = vs;
        if (wasCurrent) show(np, false);
      } else {
        var d = fbDocs[p];
        if (!d) return;
        if (wasCurrent && fb) d.value = fb.value;
        delete fbDocs[p];
        fbDocs[np] = d;
        if (wasCurrent) currentPath = np;
      }
    });
  }

  function setLanguage(path, lang) {
    if (mode === "monaco" && models[path]) mon.editor.setModelLanguage(models[path], lang);
  }

  function getValue(path) {
    if (mode === "monaco") return models[path] ? models[path].getValue() : "";
    if (mode === "fallback") {
      if (path === currentPath && fb) return fb.value;
      return fbDocs[path] ? fbDocs[path].value : "";
    }
    return "";
  }

  function getVersion(path) {
    if (mode === "monaco") return models[path] ? models[path].getAlternativeVersionId() : -1;
    if (mode === "fallback") return getValue(path);
    return -1;
  }

  /* ---------------- Operaciones sobre el editor ---------------- */
  function focus() {
    if (mode === "monaco" && editor) editor.focus();
    else if (mode === "fallback" && fb) fb.focus();
  }

  function insertAtCursor(text) {
    if (mode === "monaco" && editor && editor.getModel()) {
      editor.pushUndoStop();
      editor.executeEdits("uri-ai", [{ range: editor.getSelection(), text: text, forceMoveMarkers: true }]);
      editor.pushUndoStop();
    } else if (mode === "fallback" && fb && currentPath) {
      insertInTextarea(text);
    }
  }

  function replaceAll(path, text) {
    if (mode === "monaco" && models[path]) {
      var m = models[path];
      if (editor.getModel() === m) {
        editor.pushUndoStop();
        editor.executeEdits("uri-ai", [{ range: m.getFullModelRange(), text: text }]);
        editor.pushUndoStop();
      } else {
        m.setValue(text);
      }
    } else if (mode === "fallback" && fbDocs[path]) {
      fbDocs[path].value = text;
      if (path === currentPath) { fb.value = text; fb.dispatchEvent(new Event("input")); }
      else emit("change", path);
    }
  }

  function getSelectedText() {
    if (mode === "monaco" && editor && editor.getModel()) {
      var s = editor.getSelection();
      return s && !s.isEmpty() ? editor.getModel().getValueInRange(s) : "";
    }
    if (mode === "fallback" && fb) return fb.value.slice(fb.selectionStart, fb.selectionEnd);
    return "";
  }

  function gotoLine(line, col, len) {
    col = col || 1;
    if (mode === "monaco" && editor && editor.getModel()) {
      var max = editor.getModel().getLineCount();
      line = Math.max(1, Math.min(line, max));
      editor.revealLineInCenter(line);
      if (len) editor.setSelection(new mon.Selection(line, col, line, col + len));
      else editor.setPosition({ lineNumber: line, column: col });
      if (!isCoarse()) editor.focus();
    } else if (mode === "fallback" && fb) {
      var lines = fb.value.split("\n"), idx = 0;
      for (var i = 0; i < line - 1 && i < lines.length; i++) idx += lines[i].length + 1;
      fb.selectionStart = idx + col - 1;
      fb.selectionEnd = idx + col - 1 + (len || 0);
      fb.focus();
      var lh = parseFloat(getComputedStyle(fb).lineHeight) || 20;
      fb.scrollTop = Math.max(0, (line - 5) * lh);
    }
  }

  /* Teclas para la barra extra de móvil */
  function typeText(text) {
    if (mode === "monaco" && editor && editor.getModel()) {
      editor.focus();
      editor.trigger("keyboard", "type", { text: text });
    } else if (mode === "fallback" && fb) { fb.focus(); insertInTextarea(text); }
  }
  function pressTab() {
    if (mode === "monaco" && editor && editor.getModel()) { editor.focus(); editor.trigger("keyboard", "tab", null); }
    else if (mode === "fallback" && fb) { insertInTextarea("  "); }
  }
  function undo() { if (mode === "monaco" && editor) { editor.focus(); editor.trigger("keyboard", "undo", null); } }
  function redo() { if (mode === "monaco" && editor) { editor.focus(); editor.trigger("keyboard", "redo", null); } }

  /* Ejecuta una acción integrada de Monaco (buscar, ir a línea, formatear, etc.) */
  function action(id) {
    if (mode === "monaco" && editor && editor.getModel()) {
      editor.focus();
      var a = editor.getAction(id);
      if (a) a.run(); else editor.trigger("uri", id, null);
      return true;
    }
    return false;
  }

  function applyOptions(o) {
    for (var k in o) options[k] = o[k];
    if (mode === "monaco" && editor) {
      editor.updateOptions({
        fontSize: options.fontSize,
        wordWrap: options.wordWrap ? "on" : "off",
        minimap: { enabled: !!options.minimap }
      });
    } else if (mode === "fallback" && fb) {
      fb.style.fontSize = options.fontSize + "px";
      fb.wrap = options.wordWrap ? "soft" : "off";
    }
  }

  window.UriEditor = {
    init: init, on: on, ready: function () { return readyPromise; },
    mode: function () { return mode; },
    ensure: ensure, show: show, closeModel: closeModel, renamePath: renamePath, setLanguage: setLanguage,
    getValue: getValue, getVersion: getVersion,
    focus: focus, insertAtCursor: insertAtCursor, replaceAll: replaceAll, getSelectedText: getSelectedText,
    gotoLine: gotoLine, typeText: typeText, pressTab: pressTab, undo: undo, redo: redo,
    action: action, applyOptions: applyOptions
  };
})();
