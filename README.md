# SilverVision

An Electron desktop shell for [EVE Frontier](https://www.evefrontier.com/), providing a windowed "app store" experience for launching and managing frontier apps, with a built-in [EveVault](https://github.com/evefrontier/evevault) wallet browser extension for signing transactions.

## Features

- **App store menu** — browse and launch a catalog of frontier apps as individual, movable windows, or add your own custom entries.
- **Window management** — each launched app runs in its own titled, resizable window with pinning, collapse, and per-window opacity support.
- **Built-in browser** — a tabbed browser window (URL/search bar, back/forward/reload, favicons) for visiting arbitrary sites without leaving the shell. New tabs open blank; the "add as app" button turns the current page into a launcher entry.
- **Settings** — general behavior, window defaults, appearance (light/dark theme), and cache/data management, organized into tabs including an About/credits page.
- **Light & dark themes** — switch instantly across every open window from Settings → Appearance.
- **EveVault integration** — bundles the `eve-vault` browser extension for wallet connection and transaction signing inside the shell, including in browser tabs.

## Tech stack

- [Electron](https://www.electronjs.org/) via [electron-vite](https://electron-vite.org/)
- React 19 + TypeScript
- Tailwind CSS 4
- [electron-builder](https://www.electron.build/) for packaging (NSIS installer on Windows)

## Project structure

```
src/
  main/           Electron main process
  preload/        Preload scripts (main window, extension bridge, keeper, overlay)
  renderer/       React apps: menu, appstore, settings, settingsPanel, window,
                  browserToolbar, browserNewTab, and shared/ (types, the
                  light/dark theme system, base CSS)
  catalog/        App catalog data (catalog.json) and catalog editor
  fonts/          Bundled fonts
extension/
  eve-vault-0.14/ Bundled EveVault browser extension
vendor/
  evevault/       EveVault source (git submodule)
scripts/
  dev.js          Dev launcher (works around Electron/VS Code env issues)
docs/
  design/         Design/planning docs for larger features
  fixes/          Write-ups of notable bug investigations and fixes
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Setup

Clone the repo including submodules:

```bash
git clone --recurse-submodules <repo-url>
cd silver-vision
npm install
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

### Run in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Package as a Windows installer

```bash
npm run exe
```

## License

MIT — see [LICENSE](LICENSE).

This applies to the SilverVision source code in this repository only. It
does not extend to bundled/vendored third-party components, including
`extension/eve-vault-0.14/` and the `vendor/` submodules, which remain under
their own respective owners' terms.
