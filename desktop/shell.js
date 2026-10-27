// Re-export shell management from FileAPI for clarity.
const { FileAPI } = require('./fileapi');

class ShellManager {
  constructor(fileAPI) {
    this.fileAPI = fileAPI;
  }
  startShell(id, relCwd, mainWindow) {
    // Delegate to fileAPI which manages processes; mainWindow used for callbacks
    return this.fileAPI.startShell(id, relCwd);
  }
  sendToShell(id, base64) {
    return this.fileAPI.sendToShell(id, base64);
  }
  stopShell(id) {
    return this.fileAPI.stopShell(id);
  }
  stopAll() {
    for (const id of [...this.fileAPI.shellProcesses.keys()]) {
      this.fileAPI.stopShell(id);
    }
  }
}

module.exports = { ShellManager };
