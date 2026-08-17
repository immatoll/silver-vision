## SilverVision v0.1.5 — Browser, Wallet Fix & Light Mode

Latest dev build of SilverVision, an Electron desktop shell for [EVE Frontier](https://www.evefrontier.com/) that provides a windowed "app store" experience for launching and managing frontier apps, with a bundled EveVault wallet extension for signing transactions.

### New: built-in browser
A tabbed browser now sits next to the App Store and Settings in the launcher.
- Real tabs — open, switch, close (last one always stays)
- Combined URL/search bar, back/forward/reload, favicons
- New tabs open blank — no forced default page
- **Add any page as an app** — one click turns the current tab into a menu entry (or pins it if already in the catalog)
- Wallet signing works the same in browser tabs as in regular app windows

### Fixed: wallet transaction confirmations
Signing used to work, but the page often never got notified — stuck in "working" until a manual refresh. Turned out to be an Electron limitation (`chrome.storage.onChanged` doesn't reliably wake an extension's service worker there), not an EveVault bug. Confirmations are now routed through the persistent keeper page instead of depending on that flaky wake-up.

Big thanks to [ProtoDroidBot](https://github.com/ProtoDroidBot) for the fix.

### New: light mode
Settings → Appearance now has a light/dark toggle, applied instantly across every open window. Same accent color, inverted surfaces.

### Also
- Settings reorganized: new Appearance and About tabs, redundant vault-popup action removed, more consistent styling
- Various window-chrome bugs fixed (pin/unpin, opacity popup, layering) that only showed up once the browser existed
- Internal `EFC` naming renamed to `SilverVision`
- MIT license added

### Known limitations
- Some functionality is still incomplete or unpolished
- Expect occasional bugs and edge-case issues

### Installation
Download the installer for your platform below:
- **Windows** — installer (`.exe`)
- **macOS** — disk image (`.dmg`)
