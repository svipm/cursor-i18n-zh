#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/desktop-sample/src-tauri"
DIST="$ROOT/dist"
VERSION="$(node -p "require('$ROOT/package.json').version")"
TARGET="universal-apple-darwin"
ICON_SOURCE="$TAURI/icons/icon.ico"
ICONSET="$TAURI/icons/icon.iconset"
ICNS="$TAURI/icons/icon.icns"

rm -rf "$ICONSET"
mkdir -p "$ICONSET" "$DIST"
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -s format png -z "$double" "$double" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"

cd "$TAURI"
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cargo tauri build --target "$TARGET" --bundles app

APP="$TAURI/target/$TARGET/release/bundle/macos/汉化工作台.app"
ENGINE="$APP/Contents/Resources/engine"
if [[ ! -d "$APP" ]]; then
  echo "Missing macOS app bundle: $APP" >&2
  exit 1
fi
INFO_PLIST="$APP/Contents/Info.plist"
plutil -lint "$INFO_PLIST" >/dev/null
EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST")"
APP_BINARY="$APP/Contents/MacOS/$EXECUTABLE_NAME"
if [[ ! -x "$APP_BINARY" ]]; then
  echo "Missing macOS executable: $APP_BINARY" >&2
  exit 1
fi
ARCHS="$(lipo -archs "$APP_BINARY")"
for arch in arm64 x86_64; do
  if [[ " $ARCHS " != *" $arch "* ]]; then
    echo "macOS executable is missing $arch: $ARCHS" >&2
    exit 1
  fi
done

rm -rf "$ENGINE"
mkdir -p "$ENGINE/node_modules" "$ENGINE/licenses/claude-translation-memory"
cp -R "$ROOT/src" "$ROOT/dict" "$ROOT/compat" "$ENGINE/"
cp "$ROOT/package.json" "$ROOT/LICENSE" "$ROOT/CHANGELOG.md" "$ENGINE/"
cp -R "$ROOT/THIRD_PARTY_LICENSES" "$ENGINE/"
cp "$ROOT/desktop-sample/resources/claude/SOURCE.md" "$ROOT/desktop-sample/resources/claude/APACHE-2.0.txt" "$ENGINE/licenses/claude-translation-memory/"
cp -R "$ROOT/node_modules/acorn" "$ROOT/node_modules/opencc-js" "$ENGINE/node_modules/"
for required in \
  "$ENGINE/src/cli.js" \
  "$ENGINE/dict/00-common.json" \
  "$ENGINE/node_modules/acorn/package.json" \
  "$ENGINE/node_modules/opencc-js/package.json" \
  "$ENGINE/THIRD_PARTY_LICENSES" \
  "$ENGINE/licenses/claude-translation-memory/SOURCE.md" \
  "$ENGINE/licenses/claude-translation-memory/APACHE-2.0.txt"; do
  if [[ ! -e "$required" ]]; then
    echo "Missing macOS engine resource: $required" >&2
    exit 1
  fi
done
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
if [[ "$SIGNING_IDENTITY" == "-" ]]; then
  codesign --force --deep --sign - "$APP"
else
  codesign --force --deep --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$APP"
fi
codesign --verify --deep --strict "$APP"

APP_ZIP="$DIST/localization-workbench-v${VERSION}-macos-app.zip"
DMG="$DIST/localization-workbench-v${VERSION}-macos.dmg"
NOTARY_ZIP="$DIST/.localization-workbench-notary.zip"
DMG_STAGE="$DIST/.localization-workbench-dmg-stage"
DMG_MOUNT="$DIST/.localization-workbench-dmg-mount"
cleanup() {
  if mount | grep -Fq " on $DMG_MOUNT "; then
    hdiutil detach "$DMG_MOUNT" -quiet || true
  fi
  rm -rf "$DMG_MOUNT"
  rm -rf "$DMG_STAGE"
  rm -f "$NOTARY_ZIP"
}
trap cleanup EXIT
rm -f "$APP_ZIP" "$DMG" "$NOTARY_ZIP"
rm -rf "$DMG_STAGE" "$DMG_MOUNT"

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" && "$SIGNING_IDENTITY" != "-" ]]; then
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$NOTARY_ZIP"
  xcrun notarytool submit "$NOTARY_ZIP" --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
fi

ditto -c -k --sequesterRsrc --keepParent "$APP" "$APP_ZIP"
unzip -t "$APP_ZIP" >/dev/null
mkdir -p "$DMG_STAGE"
ditto "$APP" "$DMG_STAGE/汉化工作台.app"
ln -s /Applications "$DMG_STAGE/Applications"
hdiutil create -volname "汉化工作台" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG" >/dev/null
hdiutil verify "$DMG" >/dev/null
mkdir -p "$DMG_MOUNT"
hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$DMG_MOUNT" -quiet
if [[ ! -d "$DMG_MOUNT/汉化工作台.app" || ! -L "$DMG_MOUNT/Applications" ]]; then
  echo "DMG is missing the app bundle or Applications shortcut" >&2
  exit 1
fi
codesign --verify --deep --strict "$DMG_MOUNT/汉化工作台.app"
hdiutil detach "$DMG_MOUNT" -quiet
rm -rf "$DMG_MOUNT"

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" && "$SIGNING_IDENTITY" != "-" ]]; then
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  spctl --assess --type execute --verbose=2 "$APP"
fi

shasum -a 256 "$APP_ZIP" "$DMG" | sed "s#  $DIST/#  #" > "$DIST/SHA256SUMS-macos.txt"
echo "macOS app: $APP_ZIP"
echo "macOS dmg: $DMG"
