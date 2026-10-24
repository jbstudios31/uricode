# Uri Code — Roadmap de tareas pendientes

## T1: Multi-root workspaces (prioridad alta)
- Permitir añadir/quitar carpetas raíz al explorador.
- Persistir lista de raíces en localStorage.
- Renderizar cada raíz como sección colapsable.
- Comando "Agregar carpeta al workspace" (ruta por texto).
Aceptación: se pueden abrir 2+ carpetas y navegarlas.

## T2: Infraestructura LSP (prioridad media)
- Crear editor-web/js/lsp.js con cliente LSP mínimo (JSON-RPC sobre stdio/WebSocket).
- Interfaz para registrar servidores por lenguaje.
- Conectar a Monaco (completion, hover, diagnostics) vía adaptador.
- Por ahora: mock local que delega a Monaco built-in para JS/TS.
Aceptación: módulo cargable, API documentada, sin romper la app.

## T3: Debug Adapter Protocol (prioridad media)
- Crear editor-web/js/debug.js con DAP client skeleton.
- UI: panel de debug (breakpoints, variables, call stack) placeholder.
- Comandos: start/stop/step/continue, toggle breakpoint.
Aceptación: módulo cargable, breakpoints se guardan en localStorage, UI no rompe.

## T4: Sistema de extensiones (prioridad baja)
- Crear editor-web/js/extensions.js con loader de extensiones (manifest + entry).
- Registro de comandos/contribuciones.
- Carpeta de extensiones en assets/extensions/.
Aceptación: módulo cargable, carga una extensión de ejemplo.

## T5: Tests automatizados (prioridad media)
- Crear tests/ con smoke tests (node) para utilidades (langOf, buildMatcher).
- Documentar cómo ejecutar.
Aceptación: `npm test` (o node tests) corre sin errores.

## T6: Documentación
- Actualizar README con todas las features y atajos.
