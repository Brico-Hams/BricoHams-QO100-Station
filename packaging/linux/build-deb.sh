#!/usr/bin/env bash
# Build a headless .deb (no Electron) bundling the official Node.js runtime.
# Usage: packaging/linux/build-deb.sh <amd64|arm64>   (output: dist/bricohams-qo100_<ver>_<arch>.deb)
set -euo pipefail

ARCH="${1:-}"
NODE_VERSION="${NODE_VERSION:-24.20.0}"
case "$ARCH" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) echo "usage: $0 <amd64|arm64>" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/packaging/linux"
VERSION="$(node -p "require('$ROOT/package.json').version")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"

echo "Downloading $TARBALL"
curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/$TARBALL" "$BASE_URL/$TARBALL"
curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/SHASUMS256.txt" "$BASE_URL/SHASUMS256.txt"

# Refuse to continue unless the tarball hash matches the published one.
EXPECTED="$(grep -E "  ${TARBALL}\$" "$WORK/SHASUMS256.txt" | awk '{print $1}')"
if [ -z "$EXPECTED" ]; then echo "no SHA256 entry for $TARBALL" >&2; exit 1; fi
ACTUAL="$(sha256sum "$WORK/$TARBALL" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "SHA256 mismatch for $TARBALL (expected $EXPECTED, got $ACTUAL)" >&2
  exit 1
fi
echo "SHA256 verified"

PKG="$WORK/pkg"
APP="$PKG/opt/bricohams-qo100"
mkdir -p "$APP/node" "$PKG/DEBIAN" "$PKG/lib/systemd/system"
tar -xJf "$WORK/$TARBALL" -C "$APP/node" --strip-components=1

cp -r "$ROOT/src" "$ROOT/plugins" "$APP/"
mkdir -p "$APP/docs"
cp -r "$ROOT/docs/help" "$APP/docs/help"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/config.example.json" "$APP/"
[ -f "$ROOT/NOTICE.md" ] && cp "$ROOT/NOTICE.md" "$APP/"
[ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$APP/"

# Production dependencies only; the lockfile keeps versions exact. Electron is a devDependency and is skipped.
(cd "$APP" && PATH="$APP/node/bin:$PATH" npm ci --omit=dev --ignore-scripts)

install -m 0644 "$HERE/bricohams-qo100.service" "$PKG/lib/systemd/system/bricohams-qo100.service"

sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" "$HERE/control" > "$PKG/DEBIAN/control"
install -m 0755 "$HERE/postinst" "$PKG/DEBIAN/postinst"
install -m 0755 "$HERE/prerm" "$PKG/DEBIAN/prerm"

mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/bricohams-qo100_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "$PKG" "$OUT"
(cd "$ROOT/dist" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
echo "Built $OUT"
