/* Extensión de ejemplo de Uri Code.
 * Se registra en window.URI_EXTENSIONS (ver index.html) y se activa al arrancar.
 */
(function () {
  "use strict";
  window.URI_EXTENSIONS = window.URI_EXTENSIONS || [];
  window.URI_EXTENSIONS.push({
    id: "sample",
    name: "Extensión de ejemplo",
    version: "1.0.0",
    contributes: {
      commands: [{ id: "sample.hello", title: "Ejemplo: Saludar" }]
    },
    main: function (api) {
      api.registerCommand("sample.hello", function () {
        api.toast("¡Hola desde la extensión de ejemplo!");
      }, "Ejemplo: Saludar");
      return {
        deactivate: function () { api.toast("Extensión de ejemplo desactivada"); }
      };
    }
  });
})();
