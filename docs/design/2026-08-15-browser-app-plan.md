# Browser app: a built-in singleton overlay window with tabs and real navigation

## Context

The user wants a new app in the SilverVision launcher that behaves like the existing generic
overlay ("window") app — native-feeling, movable, pinnable, same fade/hide-on-blur chrome — but
instead of being locked to one launched app's URL, it shows a real URL/search bar plus Chrome-like
affordances (tabs, back / forward / reload) and lets the user navigate anywhere.

The browser is **not** a catalog entry and does **not** need a pin/menu-layout mechanism. Like App
Store and Settings, it's a built-in application always available from the menu UI — opened
directly, not launched via the app catalog/pin system.

What's still a real gap, confirmed by reading the current implementation: **no window kind has
navigation.** `createOverlayWindow` (`src/main/index.js:659-857`) loads a URL once into a child
`WebContentsView` (`_contentView`, line ~704) and never attaches `did-navigate` /
`did-navigate-in-page` / `page-title-updated` / `page-favicon-updated` listeners, and nothing calls
`goBack()`/`goForward()`/`reload()` anywhere. The `window` renderer (`src/renderer/window/App.tsx`)
has zero URL-bar, tab-strip, or nav-control UI — its whole chrome is a 32px titlebar with
pin/settings/collapse/close icons (`App.tsx:98-130`).

## Decisions from discussion

1. **Toolbar (tab strip + URL/search bar) sits below the titlebar, as a distinct element "in" the
   window** — not a separate floating panel, not replacing the titlebar. It hides when the window
   is collapsed, same as the content view presumably does today (need to confirm exactly how
   collapse currently hides/shows the content `WebContentsView`, then apply the same treatment to
   the toolbar view).
2. **Default home page: `https://app.silver-tribe.com`** — SilverVision's own web app, doubling as
   promotion for it.
3. **One combined URL/search input**, Chrome-omnibox style — no separate search box. Default search
   engine is Google.
4. **Icon: a generic globe SVG** for both the menu launcher icon and (if tabs show favicons) the
   fallback favicon when a page has none. No custom branding yet.
5. **Window bounds persist across restarts**, same as overlay apps (`window-bounds.json`, keyed by
   `'__browser'`). **Tabs/session also persist**: remember the last set of open tabs (URLs, active
   tab, order) and restore them on next open — but reload each page fresh rather than keeping the
   underlying `WebContentsView`/process alive while the browser window itself is closed. Scope: for
   as long as SilverVision (the whole app) stays running — not required to survive a full app
   relaunch, though persisting to disk means it likely will incidentally; not a hard requirement
   either way.
6. **Tabs are in scope for the first version**, not a later addition — confirmed after discussion
   that retrofitting a single-`WebContentsView` design into a multi-tab one later would be a real
   rework (tab state model, tab strip UI, per-tab nav-state tracking, swapping which view is
   bounded/visible), so the content-view model is designed as "list of tabs" from the start even
   though the UI can stay minimal initially.

## Which window base to build on

App Store and Settings (`createSettingsWindow`/`createAppStoreWindow`, `main/index.js:607-654`)
are the existing precedent for "built-in app opened directly from the menu, not through the
catalog" — but structurally they're the wrong base: fixed opacity (`setOpacity(1.0)`, no
fade/hide-on-blur), not resizable, and critically **no `WebContentsView` at all** — they just
`loadRenderer` a renderer bundle directly, since their content is the app's own React UI, not an
arbitrary remote page.

The browser needs everything the *overlay* ("window") app has instead: resizing, `WebContentsView`
content, and the fade/hide-on-blur chrome (`makeOverlayController`). So it's built on
**`createOverlayWindow`** (new `browser: true` option), not on the App Store/Settings pattern —
despite being opened the same *way* (a direct menu action, no catalog entry), its window
*mechanics* are an overlay window.

This keeps a single source of truth: any future change to overlay chrome, transparency, or
`WebContentsView` handling automatically applies to both regular launched apps and the browser,
rather than needing to be manually kept in sync across two separately-maintained code paths — this
was an explicit requirement from discussion.

## Architecture

Reuse `createOverlayWindow` with a new `browser: true` option — it already owns bounds
persistence, pin/collapse, dedup-by-key (`openOverlays` map), and the settings-panel layering
pattern that the toolbar will copy.

### Tab model

One `WebContentsView` per tab, all children of the same browser `BrowserWindow`, but only the
**active** tab's view is given non-zero bounds — the same "invisible until shown" technique already
used for the settings panel (`settingsView.setBounds({x:0,y:0,width:0,height:0})` when hidden,
`main/index.js:770`, resized into place when toggled visible). Switching tabs = re-bounding the
newly active view and zeroing the previously active one, not destroying/recreating views — keeps
back/forward history alive per tab while it exists in the current session.

Main-process tab state per browser window (new `Map`, e.g. `browserTabs`, keyed by `win.id`):
`{ tabs: [{ id, view, url, title, favicon }], activeTabId }`. New tab = new `WebContentsView` on
the same `persist:overlay` session, pushed into `tabs`, made active. Closing a tab destroys its
view and activates a neighbor — **except when it's the last remaining tab, where the close action
is a no-op** (see "closing the last tab" below); the browser window itself always stays closable
via the normal titlebar × regardless of tab count.

### Toolbar

The toolbar (tab strip + URL/search bar + back/forward/reload) is a **separate layered
`WebContentsView`**, following the exact precedent already in the file for the opacity settings
panel (`settingsView`, `main/index.js:759-787`: its own `WebContentsView`, its own preload, added
via `win.contentView.addChildView`, positioned/resized on window `resize`). This is preferable to
adding toolbar HTML into the `window` renderer itself, since the actual page content lives in
separate `WebContentsView`s the renderer has no DOM access into anyway.

Positioned as its own row directly below the 32px titlebar (own height constant, TBD), with the
active tab's content view bounded below *that* (`y: TITLEBAR_HEIGHT + BROWSER_TOOLBAR_HEIGHT`
instead of the current `y: TITLEBAR_HEIGHT`, only when `browser: true`). Hidden (zero-bounds) when
the window is collapsed, alongside whatever already happens to the content view on collapse —
needs confirming exactly how `overlay.setCollapsed` currently affects `_contentView`'s bounds
before mirroring it for the toolbar.

### 1. Opening the browser — built-in, no catalog entry

Add `createBrowserWindow()` as a thin wrapper that calls `createOverlayWindow({ browser: true, key:
'__browser', title: 'Browser' })` — singleton, keyed by a fixed string (same dedup-by-key mechanism
the overlay map already uses, e.g. `openOverlays.get('__browser')`), so re-opening focuses the
existing browser window instead of creating a second one. On first open with no saved session,
starts with one tab at `https://app.silver-tribe.com`.

Wire it up exactly like App Store/Settings: a `menu:openBrowser` IPC handler
(`ipcMain.on('menu:openBrowser', () => createBrowserWindow())`, alongside
`main/index.js:1062-1063`), a `menu.openBrowser()` preload call, and a launcher icon (generic globe
SVG) in the menu renderer UI next to the existing App Store/Settings icons — not in the
pinnable/removable app grid.

### 2. `createOverlayWindow` — browser mode

When `browser: true`:

- No fixed content `url` — instead restores the persisted tab set for `'__browser'` (or opens one
  tab at `https://app.silver-tribe.com` if none saved), creating one `WebContentsView` per restored
  tab and loading each fresh (not resuming any in-memory state, since the previous session's
  processes are gone once the window was closed).
- New listeners per-tab `WebContentsView`: `did-navigate`, `did-navigate-in-page`,
  `page-title-updated`, `page-favicon-updated`, plus `.canGoBack()`/`.canGoForward()` after each —
  pushed to the toolbar view via `toolbarView.webContents.send('browser:tabsChanged', {...})` /
  `browser:navState`, the same send-to-a-specific-layered-view pattern already used for
  `chrome:settingsMenuClosed` (`preload/index.ts:74-78`). Tab state (url/title/favicon) is also
  written back into the `'__browser'` bounds-store entry on change, debounced, so it survives an
  unexpected quit reasonably well even though eager writes aren't required here.
- IPC handlers for toolbar → main commands: `newTab(url?)`, `closeTab(tabId)`,
  `activateTab(tabId)`, `navigate(tabId, url)`, `goBack(tabId)`, `goForward(tabId)`,
  `reload(tabId)`, `stop(tabId)`. Bare non-URL input (no scheme, no dot-looking host) in the
  combined omnibox is treated as a search query against
  `https://www.google.com/search?q=...` rather than passed to `loadURL` directly.

### 3. New `browser` IPC namespace

Mirrors the existing triple-declaration pattern used by every other namespace (`overlay`,
`settingsPanel`, etc.):

- `src/preload/index.ts` — implement `browser.newTab/closeTab/activateTab/navigate/goBack/
  goForward/reload/stop` (invoke) and `browser.onTabsChanged(cb)` (event listener), alongside the
  existing `overlay.*` block (`preload/index.ts:67-79`). Also add `menu.openBrowser()` alongside
  `menu.openOverlay`/`menu.openSettings`/`menu.openAppStore`.
- `src/renderer/shared/electron.d.ts` — add the matching interface members.
- `src/renderer/shared/types.ts` — add `BrowserTab` (`{id, url, title, favicon, canGoBack,
  canGoForward, isLoading}`) and a tabs-changed payload type, alongside the existing shared payload
  types.

### 4. New `browserToolbar` renderer

New renderer entry (`src/renderer/browserToolbar/`, following the existing per-window-kind
renderer folder convention). Contents: tab strip (favicon + title + close × per tab, `+` to open a
new tab), back/forward/reload buttons, one combined URL/search input reflecting the active tab's
live nav state via `onTabsChanged`. Falls back to a generic globe SVG per tab when no favicon is
available. Styled to match the existing overlay chrome (same font/opacity system), not a literal
Chrome-omnibox clone.

### 5. Persisted session

New field on the `'__browser'` entry in `window-bounds.json` (already an arbitrary per-key object,
`getBoundsStore()[key]`, `main/index.js:122-138` — no new JSON file needed): `{ tabs: [{url,
title}], activeIndex }`, written on tab open/close/navigate (debounced) and on window close. Loaded
on `createBrowserWindow()` to restore tabs, each reloaded fresh rather than resumed. Included in
`settings:clearAll`'s existing wipe (`main/index.js:1197-1198` already clears the whole bounds
store) — no extra change needed there.

## Resolved from follow-up discussion

**Toolbar height.** No strong opinion yet — start from real Chrome/Chromium's own dimensions as a
baseline rather than guessing: a tab strip row is ~36-38px there, and the omnibox/nav-button row
below it is ~40-44px (varies slightly by platform/density). Plan: implement with those as starting
constants (e.g. `BROWSER_TAB_STRIP_HEIGHT = 36`, `BROWSER_TOOLBAR_HEIGHT = 40`, stacked below the
existing 32px `TITLEBAR_HEIGHT`), then adjust to taste once it's actually on screen — treat as
tunable, not a spec to hit exactly.

**Collapse behavior — confirmed mechanics to mirror.** Read `ipcMain.on('window:setCollapsed', ...)`
(`main/index.js:1004-1025`): collapsing shrinks the whole `BrowserWindow` to `height: 32` (just the
titlebar) and zeroes the content view's height (`cvEntry.view.setBounds({x:0, y:TITLEBAR_HEIGHT,
width:b.width, height:0})`, line 1014); expanding restores the saved height and calls the content
view's `updateBounds()` after a 50ms delay (line 1021). For browser mode, the same handler needs to
also zero/restore the toolbar view's bounds (both the tab strip and omnibox row) alongside the
active tab's content view — same zero-height-on-collapse, recompute-on-expand treatment, no new
mechanism required.

**Closing the last tab: disallowed, not "close the window."** The close (×) control on a tab is
inert/hidden when it's the only tab left — matches how the user wants this to behave rather than
mimicking a normal browser's "close last tab closes the window." The browser window itself is still
closable via the normal titlebar × like any other overlay window; that's unrelated to tab-closing.

**No hard cap on tab count, but the tab strip must degrade gracefully as tabs increase** — real
browsers shrink each tab's width as more open, down to an icon-only minimum, rather than
overflowing or requiring a hard cap. Plan: tab strip renders tabs at a target width that shrinks
(flex-basis / max-width in CSS) as more tabs are added, with a minimum width low enough to show
just the favicon once very cramped (title truncates/disappears first). No scrolling or tab
overflow menu for v1 — revisit only if shrinking to icon-only still isn't enough in practice.

## Remaining open question

- Exact numeric toolbar/tab-strip heights and the minimum/target tab width are tuning values to
  land once the UI is actually visible, not decisions to finalize on paper — implement with the
  Chrome-derived starting constants above and adjust visually.
