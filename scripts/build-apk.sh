#!/usr/bin/env bash
# Builds a signed release APK for submission / the Solana dApp Store.
#   EXPO_PUBLIC_API_URL=https://api.example.com ./scripts/build-apk.sh
# The signing keystore lives in keys/release.keystore (git-ignored). It is created on
# first run; BACK IT UP. Every future dApp Store update must be signed with it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${EXPO_PUBLIC_API_URL:?set EXPO_PUBLIC_API_URL to the hosted API}"
export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.local/jdks/jdk-17* 2>/dev/null | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}" PATH="$JAVA_HOME/bin:$PATH"
KS="$ROOT/keys/release.keystore"
: "${MOBILOOT_KEYSTORE_PASSWORD:?set MOBILOOT_KEYSTORE_PASSWORD (used to create or unlock keys/release.keystore)}"
if [[ ! -f "$KS" ]]; then
  mkdir -p "$ROOT/keys"
  keytool -genkeypair -v -keystore "$KS" -alias mobiloot -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$MOBILOOT_KEYSTORE_PASSWORD" -keypass "$MOBILOOT_KEYSTORE_PASSWORD" -dname "CN=Mobiloot, O=Charlie Newman, C=GB"
  echo "Created $KS. Back it up now."
fi
cd "$ROOT/app"
npx expo prebuild -p android --no-install
cd android
./gradlew assembleRelease -q
APK=app/build/outputs/apk/release/app-release-unsigned.apk
[[ -f $APK ]] || APK=app/build/outputs/apk/release/app-release.apk
OUT="$ROOT/dist/mobiloot-$(node -p "require('$ROOT/app/app.json').expo.version").apk"
mkdir -p "$ROOT/dist"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
"$BT"/zipalign -f -p 4 "$APK" "$OUT.aligned"
"$BT"/apksigner sign --ks "$KS" --ks-key-alias mobiloot \
  --ks-pass env:MOBILOOT_KEYSTORE_PASSWORD --key-pass env:MOBILOOT_KEYSTORE_PASSWORD --out "$OUT" "$OUT.aligned"
rm "$OUT.aligned"
"$BT"/apksigner verify --print-certs "$OUT" | head -3
sha256sum "$OUT"
