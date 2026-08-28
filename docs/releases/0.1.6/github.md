## SilverVision v0.1.6 — Window Layering Fixes

Latest dev build of SilverVision, an Electron desktop shell for [EVE Frontier](https://www.evefrontier.com/) that provides a windowed "app store" experience for launching and managing frontier apps, with a bundled EveVault wallet extension for signing transactions.

### Fixed: window not staying on top on SteamOS / KDE Plasma
Electron's "always on top" doesn't work at all under native Wayland (a platform limitation, not something patchable in the app) — this is why the app worked fine on Windows and macOS but not on Steam Deck / KDE. Worked around it with a small KWin compositor script that keeps the window above others; it installs and enables itself automatically the first time you launch this version, no action needed.

If you're on an older install and don't want to update yet, run `scripts/install-kwin-keepabove.sh` once and relaunch the app to get the same fix.

### Fixed: popups opening hidden behind their opener
Several popups — the EVE Frontier login popup, EVE Vault login popup, OAuth popup, and keeper-driven EVE login popup — could each end up opening invisibly behind the window that spawned them, most often on macOS due to a timing race between the popup and its opener both claiming top position. All popup windows now match their opener's always-on-top level and the opener stops fighting them for top position while they're open.

### Fixed: minimizing one overlay minimized all of them (mac/Linux)
Clicking minimize on any overlay window used to pull every open overlay down with it, since they're all always-on-top and would otherwise keep covering the screen. Now only the clicked window minimizes. Windows keeps its previous "minimize everything" behavior since its overlays don't need it.

### Fixed: app could stay running invisibly
A hidden background window (the EVE Vault extension bridge) was preventing the app from quitting after you closed everything else. The app now quits correctly once no visible window remains.

### Known limitations
- Some functionality is still incomplete or unpolished
- Expect occasional bugs and edge-case issues

### Installation
Download the installer for your platform below:
- **Windows** — installer (`.exe`)
- **macOS** — disk image (`.dmg`)
- **Linux** — see `scripts/install-kwin-keepabove.sh` above if you're on KDE Plasma and need the always-on-top fix without updating
