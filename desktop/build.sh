#!/bin/bash
# Compila Uri Code para Linux (Electron).
# Requisitos: node >= 18, npm
set -e

cd "$(dirname "$0")"

echo "Instalando dependencias..."
npm install

echo "Empaquetando para Linux (AppImage + deb)..."
npx electron-builder --linux

echo ""
echo "Builds generados en desktop/dist/"
ls -lh dist/ 2>/dev/null || true
