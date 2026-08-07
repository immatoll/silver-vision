# SilverVision

An Electron desktop shell for [EVE Frontier](https://www.evefrontier.com/), providing a windowed "app store" experience for launching and managing frontier apps, with a built-in [EveVault](https://github.com/evefrontier/evevault) wallet browser extension for signing transactions.

## Features

- **App store menu** — browse and launch a catalog of frontier apps as individual, movable windows.
- **Window management** — each launched app runs in its own titled window with pinning support.
- **Settings panel** — quick access to app-level configuration from an overlay panel.
- **EveVault integration** — bundles the `eve-vault` browser extension for wallet connection and transaction signing inside the shell.

## Tech stack

- [Electron](https://www.electronjs.org/) via [electron-vite](https://electron-vite.org/)
- React 19 + TypeScript
- Tailwind CSS 4
- [electron-builder](https://www.electron.build/) for packaging (NSIS installer on Windows)

## Project structure

```
src/
  main/           Electron main process
  preload/        Preload scripts (main window, extension bridge, keeper)
  renderer/       React apps: menu, appstore, settings, settingsPanel, window
  catalog/        App catalog data (catalog.json) and catalog editor
  fonts/          Bundled fonts
extension/
  eve-vault-0.14/ Bundled EveVault browser extension
vendor/
  evevault/       EveVault source (git submodule)
scripts/
  dev.js          Dev launcher (works around Electron/VS Code env issues)
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

TBD
