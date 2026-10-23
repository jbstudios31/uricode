/* Iconos de interfaz (estilo codicon) e iconos de archivo (estilo VS Code) */
(function () {
  "use strict";

  var UI = {
    "files": '<path d="M8 3h7l4 4v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4"/><path d="M5 7v13a1 1 0 0 0 1 1h9"/>',
    "search": '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
    "sparkle": '<path d="M11 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 3v4M17 5h4"/>',
    "gear": '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
    "menu": '<path d="M4 6h16M4 12h16M4 18h16"/>',
    "close": '<path d="M6 6l12 12M18 6L6 18"/>',
    "chevron-right": '<path d="M9 6l6 6-6 6"/>',
    "chevron-down": '<path d="M6 9l6 6 6-6"/>',
    "new-file": '<path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M13 3v5h5"/><path d="M12 12v6M9 15h6"/>',
    "new-folder": '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 11v6M9 14h6"/>',
    "refresh": '<path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 4v7h-7"/>',
    "collapse": '<path d="M7 4l5 5 5-5M7 20l5-5 5 5"/>',
    "save": '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    "terminal": '<path d="M5 7l5 5-5 5M12 18h7"/>',
    "git": '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.5 6h3.5a2 2 0 0 1 2 2v2"/>',
    "send": '<path d="M4 12L20 4l-6 16-3-7z"/>',
    "trash": '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    "edit": '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    "more": '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    "error": '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
    "warning": '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17.5v.5"/>'
  };

  function svg(name, size) {
    size = size || 16;
    return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (UI[name] || "") + '</svg>';
  }

  function badge(bg, label, fg, fontSize) {
    return '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="2.5" fill="' + bg + '"/>' +
      '<text x="8" y="11.2" text-anchor="middle" font-size="' + (fontSize || 7.5) + '" font-weight="700" ' +
      'font-family="Segoe UI,Roboto,Arial,sans-serif" fill="' + fg + '">' + label + '</text></svg>';
  }

  var GENERIC = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="#c5c5c5" stroke-width="1" stroke-linejoin="round"/><path d="M9.5 1.5v3h3" fill="none" stroke="#c5c5c5" stroke-width="1" stroke-linejoin="round"/></svg>';
  var IMAGE = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="#26a269"/><circle cx="5.2" cy="6.2" r="1.2" fill="#fff"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3z" fill="#fff"/></svg>';

  var BY_EXT = {
    js: badge("#f1dd35", "JS", "#2b2b2b"), mjs: badge("#f1dd35", "JS", "#2b2b2b"), cjs: badge("#f1dd35", "JS", "#2b2b2b"),
    jsx: badge("#20c2ef", "JSX", "#10242b", 6.2),
    ts: badge("#3178c6", "TS", "#ffffff"), tsx: badge("#3178c6", "TSX", "#ffffff", 6.2),
    py: badge("#3776ab", "PY", "#ffd43b"),
    html: badge("#e44d26", "&lt;&gt;", "#ffffff", 7), htm: badge("#e44d26", "&lt;&gt;", "#ffffff", 7),
    css: badge("#42a5f5", "#", "#0d2a40", 9), scss: badge("#cd6799", "S", "#ffffff", 9), less: badge("#2b4c80", "L", "#ffffff", 9),
    json: badge("#cbcb41", "{}", "#2b2b2b", 8), jsonc: badge("#cbcb41", "{}", "#2b2b2b", 8),
    md: badge("#519aba", "M", "#ffffff", 9), markdown: badge("#519aba", "M", "#ffffff", 9),
    java: badge("#cc3e44", "J", "#ffffff", 9), kt: badge("#a97bff", "K", "#ffffff", 9), kts: badge("#a97bff", "K", "#ffffff", 9),
    c: badge("#599eff", "C", "#ffffff", 9), h: badge("#a074c4", "H", "#ffffff", 9),
    cpp: badge("#519aba", "C+", "#ffffff", 7), cc: badge("#519aba", "C+", "#ffffff", 7), hpp: badge("#a074c4", "H+", "#ffffff", 7),
    cs: badge("#68217a", "C#", "#ffffff", 7),
    go: badge("#00add8", "GO", "#ffffff", 7), rs: badge("#dea584", "RS", "#2b2b2b", 7),
    rb: badge("#cc342d", "RB", "#ffffff", 7), php: badge("#777bb3", "PHP", "#ffffff", 6), swift: badge("#f05138", "S", "#ffffff", 9),
    lua: badge("#000080", "LU", "#ffffff", 7), sql: badge("#dad8d8", "SQL", "#2b2b2b", 6),
    sh: badge("#4d5a5e", "$", "#ffffff", 9), bash: badge("#4d5a5e", "$", "#ffffff", 9), zsh: badge("#4d5a5e", "$", "#ffffff", 9),
    bat: badge("#4d5a5e", "&gt;_", "#ffffff", 7), cmd: badge("#4d5a5e", "&gt;_", "#ffffff", 7), ps1: badge("#2671be", "PS", "#ffffff", 7),
    xml: badge("#e37933", "&lt;&gt;", "#ffffff", 7), svg: badge("#ffb13b", "SVG", "#2b2b2b", 5.5),
    yml: badge("#cb171e", "Y", "#ffffff", 9), yaml: badge("#cb171e", "Y", "#ffffff", 9),
    toml: badge("#9c4221", "T", "#ffffff", 9), ini: badge("#6d8086", "I", "#ffffff", 9), cfg: badge("#6d8086", "I", "#ffffff", 9),
    txt: GENERIC, log: GENERIC,
    png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, ico: IMAGE, bmp: IMAGE,
    gradle: badge("#02303a", "G", "#ffffff", 9)
  };

  var BY_NAME = {
    "dockerfile": badge("#2496ed", "D", "#ffffff", 9),
    "package.json": badge("#cb3837", "n", "#ffffff", 9),
    "package-lock.json": badge("#cb3837", "n", "#ffffff", 9),
    ".gitignore": badge("#f05033", "G", "#ffffff", 8),
    "makefile": badge("#6d8086", "M", "#ffffff", 9),
    "readme.md": badge("#42a5f5", "i", "#ffffff", 9)
  };

  function fileIcon(name) {
    var lower = String(name).toLowerCase();
    if (BY_NAME[lower]) return BY_NAME[lower];
    var dot = lower.lastIndexOf(".");
    var ext = dot >= 0 ? lower.slice(dot + 1) : "";
    return BY_EXT[ext] || GENERIC;
  }

  var FOLDER = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4.3l1.3 1.5h7.4v7.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z" fill="#dcb67a"/></svg>';
  var FOLDER_OPEN = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4.3l1.3 1.5h6.4v1.5H4.3L1.5 12.5z" fill="#c09553"/><path d="M4.3 6.5h11l-2.8 6.5H1.5z" fill="#dcb67a"/></svg>';

  function folderIcon(open) { return open ? FOLDER_OPEN : FOLDER; }

  window.Icons = { svg: svg, fileIcon: fileIcon, folderIcon: folderIcon };
})();
