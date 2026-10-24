# Uri Code

Editor de código para Android con el aspecto y los atajos de VS Code.

## Características

### Editor
- **Editor Monaco** (el motor de VS Code) **incluido offline** en el APK; si falta, se recurre al CDN.
- **IntelliSense**: autocompletado de variables y símbolos, sugerencias de todos los documentos abiertos, cierre automático de llaves y comillas, pistas de parámetros.
- Resaltado de sintaxis, minimapa, buscar/reemplazar, varias pestañas, folding, aparejamiento de corchetes.
- **Formateo** con Prettier (JS/TS, JSON, HTML, CSS, Markdown, YAML, GraphQL).
- **Snippets** con tab-stops (`$1`, `${1:valor}`) y salto entre ellos con `Tab`.

### Interfaz
- Estilo VS Code: barra de actividad, explorador, pestañas, migas de pan, barra de estado, menús y paleta de comandos.
- **Tema oscuro (Dark+) y claro (Light+)** seleccionables en Ajustes.
- Botones, scrollbars, estados hover/active y menús con el aspecto de VS Code.
- Barra lateral redimensionable, barra de teclas extra para móvil, botón «atrás» que cierra paneles.

### Herramientas
- **Terminal real** (xterm.js) con salida en streaming, historial con ↑/↓, `cd` persistente y `clear`.
- **Control de versiones**: estado, log, diff, diff visual por archivo (Monaco Diff Editor), pull, push y commit.
- **Búsqueda y reemplazo global** en todos los archivos, con mayúsculas y expresiones regulares.
- **Panel de problemas** clickeable (navega al archivo y la línea).
- **Vista de depuración** (DAP) con puntos de interrupción en el margen del editor.
- **Chat IA con NVIDIA NIM** con contexto del archivo, inserta o reemplaza código, y botón «Probar conexión IA».
- **Workspace multi-raíz**: varias carpetas en el explorador.
- **Sistema de extensiones** (`editor-web/extensions/`) con registro de comandos.
- Importar archivos desde el almacenamiento del teléfono, compartir el archivo abierto, recientes y autoguardado.

## Estructura

```
UriCode/
├── android_app/            # App Android (WebView + FileAPI nativo)
│   ├── AndroidManifest.xml
│   ├── res/
│   └── src/ai/uricode/app/MainActivity.java
├── editor-web/             # Interfaz del editor
│   ├── index.html
│   ├── css/style.css
│   ├── extensions/         # Extensiones (ejemplo: sample.js)
│   ├── vendor/monaco/      # Monaco offline
│   └── js/ icons.js · api.js · editor.js · nim-chat.js · lsp.js · debug.js · extensions.js · app.js
├── tests/                  # smoke.js, runtime.test.js, features.test.js, dom.js, native-mock.js
├── build.sh                # genera uri-code.apk
└── README.md
```

## Compilar e instalar

Desde Termux:

```bash
pkg install openjdk-17 aapt2 dx apksigner curl zip unzip python
bash build.sh
```

> En `/storage` no se puede ejecutar directamente: usa `bash build.sh`, no `./build.sh`.

Genera `uri-code.apk`; instálalo en tu dispositivo. La primera vez descarga `android.jar` (puedes indicar uno propio con `ANDROID_JAR=/ruta/android.jar`).

## Tests

```bash
npm test              # todo
npm run test:smoke    # sintaxis, carga de modulos y recursos
npm run test:runtime  # arranque de la app en un DOM simulado
```

- **`tests/smoke.js`**: comprueba la sintaxis de todos los scripts, carga los módulos `UriExtensions`, `UriLSP` y `UriDebug`, valida el orden de carga de los scripts y los recursos de la interfaz. Además hace un análisis estático que detecta llamadas a funciones inexistentes en cada archivo.
- **`tests/runtime.test.js`**: ejecuta la app completa en un DOM simulado (`tests/dom.js`) y comprueba que arranca sin excepciones, que el workspace multi-raíz se dibuja y que las APIs de archivos, extensiones, depuración y LSP responden.
- **`tests/chat.test.js`**: prueba el flujo completo del chat IA (NIM): apertura desde la barra de actividad, envío con contexto del archivo, respuesta, error HTTP y botón «Probar conexión IA».
- **`tests/features.test.js`**: prueba las funciones con el puente nativo simulado (`tests/native-mock.js`, mismo contrato que `MainActivity.java`): buscar, reemplazar en todos los archivos, terminal con salida y streaming, y el puente HTTP del chat IA (NVIDIA NIM).

> El banco de pruebas permite detectar errores en tiempo de ejecución sin un dispositivo Android.

## Atajos principales

| Atajo | Acción |
|---|---|
| `Ctrl+P` | Ir a archivo |
| `Ctrl+Shift+P` / `F1` | Paleta de comandos |
| `Ctrl+G` | Ir a línea |
| `Ctrl+Shift+F` | Buscar en archivos |
| `Ctrl+S` | Guardar |
| `Ctrl+B` | Mostrar/ocultar barra lateral |
| `Ctrl+``  | Terminal |

## Releases

https://github.com/jbstudios31/uricode/releases

## Usar NVIDIA NIM

1. Abre **Ajustes** (engranaje) y pega tu API Key de NVIDIA NIM.
2. Opcional: cambia el modelo (por defecto `meta/llama-3.1-8b-instruct`).
3. Abre el **Chat IA**, escribe tu pregunta y envía. Las peticiones se hacen desde Java, sin problemas de CORS.

La clave se guarda solo en el almacenamiento local de la app.

## Notas de seguridad

- El acceso a archivos está limitado a la carpeta interna `filesDir/projects` de la app (sandbox), con rechazo de rutas que escapan de ella y de enlaces simbólicos.
- Las peticiones HTTP del chat se validan en Java: solo `http/https`, sin hosts privados, con límites de tamaño.
