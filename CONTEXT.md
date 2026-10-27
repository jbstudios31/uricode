# Uri Code — Contexto del proyecto

## Que es
Editor de codigo para Android con aspecto de VS Code. App Android (WebView + FileAPI nativo en Java) + interfaz web (Monaco editor).

## Repositorio
- GitHub: https://github.com/jbstudios31/uricode (publico, branch master)
- Ultima release: v3.5.2 → https://github.com/jbstudios31/uricode/releases/tag/v3.5.2
- APK: uri-code.apk (3MB, empaqueta Monaco + xterm offline)

## Entorno
- Android/Termux. Proyecto original en /storage/emulated/0/UriCode.
- Herramientas: aapt2, javac, dx, apksigner, keytool, zip, unzip, curl, python3, node, gh.
- /storage es noexec: ejecutar `bash build.sh`, nunca `./build.sh`.
- Verificacion JS: `node --check`. Tests: `npm test` (9 suites, 295 checks).
- adb disponible pero sin dispositivos conectados (no se puede probar en runtime).

## Credenciales
- gh autenticado como jbstudios31 (scopes repo).
- git identity local: jbstudios31 / jbstudios31@users.noreply.github.com.
- Token Netlify: nfp_zjmiN3iVVVP6GYdLimZjCJmD5UyCfUJT4cbf (para PWA GT3, no para UriCode).

## App de escritorio (Linux)
- Ubicacion: desktop/
- Tecnologia: Electron (main.js + preload.js + fileapi.js en Node.js)
- FileAPI implementado en Node.js (mismo contrato que MainActivity.java)
- Shell interactivo, LSP, HTTP proxy, todo via child_process
- Build: `cd desktop && npm install && npm run build:linux` (AppImage + .deb)
- Desarrollo: `cd desktop && npm start`
- Tests: `node tests/desktop.test.js` (31 checks)

## Estructura
```
Uri/
├── android_app/            # App Android (WebView + FileAPI nativo)
│   ├── AndroidManifest.xml
│   ├── res/
│   └── src/ai/uricode/app/MainActivity.java
├── editor-web/             # Interfaz del editor
│   ├── index.html
│   ├── css/style.css
│   ├── extensions/         # Extensiones (ejemplo: sample.js)
│   ├── vendor/monaco/      # Monaco offline (13MB)
│   ├── vendor/xterm/       # xterm offline
│   └── js/ icons.js · api.js · editor.js · nim-chat.js · lsp.js · debug.js · extensions.js · app.js
├── tests/                  # smoke.js, runtime.test.js, features.test.js, panels.test.js, chat.test.js, cursor.test.js, git.test.js, settings.test.js, mobile.test.js, lsp.test.js, dom.js, native-mock.js
├── build.sh                # genera uri-code.apk
├── package.json
├── README.md
├── TASKS.md
└── CONTEXT.md (este archivo)
```

## Features implementadas
### Editor
- Monaco offline empaquetado en APK (fallback CDN)
- IntelliSense: autocompletado, cierre automatico, snippets con tab-stops
- Prettier, formateo on-save, minimapa, folding, bracket matching
- Multi-cursor (Ctrl+Alt+Up/Down, Ctrl+D, Ctrl+Shift+L), ir a llave correspondiente
- Tema oscuro (Dark+) y claro (Light+)

### Herramientas
- Terminal real (xterm.js) con streaming nativo, cd persistente, historial
- Git Source Control: stage/unstage, descarte, ramas, commit, sync, diff
- Diff visual Monaco (archivo vs HEAD)
- Paneles PROBLEMAS y OUTPUT
- Busqueda y reemplazo global
- Chat IA (NVIDIA NIM) con test de conexion
- Workspace multi-raiz
- Sistema de extensiones
- LSP real: puente nativo con allowlist de servidores, framing Content-Length, diagnosticos en vivo
- DAP debug con breakpoints visuales
- Ajustes buscables por categorias
- Atajos reconfigurables

### Movil
- Deshacer al eliminar (captura y restauracion)
- Terminal bottom-sheet, toggle barra de teclas
- Swipe en bordes para barra lateral
- Pantalla de bienvenida con recientes

## Banco de pruebas
- tests/dom.js: DOM simulado (sandbox vm)
- tests/native-mock.js: mock del puente nativo (FileAPI, mismo contrato que MainActivity.java)
- 9 suites: smoke(50), runtime(24), features(25), panels(23), chat(17), cursor(20), git(28), settings(14), mobile(42), lsp(52)
- Total: 295 comprobaciones, todas en verde

## Bugs reales encontrados y corregidos
1. Crash de arranque: Chat.init llamaba refresh() antes de init() → getSettings() null
2. Reemplazo global no funcionaba: llamaba ask() inexistente (debía ser askConfirm)
3. Variables no definidas en rootRow (isDir, it)
4. Contexto vacío del chat: con selección vacía ahora envía el archivo abierto
5. Adaptadores LSP desalineados con los ids del editor

## Comandos utiles
- Compilar: `bash build.sh` (desde /storage/emulated/0/Uri)
- Tests: `npm test`
- Verificar JS: `node --check editor-web/js/app.js`
- Subir release: `gh release create vX.Y.Z uri-code.apk`

## Notas importantes
- /storage es noexec: usar `bash build.sh`, nunca `./build.sh`
- /tmp no escribible: usar /data/data/com.termux/files/usr/tmp/opencode
- adb disponible pero sin dispositivos conectados
- El WebView limpia cache al arrancar (clearCache(true)) para forzar recarga
- Monaco y xterm empaquetados offline en el APK

## Estado actual
- Ultima release: v3.5.2
- Todos los tests pasan (295 checks)
- APK compilado y subido a GitHub
- Trabajo pendiente: instalar servidores LSP reales en el telefono para que el LSP funcione (actualmente el bridge esta listo pero los servidores no estan incluidos en el APK por tamaño)
