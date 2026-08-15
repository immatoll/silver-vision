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
  theme:               'dark' | 'light'
}

interface CustomApp {
  id:           string
  name:         string
  url:          string
  icon?:        string
  description?: string
  width?:       number
  height?:      number
  category?:    string
}

interface BrowserTab {
  id:           string
  url:          string
  title:        string
  favicon:      string
  isLoading:    boolean
  canGoBack:    boolean
  canGoForward: boolean
}

interface BrowserTabsState {
  activeTabId: string | null
  tabs:        BrowserTab[]
}

interface ElectronAPI {
  minimize: () => void
  close:    () => void
  mouseenter: () => void
  mouseleave: () => void

  menu: {
    openSettings:    () => void
    openAppStore:    () => void
    openBrowser:     () => void
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
    onBrowserOpened: (cb: () => void) => void
    onBrowserClosed: (cb: () => void) => void
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
    fetchCatalog:        (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>
    getCustomApps:       () => Promise<CustomApp[]>
    upsertCustomApp:     (app: Partial<CustomApp>) => Promise<{ ok: boolean; error?: string; app?: CustomApp }>
    removeCustomApp:     (id: string) => Promise<{ ok: boolean }>
    onCustomAppsChanged: (cb: (apps: CustomApp[]) => void) => void
  }

  catalog: {
    read:  () => Promise<{ ok: boolean; text?: string; error?: string }>
    write: (content: string) => Promise<{ ok: boolean; error?: string }>
  }

  settings: {
    getAll:          () => Promise<AppConfig>
    getVersion:      () => Promise<string>
    set:             (key: string, value: unknown) => void
    close:           () => void
    clearBounds:     () => void
    clearSession:    () => void
    clearCustomItems:() => void
    clearAll:        () => void
    clearVaultData:  () => void
    onThemeChanged:  (cb: (theme: 'dark' | 'light') => void) => void
    openExternal:    (url: string) => void
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
    onShown:         (cb: () => void) => void
  }

  browser: {
    newTab:        (url?: string) => void
    closeTab:      (tabId: string) => void
    activateTab:   (tabId: string) => void
    navigate:      (tabId: string, input: string) => void
    goBack:        (tabId: string) => void
    goForward:     (tabId: string) => void
    reload:        (tabId: string) => void
    stop:          (tabId: string) => void
    onTabsChanged: (cb: (state: BrowserTabsState) => void) => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
