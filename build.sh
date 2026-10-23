#!/data/data/com.termux/files/usr/bin/bash
# Compila Uri Code a un APK (pensado para Termux).
# Requisitos: pkg install openjdk-17 aapt2 dx apksigner curl zip unzip python
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HOME/.cache/uri-code"
BUILD="$CACHE/build"
SDK_JAR="${ANDROID_JAR:-$CACHE/android.jar}"
OUT="$ROOT/uri-code.apk"

for tool in aapt2 javac dx apksigner keytool zip unzip curl python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Falta la herramienta: $tool"; exit 1; }
done

rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/assets" "$BUILD/compiled_res" "$CACHE"

if [ ! -f "$SDK_JAR" ]; then
  echo "Descargando android.jar (una sola vez)..."
  ZIP="$CACHE/platform.zip"
  mkdir -p "$CACHE/platform"
  curl -fL --retry 3 -o "$ZIP" "https://dl.google.com/android/repository/platform-34-ext7_r03.zip"
  unzip -o -q "$ZIP" -d "$CACHE/platform"
  FOUND=""; MAX=0
  for j in $(find "$CACHE/platform" -name android.jar 2>/dev/null); do
    sz=$(stat -c%s "$j" 2>/dev/null || wc -c < "$j")
    if [ "$sz" -gt "$MAX" ]; then MAX=$sz; FOUND="$j"; fi
  done
  [ -n "$FOUND" ] || { echo "No se encontro android.jar en la descarga"; exit 1; }
  mv "$FOUND" "$SDK_JAR"
  rm -rf "$CACHE/platform" "$ZIP"
fi

echo "Copiando el editor web..."
cp -r "$ROOT/editor-web/"* "$BUILD/assets/"

echo "Compilando recursos..."
aapt2 compile --dir "$ROOT/android_app/res" -o "$BUILD/compiled_res"

echo "Enlazando APK..."
FLAT_FILES=()
while IFS= read -r f; do FLAT_FILES+=("$f"); done < <(find "$BUILD/compiled_res" -name '*.flat')
aapt2 link -o "$BUILD/unsigned.apk" \
  --manifest "$ROOT/android_app/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 34 \
  -I "$SDK_JAR" \
  "${FLAT_FILES[@]}"

echo "Compilando Java..."
find "$ROOT/android_app/src" -name '*.java' > "$BUILD/sources.txt"
javac --release 8 -nowarn -Xlint:none \
  -classpath "$SDK_JAR" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

echo "Generando dex..."
dx --dex --min-sdk-version=26 --output="$BUILD/classes.dex" "$BUILD/classes"

echo "Agregando classes.dex y assets al APK..."
( cd "$BUILD" && zip -q unsigned.apk classes.dex && zip -q -r unsigned.apk assets )

echo "Alineando APK..."
if command -v zipalign >/dev/null 2>&1; then
  zipalign -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
else
  python3 - "$BUILD/unsigned.apk" "$BUILD/aligned.apk" <<'PY'
import sys, zipfile, struct
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w') as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        ni = zipfile.ZipInfo(info.filename, info.date_time)
        ni.external_attr = info.external_attr
        ni.compress_type = info.compress_type
        ni.extra = b''
        if ni.compress_type == zipfile.ZIP_STORED:
            off = zout.fp.tell() + 30 + len(info.filename.encode('utf-8'))
            pad = (-off) % 4
            if pad:
                if pad < 4: pad += 4
                ni.extra = struct.pack('<HH', 0xD935, pad - 4) + b'\0' * (pad - 4)
        zout.writestr(ni, data)
PY
fi

KS="$CACHE/debug.keystore"
if [ ! -f "$KS" ]; then
  echo "Generando keystore de depuracion..."
  keytool -genkeypair -keystore "$KS" -alias uri-code -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass android -keypass android -dname "CN=Uri Code"
fi

echo "Firmando APK..."
rm -f "$OUT" "$OUT.idsig"
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT" "$BUILD/aligned.apk"
apksigner verify "$OUT"
echo "APK listo: $OUT"
