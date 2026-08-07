const { app, BrowserWindow, ipcMain, net, screen, session, webContents, WebContentsView } = require('electron')
const fs   = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const EXTENSION_PATH = path.join(__dirname, '../../extension', 'eve-vault-0.14')
  .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
let _eveVaultExtId = null
const AUTO_OPEN_OVERLAY_DEVTOOLS = process.env.EFC_AUTO_OPEN_OVERLAY_DEVTOOLS === '1'

const TITLEBAR_HEIGHT  = 32
const SETTINGS_PANEL_W = 220
const SETTINGS_PANEL_H = 116

const overlayContentViews  = new Map()
const settingsOverlayViews = new Map()

let menuWindow     = null
let settingsWindow = null
let appStoreWindow = null
let _vaultPopupWindow  = null
let _keeperWindow      = null
let _oauthPopupWindow  = null

// ---------------------------------------------------------------------------
// Renderer loading helpers (dev vs. production)
// ---------------------------------------------------------------------------
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD_PATH = path.join(__dirname, '../preload/index.js')

function loadRenderer(win, page, query = {}) {
  if (RENDERER_URL) {
    const qs = new URLSearchParams(query).toString()
    win.loadURL(`${RENDERER_URL}/${page}/index.html${qs ? '?' + qs : ''}`)
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${page}/index.html`), { query })
  }
}

function loadViewRenderer(view, page, query = {}) {
  if (RENDERER_URL) {
    const qs = new URLSearchParams(query).toString()
    view.webContents.loadURL(`${RENDERER_URL}/${page}/index.html${qs ? '?' + qs : ''}`)
  } else {
    view.webContents.loadFile(path.join(__dirname, `../renderer/${page}/index.html`), { query })
  }
}

// Resolve a local relative URL (like "apps/events/index.html") to an absolute
// file:// URL so iframes work regardless of where the renderer HTML is served from.
function resolveOverlayUrl(url) {
  if (!url) return url
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('file://')
  ) return url
  return pathToFileURL(path.join(app.getAppPath(), url)).toString()
}

// ---------------------------------------------------------------------------
// EVE Vault / keeper window
// ---------------------------------------------------------------------------
ipcMain.handle('eveVault:getExtId', async () => _eveVaultExtId)

function createKeeperWindow(extId) {
  if (_keeperWindow && !_keeperWindow.isDestroyed()) return
  _keeperWindow = new BrowserWindow({
    show: false, width: 1, height: 1,
    webPreferences: {
      session: session.fromPartition('persist:overlay'),
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/keeper.js'),
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  })
  _keeperWindow.loadURL(`chrome-extension://${extId}/keeper.html`)
  _keeperWindow.webContents.on('did-finish-load', () => {
    _keeperWindow.webContents.executeJavaScript(`
      (function() {
        if (typeof chrome === 'undefined' || !chrome.runtime) return;
        chrome.runtime.onMessage.addListener(function(msg) {
          if (!msg || typeof window.__efcKeeperIpc === 'undefined') return false;
          if (msg.type === 'OPEN_VAULT_WINDOW' && msg.url) {
            window.__efcKeeperIpc.openWindow(msg.url);
          } else if (msg.type === 'OPEN_OAUTH_POPUP' && msg.url) {
            window.__efcKeeperIpc.openOAuthPopup(msg.url);
          } else if (msg.type === 'RELAY_TAB_MESSAGE' && msg.message) {
            window.__efcKeeperIpc.relayTabMessage(msg.message);
          }
          return false;
        });
      })();
    `).catch(e => console.error('[EFC] Failed to inject keeper message relay:', e))
  })
  _keeperWindow.on('closed', () => { _keeperWindow = null })
}

// ---------------------------------------------------------------------------
// Bounds store
// ---------------------------------------------------------------------------
let _boundsPath  = null
let _boundsCache = null

function getBoundsStore() {
  if (!_boundsPath) _boundsPath = path.join(app.getPath('userData'), 'window-bounds.json')
  if (!_boundsCache) {
    try { _boundsCache = JSON.parse(fs.readFileSync(_boundsPath, 'utf8')) } catch (_) { _boundsCache = {} }
  }
  return _boundsCache
}

function saveBoundsStore() {
  try { fs.writeFileSync(_boundsPath, JSON.stringify(_boundsCache, null, 2)) } catch (_) {}
}

function loadBounds(key) { return getBoundsStore()[key] || null }

function saveBounds(key, bounds) {
  getBoundsStore()[key] = bounds
  saveBoundsStore()
}

// ---------------------------------------------------------------------------
// Global config store
// ---------------------------------------------------------------------------
let _configPath  = null
let _configCache = null

const CONFIG_DEFAULTS = {
  defaultOpacityMin:   0.5,
  defaultOpacityMax:   1.0,
  focusGuardMs:        500,
  closeOverlaysOnExit: true,
  eveVaultEnabled:     false
}

function getConfig() {
  if (!_configPath) _configPath = path.join(app.getPath('userData'), 'efc-config.json')
  if (!_configCache) {
    try { _configCache = JSON.parse(fs.readFileSync(_configPath, 'utf8')) }
    catch (_) { _configCache = {} }
  }
  return _configCache
}

function saveConfig() {
  try { fs.writeFileSync(_configPath, JSON.stringify(_configCache, null, 2)) } catch (_) {}
}

function getConfigValue(key) {
  return getConfig()[key] ?? CONFIG_DEFAULTS[key]
}

// ---------------------------------------------------------------------------
// Custom menu items — stored in userData instead of menu window's localStorage
// ---------------------------------------------------------------------------
let _itemsPath  = null
let _itemsCache = null

function getItemsPath() {
  if (!_itemsPath) _itemsPath = path.join(app.getPath('userData'), 'custom-items.json')
  return _itemsPath
}

function getCustomItems() {
  if (_itemsCache !== null) return _itemsCache
  try { _itemsCache = JSON.parse(fs.readFileSync(getItemsPath(), 'utf8')) }
  catch (_) { _itemsCache = [] }
  return _itemsCache
}

function saveCustomItems(items) {
  _itemsCache = items
  try { fs.writeFileSync(getItemsPath(), JSON.stringify(items, null, 2)) } catch (_) {}
}

// ---------------------------------------------------------------------------
// Menu layout (folders + view mode) — stored in userData
// ---------------------------------------------------------------------------
let _layoutPath  = null
let _layoutCache = null

function getLayoutPath() {
  if (!_layoutPath) _layoutPath = path.join(app.getPath('userData'), 'menu-layout.json')
  return _layoutPath
}

function getMenuLayout() {
  if (_layoutCache !== null) return _layoutCache
  try { _layoutCache = JSON.parse(fs.readFileSync(getLayoutPath(), 'utf8')) }
  catch (_) { _layoutCache = null }
  return _layoutCache
}

function saveMenuLayout(layout) {
  _layoutCache = layout
  try { fs.writeFileSync(getLayoutPath(), JSON.stringify(layout, null, 2)) } catch (_) {}
}

function notifyMenuItems() {
  if (menuWindow && !menuWindow.isDestroyed()) {
    try { menuWindow.webContents.send('menu:itemsChanged', getCustomItems()) } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Window animators / overlay tracking
// ---------------------------------------------------------------------------
const windowAnimators         = new Map()
const openOverlays            = new Map()
const overlayKeys             = new Map()
const collapseRestoreHeights  = new Map()

function makeFadeController(win, minOpacity = 0.1) {
  let fadeTimer    = null
  let isFocused    = false
  let isMouseOver  = false
  let cursorWatcher = null

  const animateTo = (target, duration = 250) => {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
    if (win.isDestroyed()) return
    const start = win.getOpacity()
    if (Math.abs(start - target) < 0.01) return
    const t0 = Date.now()
    fadeTimer = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(fadeTimer); fadeTimer = null; return }
      const t = Math.min(1, (Date.now() - t0) / duration)
      try { win.setOpacity(start + (target - start) * t) } catch (_) {}
      if (t >= 1) { clearInterval(fadeTimer); fadeTimer = null }
    }, 16)
  }

  const update = () => animateTo((isFocused || isMouseOver) ? 1 : minOpacity)

  const startWatcher = () => {
    if (cursorWatcher) return
    cursorWatcher = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(cursorWatcher); cursorWatcher = null; return }
      const p = screen.getCursorScreenPoint()
      const b = win.getBounds()
      const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
      if (inside !== isMouseOver) { isMouseOver = inside; update() }
    }, 120)
  }
  const stopWatcher = () => { if (cursorWatcher) { clearInterval(cursorWatcher); cursorWatcher = null } }

  win.on('focus', () => { isFocused = true;  stopWatcher(); update() })
  win.on('blur',  () => { isFocused = false; startWatcher(); update() })

  return {
    setMouse: (v) => { isMouseOver = !!v; if (v) stopWatcher(); update() },
    cleanup:  () => { stopWatcher(); if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null } }
  }
}

function makeOverlayController(win, initialPinned = false, initialOpacityMin = 0.3, initialOpacityMax = 0.9) {
  let OPACITY_ACTIVE = initialOpacityMax
  let OPACITY_DIM    = initialOpacityMin
  const HIDE_DELAY_MS = 800
  const FADE_MS       = 700

  let isPinned    = initialPinned
  let isCollapsed = false
  let isVisible   = true
  let isMoving    = false
  let cursorWatcher = null
  let pendingHide   = null
  let moveTimeout   = null
  let fadeTimer     = null

  const smoothstep = (t) => t * t * (3 - 2 * t)

  const animateTo = (target) => {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
    if (win.isDestroyed()) return
    let start
    try { start = win.getOpacity() } catch (_) { return }
    if (Math.abs(start - target) < 0.01) { try { win.setOpacity(target) } catch (_) {}; return }
    const t0 = Date.now()
    fadeTimer = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(fadeTimer); fadeTimer = null; return }
      const t = Math.min(1, (Date.now() - t0) / FADE_MS)
      try { win.setOpacity(start + (target - start) * smoothstep(t)) } catch (_) {}
      if (t >= 1) { clearInterval(fadeTimer); fadeTimer = null }
    }, 16)
  }

  const sendVisible = (v) => {
    if (win.isDestroyed()) return
    isVisible = v
    try { win.webContents.send('chrome:setVisible', v) } catch (_) {}
  }

  const showChrome = () => {
    if (pendingHide) { clearTimeout(pendingHide); pendingHide = null }
    animateTo(OPACITY_ACTIVE)
    if (!isVisible) sendVisible(true)
  }

  const scheduleHide = () => {
    if (isPinned || isMoving || isCollapsed || pendingHide) return
    pendingHide = setTimeout(() => {
      pendingHide = null
      if (isPinned || isMoving || isCollapsed) return
      animateTo(OPACITY_DIM)
      sendVisible(false)
    }, HIDE_DELAY_MS)
  }

  win.on('move', () => {
    isMoving = true; showChrome()
    if (moveTimeout) clearTimeout(moveTimeout)
    moveTimeout = setTimeout(() => {
      isMoving = false
      if (!isPinned && !isCollapsed) {
        const p = screen.getCursorScreenPoint()
        const b = win.getBounds()
        const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
        if (!inside) scheduleHide()
      }
    }, 500)
  })

  const startWatcher = () => {
    if (cursorWatcher) return
    const p0 = screen.getCursorScreenPoint()
    const b0 = win.getBounds()
    let wasInside = p0.x >= b0.x && p0.x < b0.x + b0.width && p0.y >= b0.y && p0.y < b0.y + b0.height
    cursorWatcher = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(cursorWatcher); cursorWatcher = null; return }
      const p = screen.getCursorScreenPoint()
      const b = win.getBounds()
      const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
      if (inside && pendingHide) showChrome()
      if (inside === wasInside) return
      wasInside = inside
      if (inside) showChrome(); else scheduleHide()
    }, 60)
  }

  try { win.setOpacity(OPACITY_ACTIVE) } catch (_) {}
  startWatcher()

  return {
    setMouse: (v) => { if (v) showChrome(); else scheduleHide() },
    setPin: (v) => {
      isPinned = v
      if (isPinned) {
        showChrome()
      } else {
        const p = screen.getCursorScreenPoint()
        const b = win.getBounds()
        const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
        if (!inside) scheduleHide()
      }
    },
    setCollapsed: (v) => {
      isCollapsed = v
      if (isCollapsed) showChrome()
    },
    setOpacityRange: (min, max) => {
      OPACITY_DIM    = min
      OPACITY_ACTIVE = max
      animateTo(isVisible ? OPACITY_ACTIVE : OPACITY_DIM)
    },
    cleanup: () => {
      if (cursorWatcher) { clearInterval(cursorWatcher); cursorWatcher = null }
      if (pendingHide)   { clearTimeout(pendingHide);   pendingHide = null }
      if (moveTimeout)   { clearTimeout(moveTimeout);   moveTimeout = null }
      if (fadeTimer)     { clearInterval(fadeTimer);    fadeTimer = null }
    }
  }
}

// ---------------------------------------------------------------------------
// Window focus / z-order helpers
// ---------------------------------------------------------------------------
// Call on every alwaysOnTop window so that:
//   • clicking it raises it above sibling overlay windows  (moveTop)
//   • Windows OS won't silently clear the topmost flag     (re-assert on blur)
function setupAlwaysOnTopBehavior(win) {
  win.on('focus', () => {
    if (!win.isDestroyed()) {
      try { win.moveTop() } catch (_) {}
    }
  })
  win.on('blur', () => {
    if (!win.isDestroyed()) {
      try { win.setAlwaysOnTop(true) } catch (_) {}
    }
  })
}

// ---------------------------------------------------------------------------
// Menu window
// ---------------------------------------------------------------------------
function createMenu() {
  menuWindow = new BrowserWindow({
    width: 250, height: 420,
    minHeight: 420, maxHeight: 1100,
    minWidth: 250, maxWidth: 250,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  })
  loadRenderer(menuWindow, 'menu')
  menuWindow.setOpacity(1.0)
  setupAlwaysOnTopBehavior(menuWindow)
  menuWindow.on('closed', () => {
    if (getConfigValue('closeOverlaysOnExit')) {
      for (const win of openOverlays.values()) {
        if (!win.isDestroyed()) win.destroy()
      }
      app.quit()
    }
  })
}

// ---------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return }
  settingsWindow = new BrowserWindow({
    width: 460, height: 520,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  })
  loadRenderer(settingsWindow, 'settings')
  settingsWindow.setOpacity(1.0)
  setupAlwaysOnTopBehavior(settingsWindow)
  settingsWindow.on('closed', () => {
    settingsWindow = null
    if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('settings:closed')
  })
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('settings:opened')
}

// ---------------------------------------------------------------------------
// App Store window
// ---------------------------------------------------------------------------
function createAppStoreWindow() {
  if (appStoreWindow && !appStoreWindow.isDestroyed()) { appStoreWindow.focus(); return }
  appStoreWindow = new BrowserWindow({
    width: 500, height: 760,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  })
  loadRenderer(appStoreWindow, 'appstore')
  appStoreWindow.setOpacity(1.0)
  setupAlwaysOnTopBehavior(appStoreWindow)
  appStoreWindow.on('closed', () => {
    appStoreWindow = null
    if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('appstore:closed')
  })
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('appstore:opened')
}

// ---------------------------------------------------------------------------
// Overlay window
// ---------------------------------------------------------------------------
function createOverlayWindow({ title = 'Overlay', url = '', width = 800, height = 600 } = {}) {
  const resolvedUrl = resolveOverlayUrl(url)
  const key = url || title  // key uses original url for stable identity

  const existing = openOverlays.get(key)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }

  const saved  = loadBounds(key)
  const initW  = saved ? saved.width  : width
  const initH  = saved ? saved.height : height
  const initX  = saved ? saved.x      : undefined
  const initY  = saved ? saved.y      : undefined

  const winOpts = {
    width: initW, height: initH,
    minWidth: 300, minHeight: 200,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  }
  if (initX !== undefined) { winOpts.x = initX; winOpts.y = initY }

  const win = new BrowserWindow(winOpts)

  const initialPinned     = saved ? !!saved.pinned                                              : false
  const initialOpacityMin = saved ? (saved.opacityMin ?? getConfigValue('defaultOpacityMin'))  : getConfigValue('defaultOpacityMin')
  const initialOpacityMax = saved ? (saved.opacityMax ?? getConfigValue('defaultOpacityMax'))  : getConfigValue('defaultOpacityMax')

  const isManagedUrl = resolvedUrl && (
    resolvedUrl.startsWith('http://') ||
    resolvedUrl.startsWith('https://') ||
    resolvedUrl.startsWith('chrome-extension://')
  )

  let _contentView = null
  if (isManagedUrl) {
    try {
      _contentView = new WebContentsView({
        webPreferences: {
          session: session.fromPartition('persist:overlay'),
          contextIsolation: true,
          nodeIntegration: false,
          devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
        }
      })
      win.contentView.addChildView(_contentView)
      const updateViewBounds = () => {
        if (!_contentView || win.isDestroyed()) return
        try {
          const b = win.getBounds()
          _contentView.setBounds({ x: 1, y: TITLEBAR_HEIGHT, width: Math.max(0, b.width - 2), height: Math.max(0, b.height - TITLEBAR_HEIGHT - 1) })
        } catch (_) {}
      }
      updateViewBounds()
      _contentView.webContents.loadURL(resolvedUrl)
      _contentView.webContents.setWindowOpenHandler(({ url: newUrl }) => {
        if (newUrl && newUrl.startsWith('chrome-extension://')) {
          try { openExtensionWindow(newUrl) } catch (_) {}
          return { action: 'deny' }
        }
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              session: session.fromPartition('persist:overlay'),
              contextIsolation: true,
              nodeIntegration: false
            },
            alwaysOnTop: true, width: 520, height: 650, title: 'EVE Vault'
          }
        }
      })
      _contentView.webContents.on('did-create-window', (popupWin) => {
        popupWin.once('ready-to-show', () => { try { popupWin.show(); popupWin.moveTop(); popupWin.focus() } catch (_) {} })
        setupAlwaysOnTopBehavior(popupWin)
      })
      if (AUTO_OPEN_OVERLAY_DEVTOOLS) {
        try { _contentView.webContents.openDevTools({ mode: 'detach' }) } catch (_) {}
      }
      overlayContentViews.set(win.id, { view: _contentView, updateBounds: updateViewBounds })
    } catch (err) {
      console.error('[EFC] Failed to create WebContentsView for overlay:', err)
      _contentView = null
    }
  }

  // Settings panel (WebContentsView, above content)
  try {
    const settingsView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: PRELOAD_PATH,
        devTools: false
      }
    })
    win.contentView.addChildView(settingsView)
    settingsView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    loadViewRenderer(settingsView, 'settingsPanel', {
      opacityMin: String(initialOpacityMin),
      opacityMax: String(initialOpacityMax)
    })
    const sEntry = { view: settingsView, visible: false }
    settingsOverlayViews.set(win.id, sEntry)
    if (_contentView) {
      _contentView.webContents.on('focus', () => {
        if (!sEntry.visible) return
        sEntry.visible = false
        try { settingsView.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch (_) {}
        try { win.webContents.send('chrome:settingsMenuClosed') } catch (_) {}
      })
    }
  } catch (err) {
    console.error('[EFC] Failed to create settings overlay view:', err)
  }

  // Overlay renderer — pass empty url if WebContentsView is handling the content
  loadRenderer(win, 'window', {
    title,
    url:        _contentView ? '' : (resolvedUrl || ''),
    pinned:     initialPinned ? '1' : '0',
    opacityMin: String(initialOpacityMin),
    opacityMax: String(initialOpacityMax)
  })

  if (AUTO_OPEN_OVERLAY_DEVTOOLS) {
    try { win.webContents.openDevTools({ mode: 'detach' }) } catch (e) {}
  }

  openOverlays.set(key, win)
  overlayKeys.set(win.id, key)
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('overlay:opened', key)

  const ctrl = makeOverlayController(win, initialPinned, initialOpacityMin, initialOpacityMax)
  windowAnimators.set(win.id, ctrl)
  setupAlwaysOnTopBehavior(win)

  let lastBounds = win.getBounds()
  win.on('resize', () => {
    try { lastBounds = win.getBounds() } catch (_) {}
    overlayContentViews.get(win.id)?.updateBounds()
    const sEntry = settingsOverlayViews.get(win.id)
    if (sEntry && sEntry.visible) {
      try {
        const b = win.getBounds()
        sEntry.view.setBounds({ x: b.width - SETTINGS_PANEL_W - 1, y: TITLEBAR_HEIGHT, width: SETTINGS_PANEL_W, height: SETTINGS_PANEL_H })
      } catch (_) {}
    }
  })
  win.on('move', () => { try { lastBounds = win.getBounds() } catch (_) {} })

  win.on('closed', () => {
    try {
      const entry    = getBoundsStore()[key] || {}
      const restoreH = collapseRestoreHeights.get(win.id)
      const bounds   = restoreH ? { ...lastBounds, height: restoreH } : lastBounds
      collapseRestoreHeights.delete(win.id)
      saveBounds(key, { ...entry, ...bounds })
    } catch (_) {}
    ctrl.cleanup()
    try {
      const sEntry = settingsOverlayViews.get(win.id)
      if (sEntry?.view) {
        try { sEntry.view.webContents.close() } catch (_) {}
        try { win.contentView.removeChildView(sEntry.view) } catch (_) {}
      }
    } catch (_) {}
    settingsOverlayViews.delete(win.id)
    try {
      const cvEntry = overlayContentViews.get(win.id)
      if (cvEntry?.view) {
        try { cvEntry.view.webContents.close() } catch (_) {}
        try { win.contentView.removeChildView(cvEntry.view) } catch (_) {}
      }
    } catch (_) {}
    overlayContentViews.delete(win.id)
    windowAnimators.delete(win.id)
    overlayKeys.delete(win.id)
    openOverlays.delete(key)
    if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('overlay:closed', key)
  })

  return win
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Prevent multiple instances from fighting over the same LevelDB/IndexedDB
// lock files in the persist:overlay partition.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // If a second launch is attempted, focus the existing menu window instead.
    if (menuWindow && !menuWindow.isDestroyed()) {
      if (menuWindow.isMinimized()) menuWindow.restore()
      menuWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  const overlaySession = session.fromPartition('persist:overlay')

  function _relayOAuthUrl(url) {
    console.log('[EFC] OAuth redirect captured:', url)
    const relay = (_keeperWindow && !_keeperWindow.isDestroyed()) ? _keeperWindow
                : (_vaultPopupWindow && !_vaultPopupWindow.isDestroyed()) ? _vaultPopupWindow
                : null
    if (relay) {
      relay.webContents.executeJavaScript(
        `chrome.runtime.sendMessage({type:'OAUTH_REDIRECT',url:${JSON.stringify(url)}})`
      ).then(() => console.log('[EFC] OAUTH_REDIRECT relayed OK'))
       .catch(e => console.error('[EFC] OAUTH_REDIRECT relay failed:', e))
    } else {
      console.warn('[EFC] No relay window available for OAUTH_REDIRECT')
    }
    if (_vaultPopupWindow && !_vaultPopupWindow.isDestroyed()) {
      try { _vaultPopupWindow.webContents.send('extension:oauthRedirect', url) } catch (_) {}
    }
    if (_oauthPopupWindow && !_oauthPopupWindow.isDestroyed()) {
      try { _oauthPopupWindow.close() } catch (_) {}
    }
  }

  function _onOAuthRedirect(details, callback) {
    _relayOAuthUrl(details.url)
    callback({ cancel: true })
  }

  overlaySession.webRequest.onBeforeRequest({ urls: ['*://*.chromiumapp.org/*'] }, _onOAuthRedirect)
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*.chromiumapp.org/*'] }, _onOAuthRedirect)

  app.on('web-contents-created', (_e, wc) => {
    wc.on('did-navigate', (_ev, url) => {
      let isCallback = false
      try { isCallback = new URL(url).hostname.endsWith('.chromiumapp.org') } catch (_) {}
      if (isCallback) { _relayOAuthUrl(url); try { wc.close() } catch (_) {} }
    })
    wc.on('will-navigate', (ev, url) => {
      let isCallback = false
      try { isCallback = new URL(url).hostname.endsWith('.chromiumapp.org') } catch (_) {}
      if (isCallback) { ev.preventDefault(); _relayOAuthUrl(url) }
    })
  })

  if (getConfigValue('eveVaultEnabled')) {
    try {
      const ext = await overlaySession.extensions.loadExtension(EXTENSION_PATH, { allowFileAccess: true })
      _eveVaultExtId = ext.id
      console.log('[EFC] EVE Vault auto-loaded:', _eveVaultExtId)
      createKeeperWindow(_eveVaultExtId)
    } catch (err) {
      console.error('[EFC] Failed to auto-load EVE Vault extension:', err)
    }
  }

  createMenu()
})

app.on('window-all-closed', () => app.quit())

// ---------------------------------------------------------------------------
// IPC — Window controls
// ---------------------------------------------------------------------------
ipcMain.on('renderer:mouseenter', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) windowAnimators.get(win.id)?.setMouse(true)
})
ipcMain.on('renderer:mouseleave', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) windowAnimators.get(win.id)?.setMouse(false)
})

// Every window here is alwaysOnTop, so minimizing just the one that was
// clicked would leave every other overlay still covering the screen — the
// desktop/taskbar would never actually become visible. Minimize them all
// together instead, like clicking "Show Desktop" would.
ipcMain.on('window:minimize', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.isMinimized()) win.minimize()
  }
})

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.destroy()
})

ipcMain.on('overlay:close', (_event, key) => {
  const win = openOverlays.get(key)
  if (win && !win.isDestroyed()) win.destroy()
})

ipcMain.on('window:togglePin', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const key = overlayKeys.get(win.id)
  if (!key) return
  const store = getBoundsStore()
  const entry = store[key] || {}
  const newPinned = !entry.pinned
  entry.pinned = newPinned
  store[key] = entry
  saveBoundsStore()
  windowAnimators.get(win.id)?.setPin(newPinned)
  try { win.webContents.send('chrome:pinChanged', newPinned) } catch (_) {}
})

ipcMain.on('window:setOpacityRange', (event, { min, max }) => {
  let win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    for (const [winId, sEntry] of settingsOverlayViews) {
      if (sEntry.view && sEntry.view.webContents === event.sender) {
        win = BrowserWindow.fromId(winId); break
      }
    }
  }
  if (!win) return
  const key = overlayKeys.get(win.id)
  if (!key) return
  const store = getBoundsStore()
  const entry = store[key] || {}
  entry.opacityMin = min; entry.opacityMax = max
  store[key] = entry
  saveBoundsStore()
  windowAnimators.get(win.id)?.setOpacityRange(min, max)
})

ipcMain.on('window:setCollapsed', (event, { collapsed, restoreHeight }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  try {
    const b = win.getBounds()
    if (collapsed) {
      collapseRestoreHeights.set(win.id, restoreHeight || b.height)
      win.setMinimumSize(300, 32)
      win.setBounds({ ...b, height: 32 })
      const cvEntry = overlayContentViews.get(win.id)
      if (cvEntry) try { cvEntry.view.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width: b.width, height: 0 }) } catch (_) {}
    } else {
      const h = restoreHeight || collapseRestoreHeights.get(win.id) || 400
      collapseRestoreHeights.delete(win.id)
      win.setMinimumSize(300, 200)
      win.setBounds({ ...b, height: h })
      const cvEntry = overlayContentViews.get(win.id)
      if (cvEntry) setTimeout(() => { try { cvEntry.updateBounds() } catch (_) {} }, 50)
    }
  } catch (_) {}
  windowAnimators.get(win.id)?.setCollapsed(collapsed)
})

ipcMain.handle('window:getBounds', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.getBounds()
})

ipcMain.on('window:setBounds', (event, bounds) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win.setBounds({
    x: Math.round(bounds.x), y: Math.round(bounds.y),
    width: Math.max(300, Math.round(bounds.width)),
    height: Math.max(200, Math.round(bounds.height))
  })
})

ipcMain.on('window:settingsMenuVisible', (event, visible) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const sEntry = settingsOverlayViews.get(win.id)
  if (!sEntry) return
  sEntry.visible = visible
  try {
    if (visible) {
      const b = win.getBounds()
      sEntry.view.setBounds({ x: b.width - SETTINGS_PANEL_W - 1, y: TITLEBAR_HEIGHT, width: SETTINGS_PANEL_W, height: SETTINGS_PANEL_H })
    } else {
      sEntry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  } catch (_) {}
})

ipcMain.on('menu:openOverlay', (event, payload) => {
  const opts = payload && typeof payload === 'object' ? payload : { title: String(payload || '') }
  createOverlayWindow(opts)
})

ipcMain.on('menu:openSettings', () => createSettingsWindow())
ipcMain.on('menu:openAppStore', () => createAppStoreWindow())

ipcMain.on('settings:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.destroy()
})

// ---------------------------------------------------------------------------
// IPC — App Store
// ---------------------------------------------------------------------------
ipcMain.handle('appstore:fetchCatalog', async (_, url) => {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Only http/https URLs are supported' }
    const response = await net.fetch(url)
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const text = await response.text()
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: String(err.message || err) }
  }
})

// ---------------------------------------------------------------------------
// IPC — Custom menu items (file-backed)
// ---------------------------------------------------------------------------
ipcMain.handle('menu:getCustomItems', async () => getCustomItems())

// ---------------------------------------------------------------------------
// IPC — Menu layout (folders + view mode)
// ---------------------------------------------------------------------------
ipcMain.handle('menu:getLayout', async () => getMenuLayout())

ipcMain.on('menu:saveLayout', (_, layout) => {
  if (!layout || typeof layout !== 'object') return
  saveMenuLayout({
    order: Array.isArray(layout.order)
      ? layout.order.filter(s => typeof s === 'string').slice(0, 500)
      : [],
    folders: Array.isArray(layout.folders)
      ? layout.folders
          .filter(f => f && typeof f.id === 'string')
          .map(f => ({
            id:    String(f.id).slice(0, 36),
            name:  String(f.name || '').slice(0, 100),
            items: Array.isArray(f.items) ? f.items.filter(s => typeof s === 'string').slice(0, 200) : []
          }))
      : [],
    viewMode: layout.viewMode === 'icon' ? 'icon' : 'list'
  })
})

ipcMain.handle('menu:addCustomItem', async (_, item) => {
  if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') return { ok: false, error: 'Invalid item' }
  if (item.url.includes('://')) {
    try {
      const p = new URL(item.url)
      if (!['http:', 'https:', 'file:'].includes(p.protocol)) return { ok: false, error: 'Invalid URL scheme' }
    } catch { return { ok: false, error: 'Invalid URL' } }
  }
  const sanitized = {
    name:     String(item.name).slice(0, 100),
    url:      String(item.url),
    icon:     String(item.icon || '').slice(0, 2048),
    width:    Math.max(200, Math.min(3840, Number(item.width)  || 800)),
    height:   Math.max(200, Math.min(2160, Number(item.height) || 600)),
    category: String(item.category || '').slice(0, 50)
  }
  const items = getCustomItems()
  if (!items.some(i => i.url === sanitized.url)) {
    items.push(sanitized)
    saveCustomItems(items)
    notifyMenuItems()
  }
  return { ok: true }
})

ipcMain.handle('menu:removeCustomItem', async (_, { url }) => {
  if (typeof url !== 'string') return { ok: false }
  const items = getCustomItems().filter(i => i.url !== url)
  saveCustomItems(items)
  notifyMenuItems()
  return { ok: true }
})

// ---------------------------------------------------------------------------
// IPC — Catalog (read/write catalog.json)
// ---------------------------------------------------------------------------
ipcMain.handle('catalog:read', async () => {
  try {
    const catalogPath = path.join(app.getAppPath(), '/src/catalog/catalog.json')
    const text = fs.readFileSync(catalogPath, 'utf8')
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})

ipcMain.handle('catalog:write', async (_, content) => {
  if (typeof content !== 'string') return { ok: false, error: 'Invalid content' }
  try {
    const catalogPath = path.join(app.getAppPath(), '/src/catalog/catalog.json')
    fs.writeFileSync(catalogPath, content, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})

// ---------------------------------------------------------------------------
// IPC — Settings
// ---------------------------------------------------------------------------
ipcMain.handle('settings:getAll', () => ({ ...CONFIG_DEFAULTS, ...getConfig() }))

ipcMain.on('settings:set', (_, key, value) => {
  if (!(key in CONFIG_DEFAULTS)) return
  getConfig()[key] = value
  saveConfig()
})

ipcMain.on('settings:clearBounds', () => {
  _boundsCache = {}; saveBoundsStore()
})

ipcMain.on('settings:clearSession', () => {
  const s = session.fromPartition('persist:overlay')
  s.clearCache().catch(() => {})
  s.clearStorageData().catch(() => {})
})

ipcMain.on('settings:clearCustomItems', () => {
  saveCustomItems([])
  notifyMenuItems()
})

ipcMain.on('settings:clearAll', () => {
  _boundsCache = {}; saveBoundsStore()
  _configCache = {}; saveConfig()
  saveCustomItems([])
  notifyMenuItems()
  const s = session.fromPartition('persist:overlay')
  s.clearCache().catch(() => {})
  s.clearStorageData().catch(() => {})
})

ipcMain.on('settings:clearVaultData', () => {
  if (_keeperWindow && !_keeperWindow.isDestroyed()) {
    _keeperWindow.webContents.executeJavaScript('chrome.storage.local.clear()').catch(() => {})
  }
  if (_eveVaultExtId) {
    session.fromPartition('persist:overlay').clearStorageData({
      origin: `chrome-extension://${_eveVaultExtId}`,
      storages: ['localstorage', 'indexeddb', 'cookies']
    }).catch(() => {})
  }
})

// ---------------------------------------------------------------------------
// IPC — EVE Vault extension toggle
// ---------------------------------------------------------------------------
ipcMain.handle('extension:getState', () => ({ loaded: !!_eveVaultExtId, id: _eveVaultExtId }))

ipcMain.on('extension:toggle', async () => {
  const s = session.fromPartition('persist:overlay')
  if (_eveVaultExtId) {
    try { s.extensions.removeExtension(_eveVaultExtId) } catch (_) {}
    _eveVaultExtId = null
    if (_keeperWindow && !_keeperWindow.isDestroyed()) { try { _keeperWindow.destroy() } catch (_) {} }
    _keeperWindow = null
    getConfig().eveVaultEnabled = false; saveConfig()
    if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('extension:stateChanged', false)
  } else {
    try {
      const ext = await s.extensions.loadExtension(EXTENSION_PATH, { allowFileAccess: true })
      _eveVaultExtId = ext.id
      console.log('[EFC] EVE Vault toggled on:', _eveVaultExtId)
      createKeeperWindow(_eveVaultExtId)
      setTimeout(() => {
        if (!_eveVaultExtId) return
        if (_vaultPopupWindow && !_vaultPopupWindow.isDestroyed()) { _vaultPopupWindow.focus(); return }
        _vaultPopupWindow = openExtensionWindow(`chrome-extension://${_eveVaultExtId}/popup.html`, { width: 516, height: 620 })
        _vaultPopupWindow.on('closed', () => { _vaultPopupWindow = null })
      }, 800)
      getConfig().eveVaultEnabled = true; saveConfig()
      if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('extension:stateChanged', true)
    } catch (err) {
      console.error('[EFC] Failed to load EVE Vault extension:', err)
    }
  }
})

function openExtensionWindow(url, opts = {}) {
  // Electron centers a new window with no explicit position, so two vault
  // action popups opened back-to-back (e.g. sign-message then sign-and-
  // execute-transaction, both alwaysOnTop) land exactly on top of each
  // other — the newer one fully hides the older still-pending one, which
  // reads as the flow being "stuck" when really it's just buried. Cascade
  // each new vault window a bit so a still-open one stays visible/reachable.
  const openVaultWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.getTitle() === 'EVE Vault')
  const cascade = openVaultWindows.length * 32
  const win = new BrowserWindow({
    width: opts.width || 500, height: opts.height || 600,
    resizable: false, alwaysOnTop: true, title: 'EVE Vault', show: false,
    webPreferences: {
      session: session.fromPartition('persist:overlay'),
      contextIsolation: false,
      nodeIntegration: false,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS,
      preload: path.join(__dirname, '../preload/extension.js')
    }
  })
  win.setMenu(null)
  if (cascade > 0) {
    try {
      const { workArea } = screen.getPrimaryDisplay()
      const w = opts.width || 500, h = opts.height || 600
      const baseX = workArea.x + Math.round((workArea.width - w) / 2)
      const baseY = workArea.y + Math.round((workArea.height - h) / 2)
      win.setPosition(baseX + cascade, baseY + cascade)
    } catch (_) {}
  }
  win.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    if (newUrl && (newUrl.startsWith('https://') || newUrl.startsWith('http://'))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560, height: 680, alwaysOnTop: true, show: false,
          webPreferences: {
            session: session.fromPartition('persist:overlay'),
            contextIsolation: false, nodeIntegration: false, devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
          }
        }
      }
    }
    return { action: 'deny' }
  })
  win.webContents.on('did-create-window', (childWin) => {
    childWin.setMenu(null)
    childWin.once('ready-to-show', () => { try { childWin.show(); childWin.moveTop(); childWin.focus() } catch (_) {} })
    setupAlwaysOnTopBehavior(childWin)
    if (_oauthPopupWindow && !_oauthPopupWindow.isDestroyed()) { try { _oauthPopupWindow.close() } catch (_) {} }
    _oauthPopupWindow = childWin
    childWin.on('closed', () => { if (_oauthPopupWindow === childWin) _oauthPopupWindow = null })
  })
  win.webContents.on('did-start-loading', () => {
    console.log('[EFC] vault window did-start-loading:', url)
  })
  win.webContents.on('dom-ready', () => {
    console.log('[EFC] vault window dom-ready:', win.webContents.getURL())
  })
  win.webContents.on('did-finish-load', () => {
    console.log('[EFC] vault window did-finish-load:', win.webContents.getURL())
    if (AUTO_OPEN_OVERLAY_DEVTOOLS) {
      try { win.webContents.openDevTools({ mode: 'detach' }) } catch (_) {}
    }
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('[EFC] vault window console:', { level, message, line, sourceId, url: win.webContents.getURL() })
  })
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[EFC] vault window failed to load:', { errorCode, errorDescription, validatedURL })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[EFC] vault window renderer crashed/gone:', details)
  })
  win.webContents.on('unresponsive', () => {
    console.error('[EFC] vault window became unresponsive:', win.webContents.getURL())
  })
  win.loadURL(url)
  win.once('ready-to-show', () => { win.show(); win.moveTop(); win.focus() })
  setupAlwaysOnTopBehavior(win)
  return win
}

// Relays a background.js -> tab message (normally chrome.tabs.sendMessage,
// which the extension uses to tell a dApp page its transaction result) by
// injecting the equivalent window.postMessage directly into every open
// overlay's WebContentsView. Electron's chrome.tabs doesn't appear to track
// WebContentsView-hosted content as an addressable tab, so the extension's
// own delivery silently no-ops — the transaction succeeds but the page never
// hears about it and sits in a "working" state forever. This bypasses that
// broken hop entirely, mirroring exactly what the extension's own content
// script (content.ts's forwardToPage/postToPage) would have sent.
ipcMain.on('extension:relayTabMessage', (_event, message) => {
  if (!message || typeof message !== 'object') return
  console.log('[EFC] relaying tab message directly into overlay page(s):', message)
  const payload = JSON.stringify({ ...message, __from: 'Eve Vault' })
  for (const { view } of overlayContentViews.values()) {
    try {
      view.webContents.executeJavaScript(
        `window.postMessage(${payload}, window.location.origin)`
      ).catch(() => {})
    } catch (_) {}
  }
})

ipcMain.on('extension:requestOpenWindow', (event, url) => {
  console.log('[EFC] extension:requestOpenWindow received:', url, '| extId:', _eveVaultExtId)
  if (!url || typeof url !== 'string') return
  if (!_eveVaultExtId || !url.startsWith(`chrome-extension://${_eveVaultExtId}/`)) {
    console.warn('[EFC] extension:requestOpenWindow rejected — url does not match extension id')
    return
  }
  const existing = BrowserWindow.getAllWindows().find(w => {
    try { return !w.isDestroyed() && w.webContents.getURL().startsWith(url.split('?')[0]) } catch (_) { return false }
  })
  if (existing) { existing.focus(); return }
  openExtensionWindow(url)
})

ipcMain.on('extension:openOAuthPopup', (event, url) => {
  if (!url || typeof url !== 'string') return
  if (!url.startsWith('https://') && !url.startsWith('http://')) return
  if (_oauthPopupWindow && !_oauthPopupWindow.isDestroyed()) { _oauthPopupWindow.focus(); return }
  _oauthPopupWindow = new BrowserWindow({
    width: 600, height: 720, resizable: true, alwaysOnTop: true, title: 'EVE Login', show: false,
    webPreferences: {
      session: session.fromPartition('persist:overlay'),
      contextIsolation: false, nodeIntegration: false, devTools: false
    }
  })
  _oauthPopupWindow.setMenu(null)
  _oauthPopupWindow.loadURL(url)
  _oauthPopupWindow.once('ready-to-show', () => { _oauthPopupWindow.show(); _oauthPopupWindow.focus() })
  _oauthPopupWindow.on('closed', () => { _oauthPopupWindow = null })
})

ipcMain.on('extension:openPopup', () => {
  if (!_eveVaultExtId) return
  if (_vaultPopupWindow && !_vaultPopupWindow.isDestroyed()) { _vaultPopupWindow.focus(); return }
  _vaultPopupWindow = openExtensionWindow(`chrome-extension://${_eveVaultExtId}/popup.html`, { width: 516, height: 620 })
  _vaultPopupWindow.on('closed', () => { _vaultPopupWindow = null })
})

app.on('browser-window-created', (_event, win) => {
  function showIfVault(url) {
    if (_eveVaultExtId && url &&
        url.startsWith(`chrome-extension://${_eveVaultExtId}/`) &&
        !url.includes('/keeper.html')) {
      win.show(); win.focus()
    }
  }
  win.webContents.once('did-navigate', (_e, url) => showIfVault(url))
  win.webContents.once('did-finish-load', () => showIfVault(win.webContents.getURL()))
})

ipcMain.on('overlay:webview-status', (_event, { url, extId }) => {
  console.log('[EFC] overlay webview status:', url || '<no-url>', 'extId:', extId)
})
