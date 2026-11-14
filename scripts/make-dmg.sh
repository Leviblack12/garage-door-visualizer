#!/bin/bash
# Builds "Garage Door Visualizer.app", ad-hoc signs it, and wraps it in a .dmg (Apple Silicon by default; pass x64 for Intel).
set -e
cd "$(dirname "$0")/.."
ARCH="${1:-arm64}"
VER=$(node -p "require('./package.json').version")
rm -rf "dist/mac-$ARCH" "dist/mac"
npx electron-builder --mac dir --"$ARCH" --publish never
APPDIR=$([ "$ARCH" = "x64" ] && echo dist/mac || echo dist/mac-$ARCH)
APP="$APPDIR/Garage Door Visualizer.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "signature ok (ad-hoc)"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
LABEL=$([ "$ARCH" = "x64" ] && echo intel || echo apple-silicon)
OUT="dist/Garage-Door-Visualizer-mac-$LABEL.dmg"
rm -f "$OUT"
hdiutil create -volname "Garage Door Visualizer" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
rm -rf "$STAGE"
echo "built $OUT"
