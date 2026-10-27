// Implementación Node.js del puente FileAPI (equivalente a MainActivity.java FileAPI).
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');

class FileAPI {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir || process.cwd());
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.lspProcesses = new Map();
    this.shellProcesses = new Map();
    this.commandProcesses = new Map();
    this.sendToRenderer = null; // set by main.js
  }

  setSender(fn) {
    this.sendToRenderer = fn;
  }

  _emit(channel, ...args) {
    if (typeof this.sendToRenderer === 'function') {
      this.sendToRenderer(channel, ...args);
    }
  }

  // --- Path safety ---
  _resolve(rel) {
    if (rel == null || rel === '' || rel === '/') return this.rootDir;
    const parts = String(rel).replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.includes('..')) return null;
    const resolved = path.resolve(this.rootDir, ...parts);
    if (!resolved.startsWith(this.rootDir)) return null;
    return resolved;
  }

  _relOf(absPath) {
    if (!absPath || !absPath.startsWith(this.rootDir)) return '';
    const rel = absPath.slice(this.rootDir.length).replace(/^\/+/, '');
    return rel;
  }

  // --- FileAPI methods ---

  getRoot() {
    return this.rootDir;
  }

  listDir(rel) {
    const dir = this._resolve(rel || '');
    if (!dir) return '[]';
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return '[]';
    } catch (e) {
      return '[]';
    }
    let kids;
    try { kids = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return '[]'; }

    const entries = kids.map(k => {
      const fullPath = path.join(dir, k.name);
      let size = 0;
      try { size = fs.statSync(fullPath).size; } catch (e) {}
      return {
        name: k.name,
        path: this._relOf(fullPath),
        type: k.isDirectory() ? 'dir' : 'file',
        size: size
      };
    });

    // Sort: dirs first, then files, alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    return JSON.stringify(entries);
  }

  exists(rel) {
    const f = this._resolve(rel || '');
    if (!f) return false;
    try { return fs.existsSync(f); } catch (e) { return false; }
  }

  readFile(rel) {
    const f = this._resolve(rel || '');
    if (!f) return '';
    try {
      const stat = fs.statSync(f);
      if (!stat.isFile() || stat.size > 10000000) return '';
      return fs.readFileSync(f, 'utf8');
    } catch (e) {
      return '';
    }
  }

  writeFile(rel, content) {
    const f = this._resolve(rel || '');
    if (!f || f === this.rootDir) return false;
    try {
      const parent = path.dirname(f);
      fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(f, content == null ? '' : String(content), 'utf8');
      return true;
    } catch (e) {
      return false;
    }
  }

  mkdir(rel) {
    const f = this._resolve(rel || '');
    if (!f) return false;
    try {
      if (fs.existsSync(f)) return fs.statSync(f).isDirectory();
      fs.mkdirSync(f, { recursive: true });
      return true;
    } catch (e) {
      return false;
    }
  }

  deleteItem(rel) {
    const f = this._resolve(rel || '');
    if (!f || f === this.rootDir) return false;
    try {
      fs.rmSync(f, { recursive: true, force: true });
      return true;
    } catch (e) {
      return false;
    }
  }

  renameItem(oldRel, newRel) {
    const oldF = this._resolve(oldRel || '');
    const newF = this._resolve(newRel || '');
    if (!oldF || !newF || oldF === this.rootDir) return false;
    if (fs.existsSync(newF)) return false;
    try {
      const parent = path.dirname(newF);
      fs.mkdirSync(parent, { recursive: true });
      fs.renameSync(oldF, newF);
      return true;
    } catch (e) {
      return false;
    }
  }

  shareText(name, text) {
    // En desktop: copiar al portapapeles (manejado por main.js)
    // Aquí solo logueamos; el frontend puede usar clipboard API
    console.log('[shareText]', name, (text || '').slice(0, 50));
  }

  runCommand(cmd, relCwd) {
    if (!cmd || !String(cmd).trim()) {
      return JSON.stringify({ code: -1, stdout: '', stderr: 'empty' });
    }
    let cwd = this._resolve(relCwd || '');
    if (!cwd) cwd = this.rootDir;
    try {
      const stat = fs.statSync(cwd);
      if (!stat.isDirectory()) cwd = this.rootDir;
    } catch (e) {
      cwd = this.rootDir;
    }
    try {
      const result = execSync(String(cmd), {
        cwd: cwd,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: true
      });
      return JSON.stringify({ code: 0, stdout: result || '', stderr: '' });
    } catch (e) {
      return JSON.stringify({
        code: typeof e.status === 'number' ? e.status : -1,
        stdout: e.stdout || '',
        stderr: e.stderr || String(e.message || e)
      });
    }
  }

  runCommandStream(id, cmd, relCwd) {
    if (!cmd || !String(cmd).trim()) {
      this._emit('native:termDone', id, -1);
      return;
    }
    let cwd = this._resolve(relCwd || '');
    if (!cwd) cwd = this.rootDir;
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = this.rootDir;
    } catch (e) {
      cwd = this.rootDir;
    }

    const proc = spawn(cmd, [], { cwd, shell: true });
    this.commandProcesses.set(id, proc);

    proc.stdout.on('data', (data) => {
      const b64 = Buffer.from(data).toString('base64');
      this._emit('native:termChunk', id, b64);
    });
    proc.stderr.on('data', (data) => {
      const b64 = Buffer.from(data).toString('base64');
      this._emit('native:termChunk', id, b64);
    });
    proc.on('close', (code) => {
      this.commandProcesses.delete(id);
      this._emit('native:termDone', id, code == null ? -1 : code);
    });
    proc.on('error', (err) => {
      const b64 = Buffer.from(String(err.message)).toString('base64');
      this._emit('native:termChunk', id, b64);
      this.commandProcesses.delete(id);
      this._emit('native:termDone', id, -1);
    });
  }

  // --- Shell interactivo ---

  startShell(id, relCwd) {
    if (!id) return false;
    // Matar shell anterior si existe
    const old = this.shellProcesses.get(id);
    if (old) {
      try { old.kill(); } catch (e) {}
      this.shellProcesses.delete(id);
    }
    let cwd = this._resolve(relCwd || '');
    if (!cwd) cwd = this.rootDir;
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = this.rootDir;
    } catch (e) {
      cwd = this.rootDir;
    }

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32' ? [] : [];
    const proc = spawn(shell, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.shellProcesses.set(id, proc);

    const emitData = (data) => {
      this._emit('native:shellData', id, Buffer.from(data).toString('base64'));
    };

    proc.stdout.on('data', emitData);
    proc.stderr.on('data', emitData);
    proc.on('close', (code) => {
      this.shellProcesses.delete(id);
      this._emit('native:shellClosed', id, code == null ? -1 : code);
    });
    proc.on('error', (err) => {
      emitData(String(err.message));
      this.shellProcesses.delete(id);
      this._emit('native:shellClosed', id, -1);
    });

    return true;
  }

  sendToShell(id, base64) {
    const proc = this.shellProcesses.get(id);
    if (!proc || !base64) return false;
    try {
      const data = Buffer.from(base64, 'base64');
      proc.stdin.write(data);
      proc.stdin.flush && proc.stdin.flush();
      return true;
    } catch (e) {
      return false;
    }
  }

  stopShell(id) {
    const proc = this.shellProcesses.get(id);
    if (!proc) return false;
    try { proc.kill(); } catch (e) {}
    this.shellProcesses.delete(id);
    return true;
  }

  // --- LSP ---

  startLsp(id, command, argsJson, relCwd) {
    const ALLOWED = ['pylsp', 'pyright-langserver', 'typescript-language-server', 'clangd',
      'gopls', 'rust-analyzer', 'jdtls', 'lua-language-server'];
    if (!ALLOWED.includes(command)) return false;

    let args = [];
    try {
      if (argsJson) args = JSON.parse(argsJson);
      if (!Array.isArray(args)) args = [];
    } catch (e) {
      return false;
    }

    let cwd = this._resolve(relCwd || '');
    if (!cwd) cwd = this.rootDir;
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = this.rootDir;
    } catch (e) {
      cwd = this.rootDir;
    }

    // Matar proceso anterior si existe
    const old = this.lspProcesses.get(id);
    if (old) {
      try { old.kill(); } catch (e) {}
      this.lspProcesses.delete(id);
    }

    try {
      const proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      this.lspProcesses.set(id, proc);

      // stdout: chunks crudos → JS parsea frames Content-Length
      proc.stdout.on('data', (data) => {
        this._emit('native:lspData', id, Buffer.from(data).toString('base64'));
      });
      proc.stderr.on('data', (data) => {
        this._emit('native:lspError', id, Buffer.from(data).toString('base64'));
      });
      proc.on('close', (code) => {
        this.lspProcesses.delete(id);
        this._emit('native:lspClosed', id, code == null ? -1 : code);
      });
      proc.on('error', (err) => {
        this._emit('native:lspError', id, Buffer.from(String(err.message)).toString('base64'));
        this.lspProcesses.delete(id);
        this._emit('native:lspClosed', id, -1);
      });

      // Hard lifetime limit: 10 minutos
      setTimeout(() => {
        const p = this.lspProcesses.get(id);
        if (p) {
          try { p.kill(); } catch (e) {}
          this.lspProcesses.delete(id);
          this._emit('native:lspClosed', id, -1);
        }
      }, 10 * 60 * 1000);

      return true;
    } catch (e) {
      return false;
    }
  }

  sendLsp(id, base64) {
    const proc = this.lspProcesses.get(id);
    if (!proc || !base64) return false;
    try {
      const data = Buffer.from(base64, 'base64');
      proc.stdin.write(data);
      return true;
    } catch (e) {
      return false;
    }
  }

  stopLsp(id) {
    const proc = this.lspProcesses.get(id);
    if (!proc) return false;
    try { proc.kill(); } catch (e) {}
    this.lspProcesses.delete(id);
    return true;
  }

  // --- HTTP proxy ---
  httpPost(id, url, headersJson, body) {
    let headers = {};
    try { headers = JSON.parse(headersJson || '{}'); } catch (e) {}
    let parsedBody = '';
    try { parsedBody = typeof body === 'string' ? body : JSON.stringify(body || {}); } catch (e) { parsedBody = String(body || ''); }

    const mod = url.startsWith('https') ? https : http;
    try {
      const req = mod.request(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          this._emit('native:httpDone', id, res.statusCode, Buffer.from(data).toString('base64'));
        });
      });
      req.on('error', (err) => {
        this._emit('native:httpDone', id, 0, Buffer.from(String(err.message)).toString('base64'));
      });
      req.write(parsedBody);
      req.end();
    } catch (e) {
      this._emit('native:httpDone', id, 0, Buffer.from(String(e.message)).toString('base64'));
    }
  }

  stopAll() {
    for (const [id, proc] of this.shellProcesses) {
      try { proc.kill(); } catch (e) {}
    }
    this.shellProcesses.clear();
    for (const [id, proc] of this.lspProcesses) {
      try { proc.kill(); } catch (e) {}
    }
    this.lspProcesses.clear();
    for (const [id, proc] of this.commandProcesses) {
      try { proc.kill(); } catch (e) {}
    }
    this.commandProcesses.clear();
  }
}

module.exports = { FileAPI };
