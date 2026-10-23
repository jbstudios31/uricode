package ai.uricode.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;

public class MainActivity extends Activity {

    private static final int REQ_IMPORT = 1001;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#3c3c3c"));
        w.setNavigationBarColor(Color.parseColor("#007acc"));

        new File(getFilesDir(), "projects").mkdirs();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1e1e1e"));
        setContentView(web);

        WebSettings st = web.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);
        st.setAllowFileAccess(true);
        st.setAllowFileAccessFromFileURLs(true);   // Monaco (CDN) se carga desde la pagina local
        st.setAllowUniversalAccessFromFileURLs(false);
        st.setAllowContentAccess(false);
        st.setCacheMode(WebSettings.LOAD_DEFAULT);  // cachea Monaco para abrir rapido
        st.setSupportZoom(false);
        st.setTextZoom(100);
        st.setDefaultTextEncodingName("utf-8");

        web.addJavascriptInterface(new FileAPI(this, web), "FileAPI");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null || u.getScheme() == null) return false;
                String scheme = u.getScheme().toLowerCase();
                if (scheme.equals("http") || scheme.equals("https")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Exception ignored) {}
                    return true;
                }
                // bloquear esquemas peligrosos (javascript:, data:, file:, content:, etc.)
                if (scheme.equals("javascript") || scheme.equals("data") || scheme.equals("file") || scheme.equals("content")) {
                    return true;
                }
                return false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                return true;
            }

            // Selector de archivos para "Importar archivos"
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Importar archivos"), REQ_IMPORT);
                } catch (Exception e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        // Primero deja que la interfaz cierre paneles, menus o dialogos abiertos.
        final boolean[] handled = { false };
        web.evaluateJavascript("(function(){return window.uriBack ? window.uriBack() : false;})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        handled[0] = true;
                        if (!"true".equals(value)) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
        web.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!handled[0]) MainActivity.super.onBackPressed();
            }
        }, 250);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_IMPORT) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    result = new Uri[clip.getItemCount()];
                    for (int k = 0; k < clip.getItemCount(); k++) {
                        result[k] = clip.getItemAt(k).getUri();
                    }
                } else if (data.getData() != null) {
                    result = new Uri[] { data.getData() };
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onPause() {
        // Pide a la interfaz guardar los archivos modificados antes de pasar a segundo plano.
        if (web != null) {
            web.evaluateJavascript("if(window.uriFlush){window.uriFlush();}", null);
        }
        super.onPause();
    }

    public static class FileAPI {
        private final Context ctx;
        private final WebView web;

        public FileAPI(Context c, WebView w) {
            this.ctx = c;
            this.web = w;
        }

        private File root() {
            File r = new File(ctx.getFilesDir(), "projects");
            r.mkdirs();
            return r;
        }

        private File rootCanon() {
            try {
                return root().getCanonicalFile();
            } catch (Exception e) {
                return null;
            }
        }

        /** Resuelve una ruta relativa dentro de la carpeta de proyectos. null si intenta salir de ella. */
        private File resolve(String rel) {
            File rc = rootCanon();
            if (rc == null) return null;
            if (rel == null || rel.isEmpty() || rel.equals("/")) {
                return rc;
            }
            try {
                File canon = new File(rc, rel).getCanonicalFile();
                String c = canon.getPath();
                String r = rc.getPath();
                if (!c.equals(r) && !c.startsWith(r + File.separator)) {
                    return null;
                }
                // reject symlinks
                if (java.nio.file.Files.isSymbolicLink(canon.toPath())) return null;
                return canon;
            } catch (Exception e) {
                return null;
            }
        }

        private String relOf(File f) {
            File rc = rootCanon();
            if (rc == null || f == null) return "";
            String r = rc.getPath();
            String p = f.getPath();
            if (p.equals(r)) return "";
            return p.substring(r.length() + 1);
        }

        @JavascriptInterface
        public String getRoot() {
            File rc = rootCanon();
            return rc == null ? "" : rc.getAbsolutePath();
        }

        @JavascriptInterface
        public String listDir(String rel) {
            JSONArray arr = new JSONArray();
            File d = resolve(rel);
            if (d == null || !d.isDirectory()) {
                return arr.toString();
            }
            File[] kids = d.listFiles();
            if (kids == null) {
                return arr.toString();
            }
            Arrays.sort(kids, new Comparator<File>() {
                @Override
                public int compare(File a, File b) {
                    int da = a.isDirectory() ? 0 : 1;
                    int db = b.isDirectory() ? 0 : 1;
                    if (da != db) return da - db;
                    return a.getName().compareToIgnoreCase(b.getName());
                }
            });
            try {
                for (File k : kids) {
                    JSONObject o = new JSONObject();
                    o.put("name", k.getName());
                    o.put("path", relOf(k));
                    o.put("type", k.isDirectory() ? "dir" : "file");
                    o.put("size", k.length());
                    arr.put(o);
                }
            } catch (Exception ignored) {}
            return arr.toString();
        }

        @JavascriptInterface
        public boolean exists(String rel) {
            File f = resolve(rel);
            return f != null && f.exists();
        }

        @JavascriptInterface
        public String readFile(String rel) {
            File f = resolve(rel);
            if (f == null || !f.isFile()) {
                return "";
            }
            try {
                long len = f.length();
                if (len > 10000000L) return ""; // no leer archivos de mas de 10 MB
                byte[] bytes = new byte[(int) len];
                try (InputStream in = new FileInputStream(f)) {
                    int total = 0;
                    while (total < bytes.length) {
                        int r = in.read(bytes, total, bytes.length - total);
                        if (r < 0) break;
                        total += r;
                    }
                }
                return new String(bytes, StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean writeFile(String rel, String content) {
            File f = resolve(rel);
            if (f == null || f.isDirectory() || f.equals(rootCanon())) return false;
            try {
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write((content == null ? "" : content).getBytes(StandardCharsets.UTF_8));
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean mkdir(String rel) {
            File f = resolve(rel);
            if (f == null) return false;
            return f.isDirectory() || f.mkdirs();
        }

        @JavascriptInterface
        public boolean deleteItem(String rel) {
            File f = resolve(rel);
            if (f == null || f.equals(rootCanon())) return false; // nunca borrar la raiz
            return deleteRecursive(f);
        }

        private boolean deleteRecursive(File f) {
            if (f == null) return false;
            try {
                if (java.nio.file.Files.isSymbolicLink(f.toPath())) {
                    return f.delete();
                }
            } catch (Exception ignored) {}
            if (f.isDirectory()) {
                File[] kids = f.listFiles();
                if (kids != null) {
                    for (File k : kids) {
                        if (!deleteRecursive(k)) return false;
                    }
                }
            }
            return f.delete();
        }

        @JavascriptInterface
        public boolean renameItem(String oldRel, String newRel) {
            File oldF = resolve(oldRel);
            File newF = resolve(newRel);
            if (oldF == null || newF == null) return false;
            if (oldF.equals(rootCanon()) || newF.exists()) return false;
            File parent = newF.getParentFile();
            if (parent != null) parent.mkdirs();
            return oldF.renameTo(newF);
        }

        /** Abre la hoja de compartir de Android con el texto de un archivo. */
        @JavascriptInterface
        public void shareText(String name, String text) {
            try {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, name);
                i.putExtra(Intent.EXTRA_TEXT, text);
                Intent chooser = Intent.createChooser(i, name);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(chooser);
            } catch (Exception ignored) {}
        }

        /** Ejecuta un comando de shell en el directorio de proyectos y devuelve JSON {code,stdout,stderr}. */
        @JavascriptInterface
        public String runCommand(String cmd, String relCwd) {
            if (cmd == null || cmd.trim().isEmpty()) return "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"empty\"}";
            File cwd = resolve(relCwd == null || relCwd.isEmpty() ? "" : relCwd);
            if (cwd == null || !cwd.isDirectory()) cwd = root();
            if (cwd == null) return "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"no root\"}";
            try {
                ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c", cmd);
                pb.directory(cwd);
                pb.redirectErrorStream(false);
                Process pr = pb.start();
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                java.io.ByteArrayOutputStream err = new java.io.ByteArrayOutputStream();
                Thread t1 = new Thread(new Runnable() { public void run() { try { copyStream(pr.getInputStream(), out); } catch (Exception ignored) {} } });
                Thread t2 = new Thread(new Runnable() { public void run() { try { copyStream(pr.getErrorStream(), err); } catch (Exception ignored) {} } });
                t1.start(); t2.start();
                boolean finished = pr.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
                if (!finished) { pr.destroyForcibly(); }
                t1.join(1000); t2.join(1000);
                int code = finished ? pr.exitValue() : -1;
                String o = new String(out.toByteArray(), StandardCharsets.UTF_8);
                String e = new String(err.toByteArray(), StandardCharsets.UTF_8);
                if (o.length() > 200000) o = o.substring(0, 200000) + "\n[truncado]";
                if (e.length() > 200000) e = e.substring(0, 200000) + "\n[truncado]";
                JSONObject r = new JSONObject();
                r.put("code", code);
                r.put("stdout", o);
                r.put("stderr", e);
                return r.toString();
            } catch (Exception ex) {
                try {
                    JSONObject r = new JSONObject();
                    r.put("code", -1);
                    r.put("stdout", "");
                    r.put("stderr", ex.getClass().getSimpleName() + ": " + ex.getMessage());
                    return r.toString();
                } catch (Exception ignored) { return "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"error\"}"; }
            }
        }

        private void copyStream(java.io.InputStream in, java.io.OutputStream out) throws Exception {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }

        /**
         * Llamada HTTP POST nativa (evita problemas de CORS en el WebView).
         * El resultado vuelve por window.__uriHttpDone(id, status, bodyBase64).
         */
        @JavascriptInterface
        public void httpPost(final String id, final String url, final String headersJson, final String body) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    int status = -1;
                    byte[] resp = new byte[0];
                    try {
                        java.net.URL u = new java.net.URL(url);
                        String scheme = u.getProtocol().toLowerCase();
                        if (!scheme.equals("http") && !scheme.equals("https")) throw new Exception("scheme not allowed");
                        String host = u.getHost();
                        if (host == null || host.isEmpty() || host.equalsIgnoreCase("localhost") ||
                            host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") ||
                            host.startsWith("169.254.") || host.endsWith(".local")) throw new Exception("host not allowed");
                        HttpURLConnection c = (HttpURLConnection) u.openConnection();
                        c.setRequestMethod("POST");
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(120000);
                        c.setDoOutput(true);
                        // limit request body
                        String bodyStr = body == null ? "" : body;
                        if (bodyStr.length() > 1000000) throw new Exception("body too large");
                        byte[] data = bodyStr.getBytes(StandardCharsets.UTF_8);
                        JSONObject h = new JSONObject(headersJson == null ? "{}" : headersJson);
                        java.util.Iterator<String> keys = h.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            String kl = k.toLowerCase();
                            if (kl.equals("host") || kl.equals("content-length") || kl.equals("connection")) continue;
                            c.setRequestProperty(k, h.getString(k));
                        }
                        try (OutputStream os = c.getOutputStream()) {
                            os.write(data);
                        }
                        status = c.getResponseCode();
                        InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (is != null) {
                            ByteArrayOutputStream bos = new ByteArrayOutputStream();
                            byte[] buf = new byte[8192];
                            int n, total = 0;
                            while (total < 5000000 && (n = is.read(buf)) > 0) { bos.write(buf, 0, n); total += n; }
                            is.close();
                            resp = bos.toByteArray();
                        }
                    } catch (Exception e) {
                        String msg = e.getClass().getSimpleName() + ": " + e.getMessage();
                        resp = msg.getBytes(StandardCharsets.UTF_8);
                        status = -1;
                    }
                    final String b64 = Base64.encodeToString(resp, Base64.NO_WRAP);
                    final int st = status;
                    final String js = "window.__uriHttpDone && window.__uriHttpDone(" + JSONObject.quote(id) + "," + st + "," + JSONObject.quote(b64) + ")";
                    web.post(new Runnable() {
                        @Override
                        public void run() {
                            web.evaluateJavascript(js, null);
                        }
                    });
                }
            }).start();
        }
    }
}
