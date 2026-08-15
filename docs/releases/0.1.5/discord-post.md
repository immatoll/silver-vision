# SilverVision — Dev Build Preview (0.1.5)

Latest dev progress — built-in browser, a real wallet fix, and light mode.

## New: built-in browser

A tabbed browser now sits next to the App Store and Settings in the launcher.

- Real tabs — open, switch, close (last one always stays).
- Combined URL/search bar, back/forward/reload, favicons.
- New tabs open blank — no forced default page.
- **Add any page as an app** — one click turns the current tab into a menu entry (or pins it if already in the catalog).
- Wallet signing works the same in browser tabs as in regular app windows.

## Fixed: wallet transaction confirmations

Signing used to work, but the page often never got notified — stuck in "working" until a manual refresh. Turned out to be an Electron limitation (`chrome.storage.onChanged` doesn't reliably wake an extension's service worker there), not an EveVault bug.

**Big thanks to [ProtoDroidBot](https://github.com/ProtoDroidBot)** for the fix that shipped — routing confirmations through the persistent keeper page instead of depending on that flaky wake-up at all.

## New: light mode

Settings → Appearance now has a light/dark toggle, applied instantly across every open window. Same accent color, inverted surfaces.

## Also

- Settings reorganized: new Appearance and About tabs, redundant vault-popup action removed, more consistent styling.
- Various window-chrome bugs fixed (pin/unpin, opacity popup, layering) that only showed up once the browser existed.
- Internal `EFC` naming renamed to `SilverVision`.
- MIT license added.

## Repo

https://github.com/immatoll/silver-vision

Still a dev build — a proper release will follow. Feedback welcome.
