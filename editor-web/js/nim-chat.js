/* Chat IA con NVIDIA NIM (API compatible con OpenAI) */
(function () {
  "use strict";

  var ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
  var STORE = "uri.chat";
  var MAX_CONTEXT_CHARS = 12000;
  var SYSTEM = "Eres Uri IA, el asistente de programación integrado en el editor Uri Code. " +
    "Responde en español, de forma clara y concisa. Cuando muestres código usa bloques con triple acento grave indicando el lenguaje. " +
    "Si el usuario comparte un archivo, trabaja sobre ese contenido; cuando propongas cambios a todo el archivo, devuelve el archivo completo en un único bloque de código.";

  var ctx = null;
  var els = {};
  var history = [];      // [{role, content}]
  var codeStore = [];    // código de los bloques renderizados
  var busy = false;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Markdown mínimo y seguro ---------- */
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return t;
  }

  function mdText(s) {
    var lines = s.replace(/\r/g, "").split("\n");
    var html = "", para = [], list = null;
    function flushPara() { if (para.length) { html += "<p>" + para.join("<br>") + "</p>"; para = []; } }
    function flushList() { if (list) { html += "</" + list + ">"; list = null; } }
    lines.forEach(function (line) {
      var m;
      if (/^\s*$/.test(line)) { flushPara(); flushList(); return; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flushPara(); flushList(); html += "<h4>" + inline(m[1]) + "</h4>"; return; }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        flushPara(); if (list !== "ul") { flushList(); html += "<ul>"; list = "ul"; }
        html += "<li>" + inline(m[1]) + "</li>"; return;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara(); if (list !== "ol") { flushList(); html += "<ol>"; list = "ol"; }
        html += "<li>" + inline(m[1]) + "</li>"; return;
      }
      flushList(); para.push(inline(line));
    });
    flushPara(); flushList();
    return html;
  }

  function codeBlockHtml(lang, code, idx) {
    return '<div class="codeblock"><div class="cb-head"><span>' + esc(lang || "código") + '</span><span class="cb-actions">' +
      '<button data-act="copy" data-i="' + idx + '">Copiar</button>' +
      '<button data-act="insert" data-i="' + idx + '">Insertar</button>' +
      '<button data-act="replace" data-i="' + idx + '">Reemplazar archivo</button>' +
      '</span></div><pre><code>' + esc(code) + '</code></pre></div>';
  }

  function renderMd(text) {
    var out = "", last = 0, m;
    var re = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(```|$)/g;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out += mdText(text.slice(last, m.index));
      var code = m[2].replace(/\n$/, "");
      var idx = codeStore.push(code) - 1;
      out += codeBlockHtml(m[1], code, idx);
      last = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) out += mdText(text.slice(last));
    return out;
  }

  /* ---------- Mensajes ---------- */
  function scrollDown() { els.messages.scrollTop = els.messages.scrollHeight; }

  function addMessage(kind, text) {
    var d = document.createElement("div");
    d.className = "msg " + kind;
    var who = { user: "Tú", ai: "Uri IA", sys: "", err: "" }[kind];
    d.innerHTML = (who ? '<div class="who">' + who + "</div>" : "") + '<div class="body"></div>';
    var body = d.querySelector ? d.querySelector(".body") : null;
    if (!body) body = d.lastChild || d;
    if (kind === "ai") body.innerHTML = renderMd(text);
    else body.textContent = text;
    els.messages.appendChild(d);
    scrollDown();
    return d;
  }

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(history.slice(-40))); } catch (e) {}
  }

  function renderAll() {
    els.messages.innerHTML = "";
    codeStore = [];
    if (!history.length) {
      addMessage("sys", "Hola, soy Uri IA. Pregúntame sobre el archivo abierto o pídeme código. " +
        "Configura tu API Key de NVIDIA NIM en Ajustes.");
    }
    history.forEach(function (h) { addMessage(h.role === "user" ? "user" : "ai", h.content); });
  }

  /* ---------- Envío ---------- */
  function buildContext() {
    if (!els.include.checked) return "";
    var c = ctx.getContext();
    if (!c || !c.path) return "";
    var hasSelection = typeof c.selection === "string" && c.selection.length > 0;
    var body = hasSelection ? c.selection : c.text;
    if (typeof body !== "string") body = body == null ? "" : String(body);
    var label = hasSelection ? "Selección en " : "Archivo abierto: ";
    var note = "";
    if (body.length > MAX_CONTEXT_CHARS) { body = body.slice(0, MAX_CONTEXT_CHARS); note = "\n[…contenido recortado…]"; }
    return "\n\n--- " + label + c.path + " (" + c.lang + ") ---\n" + body + note + "\n--- fin ---";
  }

  function errorText(status, text, model) {
    if (status === -1) return "No se pudo conectar con NVIDIA NIM. Revisa tu conexión a internet.\n" + text;
    if (status === 401 || status === 403) return "La API Key no es válida o no tiene permisos (HTTP " + status + ").";
    if (status === 404) return "Modelo no encontrado: " + model + ". Cámbialo en Ajustes.";
    if (status === 429) return "Has alcanzado el límite de uso. Espera un momento y vuelve a intentarlo.";
    var detail = text;
    try {
      var j = JSON.parse(text);
      detail = (j.detail && (j.detail.message || j.detail)) || (j.error && (j.error.message || j.error)) || j.message || text;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch (e) {}
    return "Error de NVIDIA NIM (HTTP " + status + "): " + String(detail).slice(0, 400);
  }

  function reportError(message) {
    if (ctx && typeof ctx.log === "function") {
      try { ctx.log("Chat error: " + String(message), "error"); } catch (e) {}
    }
  }

  function setBusy(v) {
    busy = v;
    els.send.disabled = v;
  }

  function send() {
    if (busy) return;
    var q = els.input.value.trim();
    if (!q) return;
    var s = ctx.getSettings();
    if (!s.nimKey) {
      var keyError = "Falta la API Key de NVIDIA NIM. Pégala en Ajustes.";
      reportError(keyError);
      addMessage("err", keyError);
      ctx.openSettings();
      return;
    }
    els.input.value = "";
    autoGrow();
    addMessage("user", q);
    setBusy(true);

    var pending = document.createElement("div");
    pending.className = "msg ai";
    pending.innerHTML = '<div class="who">Uri IA</div><div class="body thinking">Pensando</div>';
    els.messages.appendChild(pending);
    scrollDown();

    var messages = [{ role: "system", content: SYSTEM }]
      .concat(history.slice(-10))
      .concat([{ role: "user", content: q + buildContext() }]);

    window.API.httpPost(ENDPOINT, {
      "Authorization": "Bearer " + s.nimKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    }, { model: s.nimModel, messages: messages, temperature: 0.3, max_tokens: 2048, stream: false })
      .then(function (r) {
        if (pending.parentNode) pending.parentNode.removeChild(pending);
        if (r.status < 200 || r.status >= 300) {
          var httpError = errorText(r.status, r.text, s.nimModel);
          reportError(httpError);
          addMessage("err", httpError);
          return;
        }
        var content = "";
        try {
          var data = JSON.parse(r.text);
          if (data && data.error) {
            var em = data.error.message || data.error; if (typeof em !== "string") em = JSON.stringify(em);
            var dataError = "Error de NVIDIA NIM: " + em;
            reportError(dataError);
            addMessage("err", dataError);
            return;
          }
          var choice = data && data.choices && data.choices[0];
          var msg = choice && choice.message;
          content = (msg && msg.content) || (choice && choice.text) || (data && data.content) || "";
          if (typeof content !== "string") content = content ? String(content) : "";
        } catch (e) {
          var parseError = "No se pudo interpretar la respuesta: " + (e && e.message || e);
          reportError(parseError);
          addMessage("err", parseError);
          return;
        }
        if (!content) {
          var emptyError = "La respuesta llegó vacía o con un formato inesperado.";
          reportError(emptyError);
          addMessage("err", emptyError);
          return;
        }
        history.push({ role: "user", content: q });
        history.push({ role: "assistant", content: content });
        if (history.length > 40) history = history.slice(-40);
        persist();
        addMessage("ai", content);
      }, function (e) {
        if (pending.parentNode) pending.parentNode.removeChild(pending);
        var unexpectedError = "Error inesperado: " + (e && e.message ? e.message : e);
        reportError(unexpectedError);
        addMessage("err", unexpectedError);
      })
      .then(function () { setBusy(false); });
  }

  /* ---------- Acciones sobre bloques de código ---------- */
  function copyText(t) {
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      ctx.toast(ok ? "Copiado" : "No se pudo copiar", ok ? "" : "error");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { ctx.toast("Copiado"); }, legacy);
    } else { legacy(); }
  }

  function onMessagesClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!b) return;
    var code = codeStore[parseInt(b.getAttribute("data-i"), 10)];
    if (code == null) return;
    var act = b.getAttribute("data-act");
    if (act === "copy") copyText(code);
    else if (act === "insert") ctx.insert(code);
    else if (act === "replace") ctx.replace(code);
  }

  function autoGrow() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
  }

  function refresh() {
    // Puede llamarse antes de init() (p. ej. al aplicar ajustes al arrancar).
    if (!ctx || !els.modelLabel) return;
    var s = ctx.getSettings();
    els.modelLabel.textContent = s.nimModel || "";
    els.modelLabel.title = s.nimModel || "";
  }

  function init(c) {
    ctx = c;
    els.messages = document.getElementById("chatMessages");
    els.input = document.getElementById("chatInput");
    els.send = document.getElementById("chatSend");
    els.include = document.getElementById("chatIncludeFile");
    els.modelLabel = document.getElementById("chatModelLabel");

    try { history = JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { history = []; }
    if (!Array.isArray(history)) history = [];
    history = history.filter(function (h) { return h && typeof h.role === "string" && typeof h.content === "string"; }).slice(-40);

    els.send.addEventListener("click", send);
    els.input.addEventListener("input", autoGrow);
    els.input.addEventListener("keydown", function (e) {
      var coarse = window.matchMedia("(pointer: coarse)").matches;
      if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); send(); }
    });
    els.messages.addEventListener("click", onMessagesClick);
    document.getElementById("chatClear").addEventListener("click", function () {
      ctx.confirm("Limpiar el chat", "Se borrará el historial de la conversación con la IA.", "Limpiar").then(function (ok) {
        if (!ok) return;
        history = []; persist(); renderAll();
      });
    });
    renderAll();
    refresh();
  }

  window.Chat = { init: init, refresh: refresh, focus: function () { if (els.input) els.input.focus(); } };
})();
