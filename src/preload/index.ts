import { contextBridge, ipcRenderer } from 'electron'

// Typed contextBridge API exposed to all renderer windows
const api = {
  // ── General window controls ──────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window:minimize'),
  close:    () => ipcRenderer.send('window:close'),
  mouseenter: () => ipcRenderer.send('renderer:mouseenter'),
  mouseleave: () => ipcRenderer.send('renderer:mouseleave'),

  // ── Menu window ───────────────────────────────────────────────────────────
  menu: {
    openSettings:  () => ipcRenderer.send('menu:openSettings'),
    openAppStore:  () => ipcRenderer.send('menu:openAppStore'),
    openOverlay:   (opts: { title: string; url?: string; width?: number; height?: number }) =>
                       ipcRenderer.send('menu:openOverlay', opts),
    closeOverlay:  (key: string) => ipcRenderer.send('overlay:close', key),
    getCustomItems: () => ipcRenderer.invoke('menu:getCustomItems') as Promise<MenuItem[]>,
    addCustomItem:  (item: Partial<MenuItem>) => ipcRenderer.invoke('menu:addCustomItem', item) as Promise<{ ok: boolean; error?: string }>,
    removeCustomItem: (url: string) => ipcRenderer.invoke('menu:removeCustomItem', { url }) as Promise<{ ok: boolean }>,
    getLayout:  () => ipcRenderer.invoke('menu:getLayout') as Promise<MenuLayout | null>,
    saveLayout: (layout: MenuLayout) => ipcRenderer.send('menu:saveLayout', layout),

    onSettingsOpened: (cb: () => void)          => ipcRenderer.on('settings:opened', cb),
    onSettingsClosed: (cb: () => void)          => ipcRenderer.on('settings:closed', cb),
    onAppStoreOpened: (cb: () => void)          => ipcRenderer.on('appstore:opened', cb),
    onAppStoreClosed: (cb: () => void)          => ipcRenderer.on('appstore:closed', cb),
    onOverlayOpened:  (cb: (key: string) => void) => ipcRenderer.on('overlay:opened', (_e, key) => cb(key)),
    onOverlayClosed:  (cb: (key: string) => void) => ipcRenderer.on('overlay:closed', (_e, key) => cb(key)),
    onItemsChanged:   (cb: (items: MenuItem[]) => void) => ipcRenderer.on('menu:itemsChanged', (_e, items) => cb(items)),
  },

  // ── Extension ─────────────────────────────────────────────────────────────
  extension: {
    getState:    () => ipcRenderer.invoke('extension:getState') as Promise<{ loaded: boolean; id: string | null }>,
    toggle:      () => ipcRenderer.send('extension:toggle'),
    openPopup:   () => ipcRenderer.send('extension:openPopup'),
    onStateChanged: (cb: (loaded: boolean) => void) =>
                     ipcRenderer.on('extension:stateChanged', (_e, loaded) => cb(loaded)),
  },

  // ── App Store ─────────────────────────────────────────────────────────────
  appstore: {
    fetchCatalog: (url: string) => ipcRenderer.invoke('appstore:fetchCatalog', url) as Promise<{ ok: boolean; text?: string; error?: string }>,
  },

  // ── Catalog (catalog.json) ────────────────────────────────────────────────
  catalog: {
    read:  () => ipcRenderer.invoke('catalog:read')  as Promise<{ ok: boolean; text?: string; error?: string }>,
    write: (content: string) => ipcRenderer.invoke('catalog:write', content) as Promise<{ ok: boolean; error?: string }>,
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    getAll:          () => ipcRenderer.invoke('settings:getAll') as Promise<AppConfig>,
    set:             (key: string, value: unknown) => ipcRenderer.send('settings:set', key, value),
    close:           () => ipcRenderer.send('settings:close'),
    clearBounds:     () => ipcRenderer.send('settings:clearBounds'),
    clearSession:    () => ipcRenderer.send('settings:clearSession'),
    clearCustomItems:() => ipcRenderer.send('settings:clearCustomItems'),
    clearAll:        () => ipcRenderer.send('settings:clearAll'),
    clearVaultData:  () => ipcRenderer.send('settings:clearVaultData'),
  },

  // ── Overlay window chrome ─────────────────────────────────────────────────
  overlay: {
    togglePin:           () => ipcRenderer.send('window:togglePin'),
    setCollapsed:        (opts: { collapsed: boolean; restoreHeight?: number }) =>
                             ipcRenderer.send('window:setCollapsed', opts),
    getBounds:           () => ipcRenderer.invoke('window:getBounds') as Promise<Electron.Rectangle>,
    setBounds:           (bounds: Partial<Electron.Rectangle>) => ipcRenderer.send('window:setBounds', bounds),
    settingsMenuVisible: (visible: boolean) => ipcRenderer.send('window:settingsMenuVisible', visible),

    onPinChanged:         (cb: (active: boolean) => void) =>
                              ipcRenderer.on('chrome:pinChanged', (_e, active) => cb(active)),
    onSettingsMenuClosed: (cb: () => void)   => ipcRenderer.on('chrome:settingsMenuClosed', cb),
    onSetVisible:         (cb: (v: boolean) => void) =>
                              ipcRenderer.on('chrome:setVisible', (_e, v) => cb(v)),
  },

  // ── Settings panel (opacity sliders) ─────────────────────────────────────
  settingsPanel: {
    setOpacityRange: (min: number, max: number) =>
                         ipcRenderer.send('window:setOpacityRange', { min, max }),
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

// ── Shared type declarations (used only for inference) ─────────────────────
export type ElectronAPI = typeof api

interface MenuItem {
  name: string
  url: string
  icon?: string
  width?: number
  height?: number
  category?: string
}

interface MenuFolderDef {
  id:    string
  name:  string
  items: string[]
}

interface MenuLayout {
  order:    string[]
  folders:  MenuFolderDef[]
  viewMode: 'list' | 'icon'
}

interface AppConfig {
  defaultOpacityMin: number
  defaultOpacityMax: number
  focusGuardMs: number
  closeOverlaysOnExit: boolean
  eveVaultEnabled: boolean
}
