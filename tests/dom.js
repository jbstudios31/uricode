/* Banco de pruebas: DOM simulado para ejecutar Uri Code en Node.
 *
 * Permite cargar los scripts del editor (icons, api, editor, nim-chat, lsp,
 * debug, extensions y app) en un sandbox de vm y detectar errores en tiempo
 * de ejecucion sin necesidad de un dispositivo Android.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.resolve(__dirname, "..");

function makeStorage() {
  var data = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    clear: function () { data = {}; },
    _data: data
  };
}

/* Elemento generico: todo lo que se le pida existe y no rompe. */
function makeElement(id, tag) {
  var el = {
    _id: id || "",
    _tag: tag || "div",
    _attrs: {},
    _listeners: {},
    _children: [],
    _text: "",
    _html: "",
    style: {},
    value: "",
    checked: false,
    disabled: false,
    id: id || "",
    className: "",
    title: "",
    placeholder: "",
    href: "",
    type: "",
    innerWidth: 0,
    innerHeight: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientWidth: 300,
    clientHeight: 300,
    offsetWidth: 300,
    offsetHeight: 300,
    parentNode: null,
    parentElement: null,
    firstChild: null,
    lastChild: null,
    children: [],
    dataset: {},
    classList: {
      add: function () {}, remove: function () {}, toggle: function () {},
      contains: function () { return false; }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? "" : v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v == null ? "" : v); this._children = []; },
    appendChild: function (c) {
      if (!c) return c;
      // Un fragmento se expande: sus hijos pasan al padre (como en un navegador).
      if (c._tag === "#fragment") {
        c._children.slice().forEach(function (ch) {
          ch.parentNode = this;
          this._children.push(ch);
        }, this);
        c._children = [];
        return c;
      }
      c.parentNode = this;
      this._children.push(c);
      return c;
    },
    insertBefore: function (c) { return this.appendChild(c); },
    removeChild: function (c) {
      var i = this._children.indexOf(c);
      if (i >= 0) this._children.splice(i, 1);
      return c;
    },
    remove: function () { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute: function (k, v) { this._attrs[k] = String(v); if (k === "id") this.id = String(v); },
    getAttribute: function (k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    removeAttribute: function (k) { delete this._attrs[k]; },
    hasAttribute: function (k) { return this._attrs[k] !== undefined; },
    addEventListener: function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      var l = this._listeners[ev]; if (!l) return;
      var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
    dispatch: function (ev, payload) {
      var l = this._listeners[ev] || [];
      l.slice().forEach(function (fn) { try { fn.call(this, payload || { preventDefault: function () {}, stopPropagation: function () {} }); } catch (e) { throw e; } });
    },
    _q: {},
    querySelector: function (sel) {
      // Cachea por selector para conservar el contenido asignado.
      var k = String(sel);
      if (!this._q[k]) this._q[k] = makeElement("", "span");
      return this._q[k];
    },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    contains: function () { return false; },
    getBoundingClientRect: function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    focus: function () {}, blur: function () {}, click: function () { this.dispatch("click"); },
    setSelectionRange: function () {}, select: function () {},
    getContext: function () { return null; },
    insertAdjacentHTML: function () {},
    replaceChildren: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
  return el;
}

/* Crea el sandbox completo y devuelve { sandbox, window, elements }. */
function createSandbox(opts) {
  opts = opts || {};
  var elements = {};
  var storage = opts.storage || makeStorage();
  var errors = [];

  function byId(id) {
    if (!elements[id]) elements[id] = makeElement(id, "div");
    return elements[id];
  }

  var document = {
    getElementById: function (id) { return byId(id); },
    createElement: function (tag) { return makeElement("", tag); },
    createDocumentFragment: function () { return makeElement("", "#fragment"); },
    createTextNode: function (t) { return { textContent: String(t) }; },
    querySelector: function () { return makeElement("", "div"); },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
    body: makeElement("body", "body"),
    documentElement: makeElement("html", "html"),
    head: makeElement("head", "head"),
    activeElement: null,
    execCommand: function () { return true; },
    visibilityState: "visible"
  };
  document.body.classList = {
    _s: {},
    add: function (c) { this._s[c] = 1; },
    remove: function (c) { delete this._s[c]; },
    toggle: function (c) { this._s[c] = this._s[c] ? 0 : 1; },
    contains: function (c) { return !!this._s[c]; }
  };

  var sandbox = {
    console: console,
    document: document,
    localStorage: storage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: clearInterval,
    queueMicrotask: queueMicrotask,
    Promise: Promise,
    JSON: JSON,
    Math: Math,
    Date: Date,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    TypeError: TypeError,
    RangeError: RangeError,
    RegExp: RegExp,
    Map: Map,
    Set: Set,
    Symbol: Symbol,
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    Blob: typeof Blob !== "undefined" ? Blob : function () {},
    FileReader: typeof FileReader !== "undefined" ? FileReader : function () {},
    URL: typeof URL !== "undefined" ? URL : { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} },
    TextDecoder: typeof TextDecoder !== "undefined" ? TextDecoder : undefined,
    TextEncoder: typeof TextEncoder !== "undefined" ? TextEncoder : undefined,
    atob: function (s) { return Buffer.from(String(s), "base64").toString("binary"); },
    btoa: function (s) { return Buffer.from(String(s), "binary").toString("base64"); },
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    navigator: { userAgent: "node-test", vibrate: function () {}, clipboard: { writeText: function () { return Promise.resolve(); } } },
    location: { href: "file:///index.html", protocol: "file:" },
    screen: { width: 1080, height: 1920 },
    innerWidth: opts.innerWidth || 1080,
    innerHeight: opts.innerHeight || 1920,
    matchMedia: function () { return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} }; },
    requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame: function (id) { clearTimeout(id); },
    getComputedStyle: function () { return { getPropertyValue: function () { return ""; } }; },
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () { return true; },
    open: function () {},
    alert: function () {},
    confirm: function () { return true; },
    prompt: function () { return ""; },
    FileAPI: opts.fileAPI || undefined,
    URI_EXTENSIONS: opts.extensions || undefined
  };

  var win = sandbox;
  sandbox.window = win;
  sandbox.self = win;
  sandbox.globalThis = win;
  win.document = document;

  // Los scripts <script> externos fallan de inmediato (sin red en el test).
  var origCreate = document.createElement;
  document.createElement = function (tag) {
    var el = origCreate.call(document, tag);
    if (String(tag).toLowerCase() === "script") {
      el.__isScript = true;
    }
    return el;
  };
  var origAppend = document.head.appendChild.bind(document.head);
  document.head.appendChild = function (node) {
    origAppend(node);
    if (node && node.__isScript) {
      setTimeout(function () { if (node.onerror) node.onerror(); }, 0);
    }
    return node;
  };

  win.onerror = function (msg) { errors.push(String(msg)); };
  win.addEventListener = function (ev, fn) { (win._l = win._l || {}), (win._l[ev] = win._l[ev] || []).push(fn); };
  win.removeEventListener = function () {};

  vm.createContext(sandbox);
  return { sandbox: sandbox, window: win, elements: elements, storage: storage, errors: errors, document: document };
}

/* Carga un script del editor en el sandbox. */
function loadScript(ctx, rel) {
  var file = path.join(ROOT, "editor-web", rel);
  var src = fs.readFileSync(file, "utf8");
  vm.runInContext(src, ctx.sandbox, { filename: file });
}

/* Carga el editor completo (en orden) en el sandbox. */
function loadApp(ctx) {
  ["js/icons.js", "js/api.js", "js/editor.js", "js/nim-chat.js", "js/lsp.js", "js/debug.js",
    "js/extensions.js", "extensions/sample.js", "js/app.js"].forEach(function (f) {
    loadScript(ctx, f);
  });
}

module.exports = {
  ROOT: ROOT,
  createSandbox: createSandbox,
  loadScript: loadScript,
  loadApp: loadApp,
  makeElement: makeElement,
  makeStorage: makeStorage
};
