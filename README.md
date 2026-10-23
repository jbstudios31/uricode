# Uri Code

Editor de código para Android con el aspecto y los atajos de VS Code.

## Características

- **Editor Monaco** (el motor de VS Code): resaltado, autocompletado, minimapa, buscar/reemplazar, varias pestañas.
- **Interfaz estilo VS Code**: barra de actividad, explorador con carpetas desplegables, editores abiertos, migas de pan, barra de estado (línea/columna, lenguaje, errores) y tema Dark+.
- **Barra de menús** (Archivo, Editar, Ver, Ir, Ayuda) en pantallas grandes y menú ☰ en el móvil; menú contextual en pestañas y archivos; barra lateral redimensionable.
- **Importar archivos** desde el almacenamiento del teléfono (menú Archivo o arrastrando y soltando) y **compartir** el archivo abierto.
- **Recientes** en la pantalla de bienvenida e insignia con los cambios sin guardar.
- **Ir a archivo** (`Ctrl+P`), **paleta de comandos** (`Ctrl+Shift+P` / `F1`), **ir a línea** (`Ctrl+G`).
- **Buscar en archivos** (`Ctrl+Shift+F`) con mayúsculas y expresiones regulares.
- **Menú contextual** en el explorador (mantén pulsado o pulsa «⋯»): nuevo, renombrar, eliminar.
- **Guardado automático**, también al salir de la app, y restauración de pestañas al reabrir.
- **Pensado para móvil**: barra lateral deslizante, barra de teclas extra (`Tab { } ( ) [ ] ; …`), botón «atrás» que cierra paneles.
- **Chat IA con NVIDIA NIM**: pregunta sobre el archivo o la selección, y copia, inserta o reemplaza el código de las respuestas.
- Sin conexión usa un editor de texto básico (sin resaltado).

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
│   └── js/ icons.js · api.js · editor.js · nim-chat.js · app.js
├── build.sh                # genera uri-code.apk
└── README.md
```

## Compilar e instalar

Desde Termux:

```bash
pkg install openjdk-17 aapt2 dx apksigner curl zip unzip python
chmod +x build.sh
./build.sh
```

Genera `uri-code.apk`; instálalo en tu dispositivo. La primera vez descarga `android.jar` (puedes indicar uno propio con `ANDROID_JAR=/ruta/android.jar`). Necesita internet para cargar Monaco desde el CDN (queda en caché después).

> El paquete cambió a `ai.uricode.app`, así que se instala como app nueva, separada de MiEditor.

## Usar NVIDIA NIM

1. Abre **Ajustes** (engranaje) y pega tu API Key de NVIDIA NIM.
2. Opcional: cambia el modelo (por defecto `meta/llama-3.1-8b-instruct`).
3. Abre el **Chat IA**, escribe tu pregunta y envía. Las peticiones se hacen desde Java, sin problemas de CORS.

La clave se guarda solo en el almacenamiento local de la app.
