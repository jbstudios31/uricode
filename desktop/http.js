const { FileAPI } = require('./fileapi');

class HttpProxy {
  constructor(fileAPI) {
    this.fileAPI = fileAPI;
  }
  httpPost(id, url, headersJson, body, mainWindow) {
    return this.fileAPI.httpPost(id, url, headersJson, body);
  }
}

module.exports = { HttpProxy };
