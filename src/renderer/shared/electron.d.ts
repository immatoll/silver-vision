// Global type declaration for the contextBridge API
interface MenuItem {
  name:      string
  url:       string
  icon?:     string
  width?:    number
  height?:   number
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
  defaultOpacityMin:   number
  defaultOpacityMax:   number
  focusGuardMs:        number
  closeOverlaysOnExit: boolean
  eveVaultEnabled:     boolean
}

interface ElectronAPI {
  minimize: () => void
  close:    () => void
  mouseenter: () => void
  mouseleave: () => void

  menu: {
    openSettings:    () => void
    openAppStore:    () => void
    openOverlay:     (opts: { title: string; url?: string; width?: number; height?: number }) => void
    closeOverlay:    (key: string) => void
    getCustomItems:  () => Promise<MenuItem[]>
    addCustomItem:   (item: Partial<MenuItem>) => Promise<{ ok: boolean; error?: string }>
    removeCustomItem:(url: string) => Promise<{ ok: boolean }>
    getLayout:       () => Promise<MenuLayout | null>
    saveLayout:      (layout: MenuLayout) => void
    onSettingsOpened:(cb: () => void) => void
    onSettingsClosed:(cb: () => void) => void
    onAppStoreOpened:(cb: () => void) => void
    onAppStoreClosed:(cb: () => void) => void
    onOverlayOpened: (cb: (key: string) => void) => void
    onOverlayClosed: (cb: (key: string) => void) => void
    onItemsChanged:  (cb: (items: MenuItem[]) => void) => void
  }

  extension: {
    getState:       () => Promise<{ loaded: boolean; id: string | null }>
    toggle:         () => void
    openPopup:      () => void
    onStateChanged: (cb: (loaded: boolean) => void) => void
  }

  appstore: {
    fetchCatalog: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  }

  catalog: {
    read:  () => Promise<{ ok: boolean; text?: string; error?: string }>
    write: (content: string) => Promise<{ ok: boolean; error?: string }>
  }

  settings: {
    getAll:          () => Promise<AppConfig>
    set:             (key: string, value: unknown) => void
    close:           () => void
    clearBounds:     () => void
    clearSession:    () => void
    clearCustomItems:() => void
    clearAll:        () => void
    clearVaultData:  () => void
  }

  overlay: {
    togglePin:           () => void
    setCollapsed:        (opts: { collapsed: boolean; restoreHeight?: number }) => void
    getBounds:           () => Promise<{ x: number; y: number; width: number; height: number }>
    setBounds:           (bounds: { x?: number; y?: number; width?: number; height?: number }) => void
    settingsMenuVisible: (visible: boolean) => void
    onPinChanged:        (cb: (active: boolean) => void) => void
    onSettingsMenuClosed:(cb: () => void) => void
    onSetVisible:        (cb: (v: boolean) => void) => void
  }

  settingsPanel: {
    setOpacityRange: (min: number, max: number) => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
