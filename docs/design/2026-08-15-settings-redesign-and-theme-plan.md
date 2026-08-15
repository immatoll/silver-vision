# Settings redesign + app-wide light/dark theme

## Context

Two related asks from discussion:

1. The Settings window (`src/renderer/settings/App.tsx`) feels visually distinct
   from the rest of the app's newer chrome (the browser toolbar in particular),
   and one of its actions — "Open vault popup" under the Extension tab — no
   longer makes sense now that vault access already lives in the menu view
   (`src/renderer/menu/App.tsx`'s extension icon/toggle). Wants: a sleeker,
   more consistent redesign, and remove the redundant vault-open action from
   Settings.
2. Add a light mode as an alternative to the current (only) dark mode, chosen
   via a tab/toggle in Settings, "in line with silver-link's light mode."

## silver-link's "light mode" is not something to match

Investigated `silver-link`'s theme system before designing anything: its
light mode (`app/src/styles/styles.css`, `:root[data-theme="light"]`) is an
explicitly-labeled **dev/QA debug palette** — the source comment reads
*"deliberately loud and far from the real monochrome/amber HUD palette...
Not a real product theme — don't treat this palette as a design target."*
Lavender background, magenta danger color, a purple gradient — built on
purpose to look fake and unmistakable during testing, not a real light UI.

Decision (confirmed in discussion): design SilverVision's light theme fresh,
derived from its own dark palette's identity (the same amber accent
`#ff9640`/`#ffbd7a`, the same semantic success/red hues), not by porting
silver-link's debug colors. The *persistence pattern* silver-link uses
(a stored preference + a `data-theme` attribute toggling CSS custom
property overrides) is a reasonable mechanism to reuse structurally, since
it's a standard, low-risk approach — but the color values are ours.

## Part 1: Theme system architecture

### Why this works with Tailwind v4's `@theme` block

`src/renderer/shared/index.css`'s `@theme { --color-efc-*: ... }` block
looks build-time-only, but Tailwind v4 still compiles its generated utility
classes (`bg-efc-bg`, `text-efc-text-muted`, etc.) to reference the
underlying CSS custom properties via `var(--color-efc-bg)`, not inlined
literal hex values. That means a runtime override of `--color-efc-bg` (e.g.
via a `:root[data-theme="light"]` selector with higher specificity, loaded
after the `@theme` block) changes what every utility class resolves to,
with no rebuild needed — this is the standard, supported Tailwind v4
theming pattern, not a workaround.

### Palette

New light-mode values added to `index.css`, under
`:root[data-theme="light"] { ... }`, overriding every `--color-efc-*` token
currently defined in `@theme`. Derived from the dark palette's identity
(same amber accent, same semantic hues, inverted surface/text relationship)
rather than picked ad hoc. Exact values to be tuned visually during
implementation, but must pass a contrast check (existing
`--color-efc-text*` tokens against their paired surface) before shipping —
using the dataviz skill's `validate_palette.js` contrast check as a sanity
tool even though this isn't chart work, since the underlying WCAG contrast
math is the same. Draft direction:

- Background: light neutral grey (not pure white — keep some of the
  "HUD panel" feel), e.g. `#f4f3f1` / `#eae8e5` for the bg-alt tier.
  surface, `#ffffff` for the modal-window feel of App
  Store/Settings/browser toolbar cards.
- Borders: light grey, `#d8d6d2`/`#c4c1bc` for the strong variant —
  enough contrast against the light backgrounds to still read as a
  boundary, not the near-invisible-on-purpose faint tier dark mode uses.
- Text: dark neutral, `#232220`, muted `#5c5954`, dim `#8b8781` — inverted
  ladder from dark mode's light-on-dark text tiers.
- Accent: same `#ff9640`/`#ffbd7a` — the identity color doesn't change
  between modes, only its usage context (e.g. deep-fill backgrounds like
  `--color-efc-accent-deep` need a light equivalent, not reused as-is,
  since `#2c1a08` is a near-black brown that only works on a dark surface).
- Success/red: same hue family, adjusted lightness for legibility on light
  surfaces rather than reused verbatim.

### Persistence + live propagation

- New `theme: 'dark' | 'light'` key added to `CONFIG_DEFAULTS`
  (`main/index.js`), stored in the existing `efc-config.json` — no new
  file, reuses `getConfig()`/`saveConfig()`/`settings:set`/
  `settings:getAll` exactly as `defaultOpacityMin` etc. already do.
- **New plumbing needed**: nothing today broadcasts a config change to
  already-open windows — `settings:set` only persists to disk.
  `notifyMenuItems()` is the closest existing precedent (pushes
  `menu:itemsChanged` to the menu window specifically). Add a
  `notifyThemeChanged()` that iterates `BrowserWindow.getAllWindows()` and
  sends a `settings:themeChanged` event with the new value to every
  window's main `webContents` — regular top-level renderers only; the
  layered `WebContentsView`s (browser tabs, settings panel, browser
  toolbar) each need the same event sent to their own `webContents`
  too, since they're separate contexts (mirroring how
  `chrome:settingsMenuClosed` already gets sent to specific views
  elsewhere in the file).
- Each renderer's shared bootstrap (`main.tsx` in every `src/renderer/*/`
  folder, or a new small shared `applyTheme(theme)` helper in
  `src/renderer/shared/`) sets/removes `document.documentElement.dataset.theme`
  on load (reading the initial value from `api.settings.getAll()`, same
  place every renderer already reads config) and again on
  `onThemeChanged`.
- New `settings.onThemeChanged(cb)` / `settings.getAll()` already returns
  the theme key once added to `CONFIG_DEFAULTS` — no separate getter
  needed. New IPC: preload `settings.onThemeChanged`, mirrored in
  `electron.d.ts`/`types.ts`, following the exact triple-declaration
  pattern every other event already uses in this codebase.

### Scope: app chrome only

Confirmed in discussion: the theme applies to SilverVision's own UI (menu,
App Store, Settings, browser toolbar, settings panel, overlay/browser
window titlebars) — not to the actual page content loaded in overlay or
browser `WebContentsView`s. We don't own or want to override how ef-map,
silver-link, or an arbitrary website renders itself.

## Part 2: Settings redesign

### Visual consistency with newer chrome

The browser toolbar (`src/renderer/browserToolbar/App.tsx`) established a
slightly different visual language during its build — rounded-sm/rounded-lg
surfaces, `bg-efc-surface` cards with real borders, the floating settings
panel's shadow+scale-in treatment. The Settings window currently uses a
flatter, denser look (`bg-efc-surface` full-bleed panes, thin `border-b`
row dividers, no card elevation anywhere). Redesign direction: adopt the
same card/surface language — section groups become distinct
`bg-efc-surface` cards with `rounded-lg` and a subtle border/shadow, rather
than a flat scrolling list of `SectionLabel` + rows separated only by hairlines,
so it reads as "the same app" as the browser/settings-panel popup rather
than an older, denser screen.

Existing row primitives (`SliderRow`, `ToggleRow`, `ActionRow`,
`SectionLabel`, `DangerZone`) are kept structurally — the redesign is
about surface treatment, spacing, and card grouping around them, not a
rewrite of the interaction primitives, which already work well.

### Content changes

- **Remove** "Open vault popup" `ActionRow` from the Extension tab
  (`tab === 'extension'`) — redundant now that vault access lives in the
  menu view. The Extension tab keeps "Reset vault data" (the danger-zone
  action), since that has no equivalent elsewhere.
- Consider whether the Extension tab still needs to exist as a full tab
  once "Open vault popup" is removed and it's just the one danger-zone
  reset action — likely folds into the Cache tab's "Full Reset" section
  instead of staying a standalone tab with one row in it, but this is a
  call to make visually once the redesign is laid out, not a hard
  requirement.

### New: Appearance tab

New tab (alongside General/Windows/Cache/Extension-or-merged), holding the
light/dark theme toggle — a two-option segmented control or a `ToggleRow`
variant (not a full settings row per option), reflecting/writing the new
`theme` config key via the same `set()`/`api.settings.set()` path every
other setting already uses.

## Open questions to confirm before implementation

- Exact light-mode hex values — draft direction given above, final values
  tuned visually once built (same "implement then adjust" approach used for
  the browser toolbar's tab-strip sizing earlier).
- Whether the Extension tab collapses into Cache or stays standalone after
  removing "Open vault popup" — proposed to fold it in, final call during
  implementation once both tabs' content is laid out side by side.
- Card-based redesign changes vertical rhythm/spacing — window height
  (`460×520` today) may need a small adjustment once real content is laid
  out in the new style; not fixed in advance.
