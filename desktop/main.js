// Uri Code — proceso principal de Electron (Linux/macOS/Windows).
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { FileAPI } = require('./fileapi');
const { ShellManager } = require('./shell');
const { LspManager } = require('./lsp');
const { HttpProxy } = require('./http');

let mainWindow = null;
let fileAPI = null;
let shellManager = null;
let lspManager = null;
let httpProxy = null;

const ROOT_DIR = process.env.URI_ROOT || process.cwd();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'Uri Code',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'editor-web', 'index.html'));

  // Abrir DevTools en desarrollo
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC handlers (síncronos para compatibilidad con el contrato FileAPI) ---

function registerIpcHandlers() {
  // getRoot
  ipcMain.handle('fileapi:getRoot', () => fileAPI.getRoot());

  // listDir
  ipcMain.handle('fileapi:listDir', (_, rel) => fileAPI.listDir(rel));

  // exists
  ipcMain.handle('fileapi:exists', (_, rel) => fileAPI.exists(rel));

  // readFile
  ipcMain.handle('fileapi:readFile', (_, rel) => fileAPI.readFile(rel));

  // writeFile
  ipcMain.handle('fileapi:writeFile', (_, rel, content) => fileAPI.writeFile(rel, content));

  // mkdir
  ipcMain.handle('fileapi:mkdir', (_, rel) => fileAPI.mkdir(rel));

  // deleteItem
  ipcMain.handle('fileapi:deleteItem', (_, rel) => fileAPI.deleteItem(rel));

  // renameItem
  ipcMain.handle('fileapi:renameItem', (_, oldRel, newRel) => fileAPI.renameItem(oldRel, newRel));

  // shareText
  ipcMain.handle('fileapi:shareText', (_, name, text) => {
    fileAPI.shareText(name, text, mainWindow);
    return true;
  });

  // runCommand
  ipcMain.handle('fileapi:runCommand', (_, cmd, relCwd) => fileAPI.runCommand(cmd, relCwd));

  // runCommandStream
  ipcMain.handle('fileapi:runCommandStream', (_, id, cmd, relCwd) => {
    fileAPI.runCommandStream(id, cmd, relCwd, mainWindow);
    return true;
  });

  // startShell
  ipcMain.handle('fileapi:startShell', (_, id, relCwd) => shellManager.startShell(id, relCwd, mainWindow));

  // sendToShell
  ipcMain.handle('fileapi:sendToShell', (_, id, base64) => shellManager.sendToShell(id, base64));

  // stopShell
  ipcMain.handle('fileapi:stopShell', (_, id) => shellManager.stopShell(id));

  // startLsp
  ipcMain.handle('fileapi:startLsp', (_, id, command, argsJson, relCwd) =>
    lspManager.startLsp(id, command, argsJson, relCwd, mainWindow));

  // sendLsp
  ipcMain.handle('fileapi:sendLsp', (_, id, base64) => lspManager.sendLsp(id, base64));

  // stopLsp
  ipcMain.handle('fileapi:stopLsp', (_, id) => lspManager.stopLsp(id));

  // httpPost
  ipcMain.handle('fileapi:httpPost', (_, id, url, headersJson, body) => {
    httpProxy.httpPost(id, url, headersJson, body, mainWindow);
    return true;
  });

  // Diálogos nativos
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName
    });
    return result.canceled ? null : result.filePath;
  });

  // Clipboard
  ipcMain.handle('clipboard:write', (_, text) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
}

// --- Menú nativo ---
function createMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo archivo', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu:newFile') },
        { label: 'Abrir archivo...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu:openFile') },
        { label: 'Abrir carpeta...', accelerator: 'CmdOrCtrl+K CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu:openFolder') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu:save') },
        { label: 'Guardar como...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu:saveAs') },
        { type: 'separator' },
        { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { label: 'Buscar', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu:find') },
        { label: 'Reemplazar', accelerator: 'CmdOrCtrl+H', click: () => mainWindow.webContents.send('menu:replace') }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Paleta de comandos', accelerator: 'CmdOrCtrl+Shift+P', click: () => mainWindow.webContents.send('menu:commandPalette') },
        { label: 'Explorador', accelerator: 'CmdOrCtrl+Shift+E', click: () => mainWindow.webContents.send('menu:explorer') },
        { label: 'Buscar en archivos', accelerator: 'CmdOrCtrl+Shift+F', click: () => mainWindow.webContents.send('menu:search') },
        { label: 'Control de versiones', accelerator: 'CmdOrCtrl+Shift+G', click: () => mainWindow.webContents.send('menu:git') },
        { type: 'separator' },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+`', click: () => mainWindow.webContents.send('menu:terminal') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
        { role: 'forceReload' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Acerca de Uri Code', click: () => mainWindow.webContents.send('menu:about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  fileAPI = new FileAPI(ROOT_DIR);
  fileAPI.setSender((channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  });
  shellManager = new ShellManager(fileAPI);
  lspManager = new LspManager(fileAPI);
  httpProxy = new HttpProxy(fileAPI);

  registerIpcHandlers();
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (shellManager) shellManager.stopAll();
  if (lspManager) lspManager.stopAll();
});
