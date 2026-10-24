/* Envoltorio de Monaco (el motor de VS Code). Si no hay conexión usa un editor de texto básico. */
(function () {
  "use strict";

  var MONACO_LOCAL = "vendor/monaco";
  var MONACO_CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min";
  var monacoBase = MONACO_CDN;

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
    function tryBase(base, next) {
      window.MonacoEnvironment = {
        getWorkerUrl: function () {
          return "data:text/javascript;charset=utf-8," + encodeURIComponent(
            "self.MonacoEnvironment={baseUrl:'" + base + "/'};importScripts('" + base + "/vs/base/worker/workerMain.js');");
        }
      };
      return loadScript(base + "/vs/loader.js", 15000).then(function () {
        return new Promise(function (resolve, reject) {
          var t = setTimeout(function () { reject(new Error("timeout")); }, 30000);
          window.require.config({ paths: { vs: base + "/vs" } });
          window.require(["vs/editor/editor.main"], function () { clearTimeout(t); monacoBase = base; resolve(); },
            function (e) { clearTimeout(t); reject(e); });
        });
      }).catch(function (e) { return next(); });
    }
    return tryBase(MONACO_LOCAL, function () { return tryBase(MONACO_CDN, function () { return Promise.reject(new Error("no monaco")); }); }).then(function () {
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
        glyphMargin: true,
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

  function monacoApi() {
    if (typeof window !== "undefined" && window.monaco) return window.monaco;
    return mon;
  }

  function monacoEditor() {
    var api = monacoApi();
    if (api && api.editor && typeof api.editor.getEditors === "function") {
      try {
        var editors = api.editor.getEditors();
        if (editors && editors.length) return editors[0];
      } catch (e) {}
    }
    return editor;
  }

  function editorModel(ed) {
    if (!ed || typeof ed.getModel !== "function") return null;
    try { return ed.getModel(); } catch (e) { return null; }
  }

  function modelValue(model) {
    if (!model || typeof model.getValue !== "function") return "";
    try { return String(model.getValue()); } catch (e) { return ""; }
  }

  function modelLineCount(model) {
    if (!model) return 0;
    if (typeof model.getLineCount === "function") {
      try { return model.getLineCount(); } catch (e) {}
    }
    return modelValue(model).split(/\r\n|\r|\n/).length;
  }

  function modelLineContent(model, line) {
    if (!model) return "";
    if (typeof model.getLineContent === "function") {
      try { return String(model.getLineContent(line)); } catch (e) {}
    }
    var lines = modelValue(model).split(/\r\n|\r|\n/);
    return lines[line - 1] == null ? "" : lines[line - 1];
  }

  function modelMaxColumn(model, line) {
    if (!model) return 1;
    if (typeof model.getLineMaxColumn === "function") {
      try { return model.getLineMaxColumn(line); } catch (e) {}
    }
    return modelLineContent(model, line).length + 1;
  }

  function modelOffsetAt(model, pos) {
    if (!model || !pos) return 0;
    if (typeof model.getOffsetAt === "function") {
      try { return model.getOffsetAt(pos); } catch (e) {}
    }
    var value = modelValue(model);
    var lines = value.split(/\r\n|\r|\n/);
    var line = Math.max(1, pos.lineNumber || 1);
    var offset = 0;
    for (var i = 1; i < line && i <= lines.length; i++) {
      offset += lines[i - 1].length;
      var ch = value.charAt(offset);
      if (ch === "\r" && value.charAt(offset + 1) === "\n") offset += 2;
      else if (ch === "\r" || ch === "\n") offset++;
    }
    return offset + Math.max(0, (pos.column || 1) - 1);
  }

  function modelPositionAt(model, offset) {
    if (!model) return { lineNumber: 1, column: 1 };
    if (typeof model.getPositionAt === "function") {
      try { return model.getPositionAt(offset); } catch (e) {}
    }
    var value = modelValue(model);
    var line = 1, column = 1;
    for (var i = 0; i < offset && i < value.length; i++) {
      var ch = value.charAt(i);
      if (ch === "\r") {
        if (value.charAt(i + 1) === "\n") i++;
        line++;
        column = 1;
      } else if (ch === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { lineNumber: line, column: column };
  }

  function modelTextInRange(model, start, end) {
    if (!model || !start || !end) return "";
    if (typeof model.getValueInRange === "function") {
      try { return String(model.getValueInRange({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column })); } catch (e) {}
    }
    return modelValue(model).slice(modelOffsetAt(model, start), modelOffsetAt(model, end));
  }

  function selectionPosition(sel) {
    if (!sel) return null;
    if (typeof sel.getPosition === "function") {
      try {
        var p = sel.getPosition();
        if (p) return p;
      } catch (e) {}
    }
    if (sel.position) return sel.position;
    var line = sel.positionLineNumber != null ? sel.positionLineNumber : sel.startLineNumber;
    var column = sel.positionColumn != null ? sel.positionColumn : sel.startColumn;
    return line == null ? null : { lineNumber: line, column: column || 1 };
  }

  function selectionStartPosition(sel) {
    if (!sel) return null;
    if (typeof sel.getStartPosition === "function") {
      try {
        var p = sel.getStartPosition();
        if (p) return p;
      } catch (e) {}
    }
    if (sel.start) return sel.start;
    return sel.startLineNumber == null ? null : { lineNumber: sel.startLineNumber, column: sel.startColumn || 1 };
  }

  function selectionEndPosition(sel) {
    if (!sel) return null;
    if (typeof sel.getEndPosition === "function") {
      try {
        var p = sel.getEndPosition();
        if (p) return p;
      } catch (e) {}
    }
    if (sel.end) return sel.end;
    return sel.endLineNumber == null ? null : { lineNumber: sel.endLineNumber, column: sel.endColumn || 1 };
  }

  function makeSelection(startLineNumber, startColumn, endLineNumber, endColumn) {
    var api = monacoApi();
    if (api && typeof api.Selection === "function") {
      try { return new api.Selection(startLineNumber, startColumn, endLineNumber, endColumn); } catch (e) {}
    }
    var sel = {
      startLineNumber: startLineNumber,
      startColumn: startColumn,
      endLineNumber: endLineNumber,
      endColumn: endColumn,
      positionLineNumber: endLineNumber,
      positionColumn: endColumn
    };
    sel.getPosition = function () { return { lineNumber: this.endLineNumber, column: this.endColumn }; };
    sel.getStartPosition = function () { return { lineNumber: this.startLineNumber, column: this.startColumn }; };
    sel.getEndPosition = function () { return { lineNumber: this.endLineNumber, column: this.endColumn }; };
    sel.isEmpty = function () { return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn; };
    return sel;
  }

  function getEditorSelections(ed) {
    if (!ed) return [];
    if (typeof ed.getSelections === "function") {
      try {
        var selections = ed.getSelections();
        if (selections && selections.length) return selections;
      } catch (e) {}
    }
    if (typeof ed.getSelection === "function") {
      try {
        var selection = ed.getSelection();
        return selection ? [selection] : [];
      } catch (e) {}
    }
    return [];
  }

  function setEditorSelections(ed, selections) {
    if (!ed || !selections || !selections.length) return false;
    try {
      if (typeof ed.setSelections === "function") {
        ed.setSelections(selections);
        return true;
      }
      if (typeof ed.setSelection === "function") {
        ed.setSelection(selections[0]);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function primaryEditorSelection(ed) {
    var selections = getEditorSelections(ed);
    if (ed && typeof ed.getSelection === "function") {
      try {
        var primary = ed.getSelection();
        if (primary) return primary;
      } catch (e) {}
    }
    return selections.length ? selections[selections.length - 1] : null;
  }

  function selectionTextInfo(sel, model) {
    var start = selectionStartPosition(sel);
    var end = selectionEndPosition(sel);
    if (!start || !end) return null;
    if (start.lineNumber === end.lineNumber && start.column === end.column) return null;
    var text = modelTextInRange(model, start, end);
    if (!text) return null;
    return {
      text: text,
      startOffset: modelOffsetAt(model, start),
      endOffset: modelOffsetAt(model, end)
    };
  }

  function isWordChar(ch) {
    return !!ch && /[A-Za-z0-9_$]/.test(ch);
  }

  function isWordBoundary(value, index, length) {
    var before = index > 0 ? value.charAt(index - 1) : "";
    var after = index + length < value.length ? value.charAt(index + length) : "";
    return !isWordChar(before) && !isWordChar(after);
  }

  function wordAtPosition(model, pos) {
    if (!model || !pos) return null;
    if (typeof model.getWordAtPosition === "function") {
      try {
        var word = model.getWordAtPosition(pos);
        if (word && word.word) {
          var line = pos.lineNumber;
          var startColumn = word.startColumn || pos.column;
          var endColumn = word.endColumn || (startColumn + word.word.length);
          var start = { lineNumber: line, column: startColumn };
          var end = { lineNumber: line, column: endColumn };
          return {
            text: String(word.word),
            startOffset: modelOffsetAt(model, start),
            endOffset: modelOffsetAt(model, end)
          };
        }
      } catch (e) {}
    }
    var value = modelValue(model);
    var offset = modelOffsetAt(model, pos);
    var startOffset = offset;
    var endOffset = offset;
    while (startOffset > 0 && isWordChar(value.charAt(startOffset - 1))) startOffset--;
    while (endOffset < value.length && isWordChar(value.charAt(endOffset))) endOffset++;
    if (startOffset === endOffset) return null;
    return {
      text: value.slice(startOffset, endOffset),
      startOffset: startOffset,
      endOffset: endOffset
    };
  }

  function occurrenceContext(ed, model) {
    var selections = getEditorSelections(ed);
    var primary = primaryEditorSelection(ed);
    var info = selectionTextInfo(primary, model);
    if (!info) {
      for (var i = selections.length - 1; i >= 0 && !info; i--) {
        info = selectionTextInfo(selections[i], model);
      }
    }
    if (info) {
      return { text: info.text, wordOnly: false, anchorOffset: info.endOffset, selected: true };
    }
    var pos = selectionPosition(primary);
    if (!pos && ed && typeof ed.getPosition === "function") {
      try { pos = ed.getPosition(); } catch (e) {}
    }
    var word = wordAtPosition(model, pos);
    if (!word) return null;
    return { text: word.text, wordOnly: true, anchorOffset: word.startOffset, selected: false };
  }

  function findOccurrences(model, text, wordOnly) {
    var value = modelValue(model);
    var needle = String(text || "");
    if (!needle) return [];
    var occurrences = [];
    var from = 0;
    while (from <= value.length) {
      var index = value.indexOf(needle, from);
      if (index < 0) break;
      if (!wordOnly || isWordBoundary(value, index, needle.length)) {
        var start = modelPositionAt(model, index);
        var end = modelPositionAt(model, index + needle.length);
        occurrences.push({
          text: needle,
          startOffset: index,
          endOffset: index + needle.length,
          start: start,
          end: end
        });
      }
      from = index + 1;
    }
    return occurrences;
  }

  function occurrenceAlreadySelected(occurrence, selections, model) {
    for (var i = 0; i < selections.length; i++) {
      var start = selectionStartPosition(selections[i]);
      var end = selectionEndPosition(selections[i]);
      if (!start || !end) continue;
      if (modelOffsetAt(model, start) === occurrence.startOffset && modelOffsetAt(model, end) === occurrence.endOffset) return true;
    }
    return false;
  }

  function selectNextOccurrence() {
    var ed = monacoEditor();
    var model = editorModel(ed);
    if (!ed || !model) return false;
    var context = occurrenceContext(ed, model);
    if (!context) return false;
    var occurrences = findOccurrences(model, context.text, context.wordOnly);
    if (!occurrences.length) return false;
    var selections = getEditorSelections(ed);
    if (!context.selected) {
      var current = null;
      for (var i = 0; i < occurrences.length; i++) {
        if (context.anchorOffset >= occurrences[i].startOffset && context.anchorOffset <= occurrences[i].endOffset) {
          current = occurrences[i];
          break;
        }
      }
      if (!current) current = occurrences[0];
      if (!current) return false;
      var first = makeSelection(current.start.lineNumber, current.start.column, current.end.lineNumber, current.end.column);
      return setEditorSelections(ed, [first]);
    }
    var candidate = null;
    for (var j = 0; j < occurrences.length; j++) {
      if (occurrences[j].startOffset >= context.anchorOffset && !occurrenceAlreadySelected(occurrences[j], selections, model)) {
        candidate = occurrences[j];
        break;
      }
    }
    if (!candidate) {
      for (var k = 0; k < occurrences.length; k++) {
        if (!occurrenceAlreadySelected(occurrences[k], selections, model)) {
          candidate = occurrences[k];
          break;
        }
      }
    }
    if (!candidate) return false;
    var next = makeSelection(candidate.start.lineNumber, candidate.start.column, candidate.end.lineNumber, candidate.end.column);
    return setEditorSelections(ed, selections.concat([next]));
  }

  function selectAllOccurrences() {
    var ed = monacoEditor();
    var model = editorModel(ed);
    if (!ed || !model) return false;
    var context = occurrenceContext(ed, model);
    if (!context) return false;
    var occurrences = findOccurrences(model, context.text, context.wordOnly);
    if (!occurrences.length) return false;
    var selections = occurrences.map(function (occurrence) {
      return makeSelection(occurrence.start.lineNumber, occurrence.start.column, occurrence.end.lineNumber, occurrence.end.column);
    });
    return setEditorSelections(ed, selections);
  }

  function cursorKey(sel) {
    var start = selectionStartPosition(sel);
    var end = selectionEndPosition(sel);
    if (!start || !end || start.lineNumber !== end.lineNumber || start.column !== end.column) return null;
    return start.lineNumber + ":" + start.column;
  }

  function addCursorRelative(direction) {
    var ed = monacoEditor();
    var model = editorModel(ed);
    if (!ed || !model) return false;
    var selections = getEditorSelections(ed);
    if (!selections.length) return false;
    var lineCount = modelLineCount(model);
    var existing = {};
    selections.forEach(function (selection) {
      var key = cursorKey(selection);
      if (key) existing[key] = true;
    });
    var additions = [];
    selections.forEach(function (selection) {
      var position = selectionPosition(selection);
      if (!position) return;
      var line = position.lineNumber + direction;
      if (line < 1 || line > lineCount) return;
      var column = Math.max(1, Math.min(position.column || 1, modelMaxColumn(model, line)));
      var key = line + ":" + column;
      if (existing[key]) return;
      existing[key] = true;
      additions.push(makeSelection(line, column, line, column));
    });
    if (!additions.length) return false;
    return setEditorSelections(ed, selections.concat(additions));
  }

  function addCursorAbove() {
    return addCursorRelative(-1);
  }

  function addCursorBelow() {
    return addCursorRelative(1);
  }

  function editorAction(ed, id) {
    if (!ed || typeof ed.getAction !== "function") return null;
    try { return ed.getAction(id); } catch (e) { return null; }
  }

  function bracketPairs(value) {
    var pairs = {};
    var stack = [];
    var opens = { "(": ")", "[": "]", "{": "}" };
    var closes = { ")": "(", "]": "[", "}": "{" };
    var state = "code";
    var quote = "";
    var escaped = false;
    for (var i = 0; i < value.length; i++) {
      var ch = value.charAt(i);
      var next = value.charAt(i + 1);
      if (state === "line-comment") {
        if (ch === "\n" || ch === "\r") state = "code";
        continue;
      }
      if (state === "block-comment") {
        if (ch === "*" && next === "/") { state = "code"; i++; }
        continue;
      }
      if (state === "string") {
        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === quote) state = "code";
        continue;
      }
      if (ch === "/" && next === "/") { state = "line-comment"; i++; continue; }
      if (ch === "/" && next === "*") { state = "block-comment"; i++; continue; }
      if (ch === "\"" || ch === "'" || ch === "`") { state = "string"; quote = ch; escaped = false; continue; }
      if (opens[ch]) {
        stack.push({ char: ch, index: i });
      } else if (closes[ch]) {
        for (var j = stack.length - 1; j >= 0; j--) {
          if (opens[stack[j].char] === ch) {
            pairs[stack[j].index] = i;
            pairs[i] = stack[j].index;
            stack.length = j;
            break;
          }
        }
      }
    }
    return pairs;
  }

  function goToMatchingBracket() {
    var ed = monacoEditor();
    if (!ed) return false;
    var builtin = editorAction(ed, "editor.action.bracketMatch");
    if (builtin && typeof builtin.run === "function") {
      try {
        builtin.run();
        return true;
      } catch (e) {}
    }
    var model = editorModel(ed);
    var position = selectionPosition(primaryEditorSelection(ed));
    if (!model || !position) return false;
    var value = modelValue(model);
    var offset = modelOffsetAt(model, position);
    var candidates = [];
    if (offset > 0 && "()[]{}".indexOf(value.charAt(offset - 1)) >= 0) candidates.push(offset - 1);
    if (offset < value.length && "()[]{}".indexOf(value.charAt(offset)) >= 0) candidates.push(offset);
    if (!candidates.length) return false;
    var pairs = bracketPairs(value);
    for (var i = 0; i < candidates.length; i++) {
      var match = pairs[candidates[i]];
      if (match == null) continue;
      var target = modelPositionAt(model, match);
      try {
        if (typeof ed.setPosition === "function") {
          ed.setPosition(target);
          return true;
        }
        if (typeof ed.setSelection === "function") {
          ed.setSelection(makeSelection(target.lineNumber, target.column, target.lineNumber, target.column));
          return true;
        }
      } catch (e) {}
    }
    return false;
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
    if (id === "editor.action.insertCursorAbove") return addCursorAbove();
    if (id === "editor.action.insertCursorBelow") return addCursorBelow();
    if (id === "editor.action.addSelectionToNextFindMatch") return selectNextOccurrence();
    if (id === "editor.action.selectAllOccurrences") return selectAllOccurrences();
    if (id === "editor.action.bracketMatch") return goToMatchingBracket();
    if (mode === "monaco" && editor && editor.getModel()) {
      editor.focus();
      var a = editor.getAction(id);
      if (a) a.run(); else editor.trigger("uri", id, null);
      return true;
    }
    return false;
  }

  function getCursor() {
    if (mode === "monaco" && editor && editor.getModel()) {
      var pos = editor.getPosition();
      return { line: pos.lineNumber, col: pos.column };
    }
    if (mode === "fallback" && fb && currentPath) {
      var before = fb.value.slice(0, fb.selectionStart);
      return { line: before.split("\n").length, col: before.length - before.lastIndexOf("\n") };
    }
    return null;
  }

  function applyOptions(o) {
    for (var k in o) options[k] = o[k];
    if (mode === "monaco" && editor) {
      editor.updateOptions({
        fontSize: options.fontSize,
        wordWrap: options.wordWrap ? "on" : "off",
        minimap: { enabled: !!options.minimap },
        tabSize: options.tabSize || 4,
        insertSpaces: options.insertSpaces !== false
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
    gotoLine: gotoLine, typeText: typeText, pressTab: pressTab, undo: undo, redo: redo, getCursor: getCursor,
    addCursorAbove: addCursorAbove, addCursorBelow: addCursorBelow,
    selectNextOccurrence: selectNextOccurrence, selectAllOccurrences: selectAllOccurrences,
    goToMatchingBracket: goToMatchingBracket, matchBracket: goToMatchingBracket,
    action: action, applyOptions: applyOptions
  };
})();
