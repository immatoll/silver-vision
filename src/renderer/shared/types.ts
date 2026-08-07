// ── IPC types shared between preload and renderers ────────────────────────

export interface MenuItem {
  name:      string
  url:       string
  icon?:     string
  width?:    number
  height?:   number
  category?: string
}

export interface CatalogApp {
  name:        string
  url:         string
  description?: string
  category?:   string
  essential?:  boolean
  icon?:       string
  width?:      number
  height?:     number
}

export interface Catalog {
  name?: string
  apps:  CatalogApp[]
}

export interface MenuFolderDef {
  id:    string
  name:  string
  items: string[]  // item keys (url || name)
}

export interface MenuLayout {
  /** Root-level ordered entries: item key OR 'folder:'+id */
  order:     string[]
  folders:   MenuFolderDef[]
  viewMode:  'list' | 'icon'
}

export interface AppConfig {
  defaultOpacityMin:   number
  defaultOpacityMax:   number
  focusGuardMs:        number
  closeOverlaysOnExit: boolean
  eveVaultEnabled:     boolean
}
