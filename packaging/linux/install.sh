#!/usr/bin/env bash
# One-line installer: curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/packaging/linux/install.sh | sudo bash
# Downloads the latest .deb for this architecture, verifies its .sha256 and installs it with apt.
set -euo pipefail

REPO="${BRICOHAMS_REPO:-Brico-Hams/BricoHams-QO100-Station}"

case "$(dpkg --print-architecture)" in
  amd64) ARCH=amd64 ;;
  arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

API="https://api.github.com/repos/$REPO/releases/latest"
URL="$(curl -fsSL --proto '=https' --tlsv1.2 "$API" \
  | grep -oE "https://[^\"]+_${ARCH}\.deb" | head -n1)"
if [ -z "$URL" ]; then echo "no .deb for $ARCH in the latest release" >&2; exit 1; fi

DEB="$TMP/$(basename "$URL")"
curl -fsSL --proto '=https' --tlsv1.2 -o "$DEB" "$URL"
curl -fsSL --proto '=https' --tlsv1.2 -o "$DEB.sha256" "$URL.sha256"

# The .sha256 file names the bare file name, so verify from inside the temp dir.
(cd "$TMP" && sha256sum -c "$(basename "$DEB").sha256")

apt-get install -y "$DEB"
echo "Installed. Edit /etc/bricohams-qo100/config.json and /etc/bricohams-qo100/env, then: systemctl start bricohams-qo100"
