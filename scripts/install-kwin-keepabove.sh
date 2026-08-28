#!/usr/bin/env bash
# Installs a KWin script that forces SilverVision's window to stay above
# others on KDE Plasma (SteamOS Desktop Mode included). BrowserWindow's
# setAlwaysOnTop() is a documented no-op under native Wayland
# (electron/electron#50403) — the Wayland protocol gives clients no way to
# raise themselves, by design. The only way to get "always on top" back is a
# compositor-side script, which is what this installs and enables.
#
# Ships as of SilverVision's own next release, which installs this
# automatically on first launch — this script exists only so testers on an
# older build can get the same fix without upgrading first.
#
# No-op (with a clear message) anywhere that isn't Linux + KDE Plasma/KWin.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Not Linux — nothing to do here." >&2
  exit 0
fi

if ! command -v kwriteconfig6 >/dev/null || ! command -v qdbus6 >/dev/null; then
  echo "kwriteconfig6/qdbus6 not found — this isn't a KDE Plasma 6 session, nothing to do." >&2
  exit 0
fi

SCRIPT_ID="silvervisionkeepabove"
SCRIPT_DIR="$HOME/.local/share/kwin/scripts/$SCRIPT_ID"

mkdir -p "$SCRIPT_DIR/contents/code"

cat > "$SCRIPT_DIR/metadata.json" <<'EOF'
{
  "KPlugin": {
    "Id": "silvervisionkeepabove",
    "Name": "SilverVision Keep Above",
    "Description": "Keeps the SilverVision window above others (works around a Wayland limitation Electron cannot solve itself)"
  },
  "KPackageStructure": "KWin/Script",
  "X-KDE-ServiceTypes": [
    "KWin/Script"
  ],
  "X-Plasma-API": "javascript",
  "X-KDE-ParentApp": "kwin"
}
EOF

cat > "$SCRIPT_DIR/contents/code/main.js" <<'EOF'
function applyTo(client) {
  if (client && client.resourceClass === 'silvervision' && !client.keepAbove) {
    client.keepAbove = true;
  }
}
var existing = workspace.windowList();
for (var i = 0; i < existing.length; i++) applyTo(existing[i]);
workspace.windowAdded.connect(applyTo);
EOF

kwriteconfig6 --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" true
qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure >/dev/null 2>&1 || true

echo "Installed and enabled — restart SilverVision (or just relaunch it) to pick it up."
