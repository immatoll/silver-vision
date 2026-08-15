# AGENTS.md — silver-vision

Orientation for anyone (human or agent) working in this codebase. This is
an Electron desktop shell for [EVE Frontier](https://www.evefrontier.com/)
— an always-on-top "app store" launcher for frontier web apps (each opens
as its own movable/pinnable overlay window), plus a bundled `EveVault`
browser extension for wallet connection and transaction signing. Electron
via `electron-vite`, React 19 + TypeScript renderers, Tailwind 4.

**Keep this file current.** When you land a major feature (a new window
type, a new IPC surface, a new gotcha with Electron/WebContentsView/the
bundled extension) add a short section here describing it. Skip this for
small fixes/tweaks — this file is for orientation, not a changelog.

See [`../silver-agent/AGENTS.md`](../silver-agent/AGENTS.md)
for conventions shared across this and the other Silver Tribe
projects — current Sui SDK packages/banned imports, PTB patterns, TS/
React conventions (applicable to `src/renderer/*`), and deployment
discipline.

## Directory layout

```
src/
  main/index.js          — the entire main process: window creation, IPC handlers, all
                            persisted state (bounds/config/custom-items/layout), EveVault
                            extension loading, OAuth redirect relay. One big file, not split
                            into modules — see "main/index.js is monolithic" below.
  preload/
    index.ts                — contextBridge API for menu/settings/appstore/overlay windows
                               (window.electronAPI — see this file for the full IPC surface)
    extension.js              — preload for EveVault popup/sign-flow windows (contextIsolation: false)
    keeper.js                  — preload for the hidden keeper window (background message relay)
    overlay.js                 — request-id tracker for remote dApp WebContentsViews; exposes no page API
  renderer/
    menu/                        — the main pinned launcher window (app icons/folders)
    appstore/                     — catalog browser window (fetches/parses catalog.json or a remote one)
    settings/                      — global settings window
    settingsPanel/                   — per-overlay opacity settings panel (a WebContentsView, not a window)
    window/                           — generic overlay window chrome wrapping a launched app's content
    shared/                            — types.ts, electron.d.ts (window.electronAPI typing), css.d.ts
  catalog/
    catalog.json                       — the shipped app catalog (name/url/icon/category/size per app)
    editor.html                         — a standalone catalog editor page
extension/
  eve-vault-0.14/                       — pre-built EveVault extension bundle, loaded into Electron's
                                          extension system at runtime (not built from vendor/ at build time)
vendor/evevault/                        — EveVault source, git submodule — reference/upstream only,
                                          `extension/eve-vault-0.14` is NOT regenerated from this
                                          automatically; see "Two copies of EveVault" below
scripts/dev.js                          — dev launcher (works around an Electron/VS Code env issue)
```

## Window model — five window "kinds", one shared chrome

Every non-hidden window is `alwaysOnTop`, frameless, transparent, and
uses the fade/hide-on-blur overlay chrome from `makeOverlayController`
(menu window uses the simpler `makeFadeController` instead — no
pin/collapse, just focus/hover-based opacity). Kinds, all created in
`src/main/index.js`:

- **Menu** (`createMenu`) — singleton, the persistent launcher; closing
  it closes every overlay and quits the app (if
  `closeOverlaysOnExit`, the default).
- **Settings** / **App Store** (`createSettingsWindow` /
  `createAppStoreWindow`) — singleton overlay-chrome windows, plain
  `loadRenderer`, no `WebContentsView`.
- **Overlay** (`createOverlayWindow`) — one per launched app, keyed by
  `url || title` (`openOverlays` map) so re-launching the same app
  refocuses the existing window instead of duplicating it. Remembers
  size/position/pin/opacity per key across restarts (`window-bounds.json`
  in `userData`, `loadBounds`/`saveBounds`). For `http(s)://` or
  `chrome-extension://` URLs, content loads into a child
  **`WebContentsView`** (`session.fromPartition('persist:overlay')`,
  isolated from the main window's session) layered under a second
  `WebContentsView` for the collapsible per-window settings panel
  (opacity sliders) — see `overlayContentViews`/`settingsOverlayViews`.
  Local `file://` catalog pages instead just `loadRenderer` the
  `window` renderer directly with the URL passed through as a query
  param — no `WebContentsView` in that path.
- **EveVault popup/sign-flow** (`openExtensionWindow`) — plain
  `BrowserWindow`s, not overlay-chrome, `contextIsolation: false` (needed
  for the extension's own script injection model), same
  `persist:overlay` session so the wallet stays logged in across windows.
  New vault windows cascade position (+32px per already-open one) so a
  still-pending sign flow doesn't get fully hidden under a newer popup.
- **Keeper** (`createKeeperWindow`) — hidden (`show: false, width: 1,
  height: 1`), singleton, loads the extension's `keeper.html`. Exists
  purely to keep the extension's background logic alive and to relay
  `chrome.runtime` messages (`OPEN_VAULT_WINDOW`, `OPEN_OAUTH_POPUP`,
  `RELAY_TAB_MESSAGE`) into the main process via an injected listener —
  see the `executeJavaScript` bridge in `createKeeperWindow`.

## `main/index.js` is monolithic — read the whole file before adding IPC

There's no module split for the main process; every window kind, every
`ipcMain` handler, and every persisted store lives in this one file.
That's intentional for now (small surface, high coupling between window
lifecycle and IPC), but it means grep, not assumption, is the way to
find an existing handler before adding a new one — duplicate handler
names silently shadow each other. Follow the existing section-comment
banners (`// --- Foo ---`) when adding a new area rather than inventing
a new file.

## Persisted state — four flat JSON files, no database

All under `app.getPath('userData')`, each with its own in-memory cache
and eager `writeFileSync` on every mutation (no debouncing):

- `window-bounds.json` — per-overlay-key size/position/pin/opacity (`getBoundsStore`/`saveBoundsStore`)
- `efc-config.json` — global settings (`CONFIG_DEFAULTS`: opacity defaults, `focusGuardMs`, `closeOverlaysOnExit`, `eveVaultEnabled`)
- `custom-items.json` — user-added launcher entries (`getCustomItems`/`saveCustomItems`)
- `menu-layout.json` — folder structure + list/icon view mode (`getMenuLayout`/`saveMenuLayout`)

`settings:clearAll` wipes all four plus the `persist:overlay` session's
cache/storage — that's the "reset everything" escape hatch, keep it in
sync if you add a fifth store.

## The EveVault extension — two copies, don't confuse them

- **`extension/eve-vault-0.14/`** — the pre-built bundle actually loaded
  at runtime (`session.extensions.loadExtension`, gated by
  `eveVaultEnabled` in config). This is what ships and what the app
  talks to via `chrome.runtime`/content-script messaging.
- **`vendor/evevault/`** — the upstream source as a git submodule
  (`apps/extension/` inside it is the real WXT-based extension project).
  Rebuilding `eve-vault-0.14/` from this submodule is a manual step, not
  wired into `npm run build` — if you need a newer EveVault build,
  build it from `vendor/evevault/apps/extension` and manually replace
  the `extension/eve-vault-0.14/` folder contents.

**`extension:relayTabMessage`** exists because Electron's
`chrome.tabs.sendMessage` doesn't reliably address `WebContentsView`-hosted
content as a tab. `src/preload/overlay.js` records each public Wallet
Standard request id at document start; the main process validates EveVault's
public response shape, routes it only to that request's content view, and
waits for the page to observe the equivalent `window.postMessage` before the
keeper confirms delivery to the extension background shim. Chain-change
events are the only responses broadcast to all overlays. Keep the validator
and the compatibility shim at the start of the bundled `background.js` in
sync with EveVault's `content.ts`/`tabMessaging.ts` contract.

The keeper also installs a SilverVision-owned approval recovery listener from
`src/main/eve-vault-approval-recovery.js`. If the Manifest V3 background
worker misses the popup's `transactionResult` storage event, the persistent
keeper validates it against `pendingAction`, sends the same public response
through `extension:relayTabMessage`, and removes both records only after the
originating page confirms delivery. This intentionally lives in SilverVision,
not either EveVault copy.

**OAuth redirects** (`*.chromiumapp.org/*`) are intercepted at the
`webRequest.onBeforeRequest` level on both the overlay session and the
default session, and via `did-navigate`/`will-navigate` on every
`web-contents-created` webContents — relayed into whichever of
keeper/vault-popup window is currently open, never allowed to actually
navigate.

## Catalog

`src/catalog/catalog.json` is the shipped list of launchable apps
(`{ name, url, description, category, icon, width, height, essential }`)
— `icon` is either an image URL or an inline SVG string. Read/written via
`catalog:read`/`catalog:write` IPC (`fs.readFileSync`/`writeFileSync`
against `app.getAppPath()`, so it's editable at runtime through
`catalog/editor.html`, not just at build time). The App Store window can
additionally fetch a **remote** catalog JSON via `appstore:fetchCatalog`
(main-process `net.fetch`, http/https only) for browsing a catalog other
than the bundled one.

## Running things

```bash
npm run dev     # scripts/dev.js — electron-vite dev, not `electron-vite dev` directly (see the file's own comments for why)
npm run build   # electron-vite build
npm run exe     # electron-vite build && electron-builder — packaged Windows NSIS installer
```

`SILVERVISION_AUTO_OPEN_OVERLAY_DEVTOOLS=1` env var auto-opens devtools (detached) on
every overlay/keeper/vault window at creation — useful when debugging
the extension bridge, noisy otherwise.

Clone with `--recurse-submodules` (or run `git submodule update --init
--recursive` after the fact) — `vendor/evevault` won't exist otherwise,
though note this doesn't affect the shipped `extension/eve-vault-0.14`
bundle, which is committed directly.
