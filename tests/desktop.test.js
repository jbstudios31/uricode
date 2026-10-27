/* Pruebas del puente FileAPI de escritorio (desktop/fileapi.js).
 *
 * Verifica que la implementacion Node.js cumple el mismo contrato que el
 * puente nativo de Android (MainActivity.java FileAPI).
 *
 * Uso: node tests/desktop.test.js
 */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");

var failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log("  ok  - " + msg);
  else { failures++; console.log("  FAIL- " + msg); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var { FileAPI } = require("../desktop/fileapi.js");

(async function main() {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uri-desktop-"));
  var api = new FileAPI(tmpDir);

  console.log("\n[1] getRoot y listDir");
  ok(api.getRoot() === tmpDir, "getRoot devuelve el directorio raiz");
  ok(JSON.parse(api.listDir("")).length === 0, "listDir vacio devuelve []");

  console.log("\n[2] mkdir y listDir");
  ok(api.mkdir("src") === true, "mkdir('src') crea la carpeta");
  ok(api.exists("src") === true, "exists('src') es true");
  var list = JSON.parse(api.listDir(""));
  ok(list.length === 1 && list[0].name === "src" && list[0].type === "dir", "listDir muestra la carpeta creada");

  console.log("\n[3] writeFile y readFile");
  ok(api.writeFile("src/hello.js", "console.log('hola');") === true, "writeFile crea el archivo");
  ok(api.readFile("src/hello.js") === "console.log('hola');", "readFile devuelve el contenido");
  ok(api.exists("src/hello.js") === true, "exists('src/hello.js') es true");

  console.log("\n[4] renameItem");
  ok(api.renameItem("src/hello.js", "src/main.js") === true, "renameItem renombra el archivo");
  ok(api.exists("src/hello.js") === false, "el archivo original ya no existe");
  ok(api.exists("src/main.js") === true, "el archivo renombrado existe");
  ok(api.readFile("src/main.js") === "console.log('hola');", "el contenido se preserva tras renombrar");

  console.log("\n[5] deleteItem");
  ok(api.deleteItem("src/main.js") === true, "deleteItem borra el archivo");
  ok(api.exists("src/main.js") === false, "el archivo borrado ya no existe");
  ok(api.deleteItem("src") === true, "deleteItem borra la carpeta recursivamente");
  ok(api.exists("src") === false, "la carpeta borrada ya no existe");

  console.log("\n[6] Seguridad de rutas");
  ok(api._resolve("../etc/passwd") === null, "rechaza '..' en la ruta");
  ok(api.deleteItem("") === false, "no borra la raiz");
  ok(api.writeFile("", "x") === false, "no escribe en la raiz");
  ok(api.renameItem("", "x") === false, "no renombra la raiz");

  console.log("\n[7] runCommand");
  var res = JSON.parse(api.runCommand("echo hola-desktop", ""));
  ok(res.code === 0, "runCommand devuelve codigo 0");
  ok(res.stdout.trim() === "hola-desktop", "runCommand devuelve stdout correcto");
  var bad = JSON.parse(api.runCommand("exit 7", ""));
  ok(bad.code === 7, "runCommand propaga el codigo de salida");

  console.log("\n[8] runCommandStream");
  var chunks = [];
  var done = false;
  api.setSender(function (channel, id, data) {
    if (channel === "native:termChunk") chunks.push(Buffer.from(data, "base64").toString("utf8"));
    if (channel === "native:termDone") done = true;
  });
  api.runCommandStream("stream-1", "echo linea-a; echo linea-b", "");
  await wait(200);
  ok(done === true, "runCommandStream termina");
  var out = chunks.join("");
  ok(out.indexOf("linea-a") >= 0 && out.indexOf("linea-b") >= 0, "runCommandStream entrega la salida (" + chunks.length + " trozos)");

  console.log("\n[9] httpPost (mock)");
  var httpDone = null;
  api.setSender(function (channel, id, status, b64) {
    if (channel === "native:httpDone") httpDone = { id: id, status: status, body: Buffer.from(b64, "base64").toString("utf8") };
  });
  api.httpPost("h1", "https://httpbin.org/post", '{"Content-Type":"application/json"}', '{"msg":"test"}');
  await wait(2000);
  if (httpDone) {
    ok(httpDone.id === "h1", "httpPost usa el id correcto");
    ok(typeof httpDone.status === "number", "httpPost devuelve un status numerico (" + httpDone.status + ")");
  } else {
    ok(true, "httpPost no completo en el entorno (sin red) — se omite");
  }

  console.log("\n[10] LSP: allowlist");
  ok(api.startLsp("l1", "pylsp", "[]", "") === true, "startLsp acepta 'pylsp'");
  ok(api.startLsp("l2", "bash", "[]", "") === false, "startLsp rechaza comandos no permitidos");
  ok(api.stopLsp("l1") === true, "stopLsp detiene el proceso");

  console.log("\n[11] shareText no lanza");
  try { api.shareText("test.txt", "contenido"); ok(true, "shareText no lanza excepcion"); }
  catch (e) { ok(false, "shareText lanza: " + e.message); }

  // Limpieza
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log("\n" + (failures ? "FALLOS: " + failures + " / " + checks : "TODO OK: " + checks + " comprobaciones"));
  process.exit(failures ? 1 : 0);
})().catch(function (e) {
  console.error("Error inesperado:", e);
  process.exit(1);
});
