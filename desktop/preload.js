const { contextBridge, ipcRenderer } = require('electron');

// Puente síncrono-compatible: el frontend espera que FileAPI.listDir etc.
// devuelvan valores directos (no Promises) en algunos casos, pero api.js
// los envuelve en Promise.resolve(). Usamos invoke (async) y el frontend
// ya maneja Promises correctamente.
contextBridge.exposeInMainWorld('FileAPI', {
  getRoot: () => ipcRenderer.invoke('fileapi:getRoot'),
  listDir: (rel) => ipcRenderer.invoke('fileapi:listDir', rel || ''),
  exists: (rel) => ipcRenderer.invoke('fileapi:exists', rel || ''),
  readFile: (rel) => ipcRenderer.invoke('fileapi:readFile', rel || ''),
  writeFile: (rel, content) => ipcRenderer.invoke('fileapi:writeFile', rel || '', content == null ? '' : String(content)),
  mkdir: (rel) => ipcRenderer.invoke('fileapi:mkdir', rel || ''),
  deleteItem: (rel) => ipcRenderer.invoke('fileapi:deleteItem', rel || ''),
  renameItem: (a, b) => ipcRenderer.invoke('fileapi:renameItem', a || '', b || ''),
  shareText: (name, text) => ipcRenderer.invoke('fileapi:shareText', name || '', text || ''),
  runCommand: (cmd, cwd) => ipcRenderer.invoke('fileapi:runCommand', cmd || '', cwd || ''),
  runCommandStream: (id, cmd, cwd) => ipcRenderer.invoke('fileapi:runCommandStream', id, cmd || '', cwd || ''),
  startShell: (id, cwd) => ipcRenderer.invoke('fileapi:startShell', id, cwd || ''),
  sendToShell: (id, b64) => ipcRenderer.invoke('fileapi:sendToShell', id, b64 || ''),
  stopShell: (id) => ipcRenderer.invoke('fileapi:stopShell', id),
  startLsp: (id, command, argsJson, cwd) => ipcRenderer.invoke('fileapi:startLsp', id, command, argsJson || '[]', cwd || ''),
  sendLsp: (id, b64) => ipcRenderer.invoke('fileapi:sendLsp', id, b64 || ''),
  stopLsp: (id) => ipcRenderer.invoke('fileapi:stopLsp', id),
  httpPost: (id, url, headersJson, body) => ipcRenderer.invoke('fileapi:httpPost', id, url, headersJson || '{}', body || '{}')
});

// Diálogos nativos
contextBridge.exposeInMainWorld('DesktopDialogs', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFile: (name) => ipcRenderer.invoke('dialog:saveFile', name)
});

// Eventos del menú nativo → frontend (el frontend se suscribe con DesktopMenu.on)
contextBridge.exposeInMainWorld('DesktopMenu', {
  on: (channel, cb) => {
    const allowed = ['menu:newFile', 'menu:openFile', 'menu:openFolder', 'menu:save', 'menu:saveAs',
      'menu:find', 'menu:replace', 'menu:commandPalette', 'menu:explorer', 'menu:search',
      'menu:git', 'menu:terminal', 'menu:about'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => cb(...args));
    }
  }
});

// Escuchar callbacks del proceso principal y reenviarlos al renderer.
ipcRenderer.on('native:termChunk', (_, id, b64) => {
  if (window.__uriTermChunk) window.__uriTermChunk(id, b64);
});
ipcRenderer.on('native:termDone', (_, id, code) => {
  if (window.__uriTermDone) window.__uriTermDone(id, code);
});
ipcRenderer.on('native:shellData', (_, id, b64) => {
  if (window.__uriShellData) window.__uriShellData(id, b64);
});
ipcRenderer.on('native:shellClosed', (_, id, code) => {
  if (window.__uriShellClosed) window.__uriShellClosed(id, code);
});
ipcRenderer.on('native:lspData', (_, id, b64) => {
  if (window.__uriLspData) window.__uriLspData(id, b64);
});
ipcRenderer.on('native:lspError', (_, id, b64) => {
  if (window.__uriLspError) window.__uriLspError(id, b64);
});
ipcRenderer.on('native:lspClosed', (_, id, code) => {
  if (window.__uriLspClosed) window.__uriLspClosed(id, code);
});
ipcRenderer.on('native:httpDone', (_, id, status, b64) => {
  if (window.__uriHttpDone) window.__uriHttpDone(id, status, b64);
});

// Callbacks del puente nativo (Android los llama por evaluateJavascript; en desktop
// los llamamos directamente desde el preload).
contextBridge.exposeInMainWorld('__nativeCallbacks', {
  termChunk: (id, b64) => { if (window.__uriTermChunk) window.__uriTermChunk(id, b64); },
  termDone: (id, code) => { if (window.__uriTermDone) window.__uriTermDone(id, code); },
  shellData: (id, b64) => { if (window.__uriShellData) window.__uriShellData(id, b64); },
  shellClosed: (id, code) => { if (window.__uriShellClosed) window.__uriShellClosed(id, code); },
  lspData: (id, b64) => { if (window.__uriLspData) window.__uriLspData(id, b64); },
  lspError: (id, b64) => { if (window.__uriLspError) window.__uriLspError(id, b64); },
  lspClosed: (id, code) => { if (window.__uriLspClosed) window.__uriLspClosed(id, code); },
  httpDone: (id, status, b64) => { if (window.__uriHttpDone) window.__uriHttpDone(id, status, b64); }
});
