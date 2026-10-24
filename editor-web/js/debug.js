/* Debug Adapter Protocol (DAP) client skeleton. */
(function () {
  "use strict";

  var BP_KEY = "uri.breakpoints";

  function loadBps() {
    try {
      var r = JSON.parse(localStorage.getItem(BP_KEY));
      return Array.isArray(r) ? r : [];
    } catch (e) {
      return [];
    }
  }

  function saveBps(list) {
    try { localStorage.setItem(BP_KEY, JSON.stringify(list)); } catch (e) {}
  }

  var breakpoints = loadBps().map(function (b) {
    return { file: String((b && (b.file || b.path)) || ""), line: Number((b && b.line) || 0) };
  });

  var handlers = [];
  function onEvent(h) {
    if (typeof h !== "function") return function () {};
    handlers.push(h);
    return function () { handlers = handlers.filter(function (x) { return x !== h; }); };
  }
  function emit(type, payload) {
    var ev = { type: type, payload: payload || {} };
    handlers.slice().forEach(function (h) { try { h(ev); } catch (e) {} });
  }

  function findIndex(file, line) {
    for (var i = 0; i < breakpoints.length; i++) {
      if (breakpoints[i].file === file && breakpoints[i].line === line) return i;
    }
    return -1;
  }

  function setBreakpoint(file, line) {
    file = String(file || "");
    line = Number(line) || 0;
    if (findIndex(file, line) < 0) breakpoints.push({ file: file, line: line });
    saveBps(breakpoints);
    emit("breakpoint", { action: "set", file: file, line: line });
    return true;
  }

  function removeBreakpoint(file, line) {
    file = String(file || "");
    line = Number(line) || 0;
    var i = findIndex(file, line);
    if (i >= 0) breakpoints.splice(i, 1);
    saveBps(breakpoints);
    emit("breakpoint", { action: "remove", file: file, line: line });
    return i >= 0;
  }

  function getBreakpoints() {
    return breakpoints.slice().map(function (b) { return { file: b.file, line: b.line }; });
  }

  /* Mock debug session */
  var session = null;
  var timers = [];
  function clearTimers() { timers.forEach(function (t) { try { clearTimeout(t); } catch (e) {} }); timers = []; }
  function schedule(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }

  function start(config) {
    if (session) stop();
    session = { config: config || {}, state: "starting" };
    schedule(function () {
      if (!session) return;
      session.state = "running";
      emit("started", { session: session });
    }, 50);
    return true;
  }

  function stop() {
    clearTimers();
    var s = session;
    session = null;
    emit("terminated", { session: s });
    return true;
  }

  function continueRun() {
    if (!session) return false;
    session.state = "running";
    schedule(function () {
      if (!session) return;
      session.state = "stopped";
      emit("stopped", { reason: "breakpoint", session: session });
    }, 150);
    return true;
  }

  function stepOver() {
    if (!session) return false;
    session.state = "running";
    schedule(function () {
      if (!session) return;
      session.state = "stopped";
      emit("stopped", { reason: "step", session: session });
    }, 100);
    return true;
  }

  function stepIn() {
    if (!session) return false;
    session.state = "running";
    schedule(function () {
      if (!session) return;
      session.state = "stopped";
      emit("stopped", { reason: "step", session: session });
    }, 100);
    return true;
  }

  function stepOut() {
    if (!session) return false;
    session.state = "running";
    schedule(function () {
      if (!session) return;
      session.state = "stopped";
      emit("stopped", { reason: "step", session: session });
    }, 100);
    return true;
  }

  function renderPanel(container) {
    var root = (typeof container === "string") ? document.querySelector(container) : container;
    if (!root) return null;
    root.innerHTML = "";

    var panel = document.createElement("div");
    panel.style.cssText = "font-family:var(--font-ui,sans-serif);font-size:13px;padding:8px;background:var(--bg-sidebar,#252526);color:var(--fg,#ccc);";

    var title = document.createElement("div");
    title.textContent = "Sesión de depuración";
    title.style.cssText = "font-weight:600;margin-bottom:6px;color:var(--fg-bright,#fff);";
    panel.appendChild(title);

    var status = document.createElement("div");
    status.textContent = "inactivo";
    status.style.cssText = "margin-bottom:8px;color:var(--fg-dim,#858585);font-size:12px;";
    panel.appendChild(status);

    var controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;";
    function btn(label, fn, primary) {
      var b = document.createElement("button");
      b.className = "btn btn-sm " + (primary ? "btn-primary" : "btn-ghost");
      b.textContent = label;
      b.addEventListener("click", function () { try { fn(); } catch (e) {} refresh(); });
      return b;
    }
    controls.appendChild(btn("Iniciar", function () { start({}); }, true));
    controls.appendChild(btn("Detener", function () { stop(); }));
    controls.appendChild(btn("Continuar", function () { continueRun(); }));
    controls.appendChild(btn("Paso", function () { stepOver(); }));
    controls.appendChild(btn("Entrar", function () { stepIn(); }));
    controls.appendChild(btn("Salir", function () { stepOut(); }));
    panel.appendChild(controls);

    var bpTitle = document.createElement("div");
    bpTitle.textContent = "Puntos de interrupción";
    bpTitle.style.cssText = "font-weight:600;margin-bottom:4px;color:var(--fg-bright,#fff);";
    panel.appendChild(bpTitle);

    var list = document.createElement("div");
    list.style.cssText = "max-height:180px;overflow:auto;font-family:var(--font-mono,monospace);font-size:12px;";
    panel.appendChild(list);

    function refresh() {
      list.innerHTML = "";
      var bps = getBreakpoints();
      if (!bps.length) {
        var empty = document.createElement("div");
        empty.textContent = "Sin puntos de interrupción";
        empty.style.cssText = "color:var(--fg-dim,#858585);padding:4px 0;";
        list.appendChild(empty);
      }
      bps.forEach(function (bp) {
        var li = document.createElement("div");
        li.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:3px 4px;border-radius:3px;";
        li.style.cursor = "pointer";
        li.addEventListener("mouseenter", function () { li.style.background = "var(--bg-hover,#2a2d2e)"; });
        li.addEventListener("mouseleave", function () { li.style.background = "transparent"; });
        var span = document.createElement("span");
        span.textContent = (bp.file || "?") + ":" + bp.line;
        li.appendChild(span);
        var rb = document.createElement("button");
        rb.className = "btn btn-ghost btn-sm";
        rb.textContent = "Quitar";
        rb.addEventListener("click", function (e) { e.stopPropagation(); removeBreakpoint(bp.file, bp.line); refresh(); });
        li.appendChild(rb);
        list.appendChild(li);
      });
    }

    onEvent(function (ev) { status.textContent = ev.type; refresh(); });
    refresh();
    root.appendChild(panel);
    return panel;
  }

  var API = {
    setBreakpoint: setBreakpoint,
    removeBreakpoint: removeBreakpoint,
    getBreakpoints: getBreakpoints,
    start: start,
    stop: stop,
    continue: continueRun,
    stepOver: stepOver,
    stepIn: stepIn,
    stepOut: stepOut,
    onEvent: onEvent,
    renderPanel: renderPanel
  };

  window.UriDebug = API;
})();
