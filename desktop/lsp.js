const { FileAPI } = require('./fileapi');

class LspManager {
  constructor(fileAPI) {
    this.fileAPI = fileAPI;
  }
  startLsp(id, command, argsJson, relCwd, mainWindow) {
    return this.fileAPI.startLsp(id, command, argsJson, relCwd);
  }
  sendLsp(id, base64) {
    return this.fileAPI.sendLsp(id, base64);
  }
  stopLsp(id) {
    return this.fileAPI.stopLsp(id);
  }
  stopAll() {
    for (const id of [...this.fileAPI.lspProcesses.keys()]) {
      this.fileAPI.stopLsp(id);
    }
  }
}

module.exports = { LspManager };
