const { app, BrowserWindow, ipcMain, net, screen, session, shell, webContents, WebContentsView } = require('electron')
const fs   = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { createEveVaultApprovalRecoveryScript } = require('./eve-vault-approval-recovery')

const EXTENSION_PATH = path.join(__dirname, '../../extension', 'eve-vault-0.14')
  .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
let _eveVaultExtId = null
const AUTO_OPEN_OVERLAY_DEVTOOLS = process.env.SILVERVISION_AUTO_OPEN_OVERLAY_DEVTOOLS === '1'

const TITLEBAR_HEIGHT  = 32
const SETTINGS_PANEL_W = 220
const SETTINGS_PANEL_H = 116
// Extra margin around the panel's visual bounds so its CSS drop shadow has
// room to render without being clipped by the WebContentsView's own edge —
// WebContentsView content is hard-clipped to its bounds rectangle, so the
// shadow allowance has to be baked into the bounds, not just the CSS.
const SETTINGS_PANEL_SHADOW_MARGIN = 16
const SETTINGS_PANEL_GAP = 6 // small floating gap below the titlebar
const SETTINGS_PANEL_RIGHT_INSET = 10 // real gap from the window's right edge

// Chrome/Chromium-derived starting values — tunable, not exact specs.
const BROWSER_TAB_STRIP_HEIGHT = 36
const BROWSER_TOOLBAR_HEIGHT   = 40
const BROWSER_CHROME_HEIGHT    = TITLEBAR_HEIGHT + BROWSER_TAB_STRIP_HEIGHT + BROWSER_TOOLBAR_HEIGHT
const BROWSER_KEY        = '__browser'
const BROWSER_HOME_URL   = 'https://app.silver-tribe.com'
const BROWSER_SEARCH_URL = 'https://www.google.com/search?q='
// Sentinel "URL" for a fresh, unnavigated tab — stored/persisted like any
// other tab.url, but resolves to the local browserNewTab renderer instead of
// a real network request, and the toolbar shows an empty omnibox for it
// rather than this internal string.
const BROWSER_NEW_TAB_URL = 'silvervision://new-tab'

// Bounds for the settings panel's WebContentsView when visible, anchored to
// the top-right of the window below the titlebar/toolbar (chromeHeight),
// inflated by SETTINGS_PANEL_SHADOW_MARGIN on every side so the panel's CSS
// drop shadow has room to render — the panel's own CSS insets its visible
// card by that same margin so the two line up.
function settingsPanelBounds(windowWidth, chromeHeight) {
  const m = SETTINGS_PANEL_SHADOW_MARGIN
  return {
    x: Math.max(0, windowWidth - SETTINGS_PANEL_W - SETTINGS_PANEL_RIGHT_INSET - m),
    y: chromeHeight + SETTINGS_PANEL_GAP - m,
    width: SETTINGS_PANEL_W + m * 2,
    height: SETTINGS_PANEL_H + m * 2
  }
}

const overlayContentViews  = new Map()
const settingsOverlayViews = new Map()
const browserToolbarViews  = new Map() // win.id -> WebContentsView
const browserTabState      = new Map() // win.id -> { tabs: [{id,view,url,title,favicon,isLoading}], activeTabId }

// Registry of every WebContentsView that can host a dApp for EveVault relay
// purposes — one entry per regular overlay's _contentView AND per browser
// tab's view. Keyed by webContents.id (unique per view), NOT win.id, since a
// browser window hosts multiple tab views under one win.id. This is separate
// from overlayContentViews (which stays win.id-keyed and is used only for
// window-level bounds/collapse bookkeeping).
const eveVaultViews = new Map() // webContentsId -> { view, windowId }

let menuWindow     = null
let settingsWindow = null
let appStoreWindow = null
let browserWindow  = null
let _vaultPopupWindow  = null
let _keeperWindow      = null
let _oauthPopupWindow  = null

// ---------------------------------------------------------------------------
// Renderer loading helpers (dev vs. production)
// ---------------------------------------------------------------------------
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD_PATH = path.join(__dirname, '../preload/index.js')
const OVERLAY_PRELOAD_PATH = path.join(__dirname, '../preload/overlay.js')

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

// Turn omnibox input into a navigable URL: pass through real URLs, add
// https:// to bare-looking hosts, otherwise treat it as a Google search.
function resolveBrowserInput(input) {
  const trimmed = (input || '').trim()
  if (!trimmed) return BROWSER_HOME_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`
  return BROWSER_SEARCH_URL + encodeURIComponent(trimmed)
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
    const keeperMessageBridge = _keeperWindow.webContents.executeJavaScript(`
      (function() {
        if (typeof chrome === 'undefined' || !chrome.runtime) return;
        chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
          if (!msg || typeof window.__efcKeeperIpc === 'undefined') return false;
          if (msg.type === 'OPEN_VAULT_WINDOW' && msg.url) {
            window.__efcKeeperIpc.openWindow(msg.url);
          } else if (msg.type === 'OPEN_OAUTH_POPUP' && msg.url) {
            window.__efcKeeperIpc.openOAuthPopup(msg.url);
          } else if (msg.type === 'RELAY_TAB_MESSAGE' && msg.message) {
            window.__efcKeeperIpc.relayTabMessage({
              tabId: msg.tabId,
              message: msg.message
            }).then(sendResponse, function(error) {
              sendResponse({
                ok: false,
                confirmed: false,
                error: error && error.message ? error.message : String(error)
              });
            });
            return true;
          }
          return false;
        });
      })();
    `)
    keeperMessageBridge
      .then(() => _keeperWindow.webContents.executeJavaScript(createEveVaultApprovalRecoveryScript()))
      .catch(e => console.error('[SilverVision] Failed to inject keeper integration:', e))
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
  eveVaultEnabled:     false,
  theme:               'dark'
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
// App Store's user-authored catalog entries ("Custom" tab) — was App Store
// localStorage only (per-window, lost on clearAll, unreachable from other
// windows); moved to userData so the browser toolbar's "add as app" can also
// register an entry here, not just in custom-items.json.
// ---------------------------------------------------------------------------
let _catalogCustomAppsPath  = null
let _catalogCustomAppsCache = null

function getCatalogCustomAppsPath() {
  if (!_catalogCustomAppsPath) _catalogCustomAppsPath = path.join(app.getPath('userData'), 'catalog-custom-apps.json')
  return _catalogCustomAppsPath
}

function getCatalogCustomApps() {
  if (_catalogCustomAppsCache !== null) return _catalogCustomAppsCache
  try { _catalogCustomAppsCache = JSON.parse(fs.readFileSync(getCatalogCustomAppsPath(), 'utf8')) }
  catch (_) { _catalogCustomAppsCache = [] }
  return _catalogCustomAppsCache
}

function saveCatalogCustomApps(apps) {
  _catalogCustomAppsCache = apps
  try { fs.writeFileSync(getCatalogCustomAppsPath(), JSON.stringify(apps, null, 2)) } catch (_) {}
}

function notifyCatalogCustomApps() {
  if (appStoreWindow && !appStoreWindow.isDestroyed()) {
    try { appStoreWindow.webContents.send('appstore:customAppsChanged', getCatalogCustomApps()) } catch (_) {}
  }
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
const pendingEveVaultRequests = new Map()

const EVE_VAULT_REQUEST_TTL_MS = 2 * 60 * 1000
const EVE_VAULT_TOKEN_FIELDS = new Set([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'refresh_token_id'
])
const EVE_VAULT_SIGNING_ERROR_TYPES = new Set([
  'sign_error',
  'sign_transaction_error',
  'sign_personal_message_error',
  'sign_and_execute_transaction_error',
  'sign_sponsored_transaction_error'
])

function isPlainRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)
}

function hasNoEveVaultTokenMaterial(value) {
  if (Array.isArray(value)) return value.every(hasNoEveVaultTokenMaterial)
  if (!isPlainRecord(value)) return true
  return Object.entries(value).every(([key, child]) =>
    !EVE_VAULT_TOKEN_FIELDS.has(key) && hasNoEveVaultTokenMaterial(child)
  )
}

function isValidEveVaultRequestId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isAllowedEveVaultPageResponse(message) {
  if (!isPlainRecord(message) || !hasNoEveVaultTokenMaterial(message)) return false

  if (message.event === 'change') return isPlainRecord(message.payload)
  if (!isValidEveVaultRequestId(message.id) || typeof message.type !== 'string') return false

  if (message.type === 'auth_success') {
    return (
      (message.chain === undefined || typeof message.chain === 'string') &&
      (message.address === undefined || typeof message.address === 'string') &&
      (message.publicKey === undefined || typeof message.publicKey === 'string')
    )
  }
  if (message.type === 'auth_error') return message.error !== undefined
  if (message.type === 'sign_success') {
    return (
      (typeof message.bytes === 'string' || typeof message.digest === 'string') &&
      (typeof message.signature === 'string' || typeof message.effects === 'string')
    )
  }
  if (message.type === 'sign_and_execute_transaction_success') return isPlainRecord(message.result)
  if (EVE_VAULT_SIGNING_ERROR_TYPES.has(message.type)) return message.error !== undefined
  if (message.type === 'disconnect_success') return true
  return message.type === 'disconnect_error' && message.error !== undefined
}

function getOverlayEntryByWebContents(sender) {
  return getOverlayEntryByWebContentsId(sender?.id)
}

function getOverlayEntryByWebContentsId(webContentsId) {
  if (!Number.isInteger(webContentsId)) return null
  const entry = eveVaultViews.get(webContentsId)
  if (!entry) return null
  return { windowId: entry.windowId, entry }
}

function getPageOrigin(url) {
  try {
    const parsed = new URL(url)
    return parsed.origin && parsed.origin !== 'null' ? parsed.origin : null
  } catch (_) {
    return null
  }
}

function clearTrackedEveVaultRequestsForWebContents(webContentsId) {
  for (const [requestId, pending] of pendingEveVaultRequests) {
    if (pending.webContentsId === webContentsId) pendingEveVaultRequests.delete(requestId)
  }
}

function getTrackedEveVaultTarget(requestId) {
  const pending = pendingEveVaultRequests.get(requestId)
  if (!pending) return null
  if (pending.expiresAt <= Date.now()) {
    pendingEveVaultRequests.delete(requestId)
    return null
  }

  const target = getOverlayEntryByWebContentsId(pending.webContentsId)
  if (!target || getPageOrigin(target.entry.view.webContents.getURL()) !== pending.origin) {
    pendingEveVaultRequests.delete(requestId)
    return null
  }
  return target
}

function createConfirmedEveVaultResponseScript(message) {
  const pageMessage = { ...message, __from: 'Eve Vault' }
  const serializedMessage = JSON.stringify(pageMessage)
  const expectedId = JSON.stringify(message.id ?? null)
  const expectedType = JSON.stringify(message.type ?? null)
  const expectedEvent = JSON.stringify(message.event ?? null)

  return `
    (() => new Promise((resolve) => {
      const message = ${serializedMessage};
      const expectedId = ${expectedId};
      const expectedType = ${expectedType};
      const expectedEvent = ${expectedEvent};
      const targetOrigin = window.location.origin;
      if (!targetOrigin || targetOrigin === 'null') {
        resolve({ confirmed: false, error: 'opaque-page-origin' });
        return;
      }

      let settled = false;
      let timer = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        window.removeEventListener('message', onConfirmation);
        resolve(result);
      };
      const onConfirmation = (event) => {
        if (event.source !== window || event.origin !== targetOrigin) return;
        const data = event.data;
        if (!data || data.__from !== 'Eve Vault') return;
        if (expectedId !== null && data.id !== expectedId) return;
        if (expectedType !== null && data.type !== expectedType) return;
        if (expectedEvent !== null && data.event !== expectedEvent) return;
        finish({ confirmed: true, origin: targetOrigin });
      };

      window.addEventListener('message', onConfirmation);
      timer = setTimeout(() => finish({
        confirmed: false,
        origin: targetOrigin,
        error: 'page-confirmation-timeout'
      }), 1500);
      try {
        window.postMessage(message, targetOrigin);
      } catch (error) {
        finish({
          confirmed: false,
          origin: targetOrigin,
          error: error && error.message ? error.message : String(error)
        });
      }
    }))()
  `
}

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
  // On mac/Linux, the default always-on-top level sits below a game running in
  // borderless fullscreen (which claims the top of the stacking order for
  // itself), so overlay windows never actually appear over it. Bumping to the
  // 'screen-saver' level — the highest Electron exposes — fixes this on both
  // platforms; on Wayland, compositor security policy still blocks apps from
  // raising themselves over others, so this remains a known limitation there.
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch (_) {}
  }
  if (process.platform === 'darwin') {
    try {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransientWindowStateRestoration: true
      })
    } catch (_) {}
  } else if (process.platform === 'linux') {
    try { win.setVisibleOnAllWorkspaces(true) } catch (_) {}
  }
  win.on('focus', () => {
    if (!win.isDestroyed()) {
      try { win.moveTop() } catch (_) {}
    }
  })
  win.on('blur', () => {
    if (!win.isDestroyed() && !win.isMinimized()) {
      // Skip reasserting if a child popup we spawned (e.g. an OAuth/login
      // window opened from a vault action popup) is why we lost focus —
      // otherwise this would win the always-on-top race back and bury the
      // child window right after it opens.
      const child = win._activeChildPopup
      if (child && !child.isDestroyed()) return
      try { win.setAlwaysOnTop(true, process.platform === 'win32' ? undefined : 'screen-saver') } catch (_) {}
    }
  })
}

// Plays a brief "pop in" on a freshly created window — fades opacity in and
// grows from a slightly smaller/offset rect to its real bounds, using the
// same setInterval+smoothstep technique the fade controllers already use for
// opacity (BrowserWindow bounds/opacity aren't natively CSS-animatable, so
// this is a manual per-frame tween, not a real "animation API"). Call once,
// right after a window is created — NOT on every focus/show, so windows that
// just get re-focused instead of recreated (overlay/browser dedup-by-key)
// naturally don't replay it.
function playWindowOpenAnimation(win, targetOpacity = 1, durationMs = 170, onDone) {
  let finalBounds
  try { finalBounds = win.getBounds() } catch (_) { if (onDone) onDone(); return }
  const shrink = 10 // px inset on each side at the start of the animation
  const startBounds = {
    x: finalBounds.x + shrink,
    y: finalBounds.y + shrink,
    width: Math.max(1, finalBounds.width - shrink * 2),
    height: Math.max(1, finalBounds.height - shrink * 2)
  }
  const smoothstep = (t) => t * t * (3 - 2 * t)
  try { win.setOpacity(0) } catch (_) { if (onDone) onDone(); return }
  try { win.setBounds(startBounds) } catch (_) {}

  const t0 = Date.now()
  const timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(timer); return }
    const t = Math.min(1, (Date.now() - t0) / durationMs)
    const e = smoothstep(t)
    try {
      win.setOpacity(targetOpacity * e)
      win.setBounds({
        x: Math.round(startBounds.x + (finalBounds.x - startBounds.x) * e),
        y: Math.round(startBounds.y + (finalBounds.y - startBounds.y) * e),
        width: Math.round(startBounds.width + (finalBounds.width - startBounds.width) * e),
        height: Math.round(startBounds.height + (finalBounds.height - startBounds.height) * e)
      })
    } catch (_) {}
    if (t >= 1) {
      clearInterval(timer)
      try { win.setBounds(finalBounds) } catch (_) {}
      if (onDone) onDone()
    }
  }, 16)
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
    } else {
      // The menu is the only way to open new windows, so if nothing else is
      // left open there's no point staying alive — but the hidden keeper
      // window (EVE Vault bridge) would otherwise block window-all-closed
      // from firing, so check for visible windows explicitly.
      quitIfNoVisibleWindows()
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
  playWindowOpenAnimation(settingsWindow)
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
  playWindowOpenAnimation(appStoreWindow)
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
          preload: OVERLAY_PRELOAD_PATH,
          devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
        }
      })
      try { _contentView.setBackgroundColor('#191b1e') } catch (_) {}
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
      _contentView.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 /* ERR_ABORTED — usually a redirect, not a real failure */) return
        console.error('[SilverVision] Overlay content failed to load:', { url: validatedURL, errorCode, errorDescription })
      })
      _contentView.webContents.on('render-process-gone', (_e, details) => {
        console.error('[SilverVision] Overlay content renderer process gone:', details)
      })
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
      _contentView.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false) clearTrackedEveVaultRequestsForWebContents(_contentView.webContents.id)
      })
      overlayContentViews.set(win.id, { view: _contentView, updateBounds: updateViewBounds })
      eveVaultViews.set(_contentView.webContents.id, { view: _contentView, windowId: win.id })
    } catch (err) {
      console.error('[SilverVision] Failed to create WebContentsView for overlay:', err)
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
    // Fully transparent — the margin area around the floating card (added so
    // its drop shadow has room to render, see SETTINGS_PANEL_SHADOW_MARGIN)
    // must show whatever's behind it, not an opaque fill.
    try { settingsView.setBackgroundColor('#00000000') } catch (_) {}
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
    console.error('[SilverVision] Failed to create settings overlay view:', err)
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
  // makeOverlayController's constructor already snapped opacity straight to
  // OPACITY_ACTIVE — play the open animation on top of that starting point
  // rather than reordering construction (ctrl needs to exist immediately;
  // other IPC handlers key off windowAnimators.get(win.id) from frame one).
  playWindowOpenAnimation(win, initialOpacityMax)

  let lastBounds = win.getBounds()
  win.on('resize', () => {
    try { lastBounds = win.getBounds() } catch (_) {}
    overlayContentViews.get(win.id)?.updateBounds()
    const sEntry = settingsOverlayViews.get(win.id)
    if (sEntry && sEntry.visible) {
      try {
        const b = win.getBounds()
        sEntry.view.setBounds(settingsPanelBounds(b.width, TITLEBAR_HEIGHT))
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
        clearTrackedEveVaultRequestsForWebContents(cvEntry.view.webContents.id)
        eveVaultViews.delete(cvEntry.view.webContents.id)
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
// Browser window — a built-in, singleton overlay window with tabs. Uses the
// same shared chrome helpers as createOverlayWindow (makeOverlayController,
// setupAlwaysOnTopBehavior, bounds persistence) so transparency/fade/collapse
// behavior stays identical to regular launched apps, but manages its own
// array of content WebContentsViews (one per tab) plus a toolbar
// WebContentsView instead of createOverlayWindow's single _contentView.
// ---------------------------------------------------------------------------
let _browserTabIdCounter = 0

function getActiveBrowserTab(win) {
  const state = browserTabState.get(win.id)
  if (!state) return null
  return state.tabs.find(t => t.id === state.activeTabId) || null
}

function updateBrowserBounds(win) {
  if (win.isDestroyed()) return
  const b = win.getBounds()
  const toolbarView = browserToolbarViews.get(win.id)
  if (toolbarView) {
    try {
      toolbarView.setBounds({
        x: 0, y: TITLEBAR_HEIGHT,
        width: b.width,
        height: Math.max(0, BROWSER_TAB_STRIP_HEIGHT + BROWSER_TOOLBAR_HEIGHT)
      })
    } catch (_) {}
  }
  const active = getActiveBrowserTab(win)
  if (active) {
    try {
      active.view.setBounds({
        x: 1, y: BROWSER_CHROME_HEIGHT,
        width: Math.max(0, b.width - 2),
        height: Math.max(0, b.height - BROWSER_CHROME_HEIGHT - 1)
      })
    } catch (_) {}
  }
  const sEntry = settingsOverlayViews.get(win.id)
  if (sEntry && sEntry.visible) {
    try {
      // Floats directly under the titlebar (like the regular overlay
      // window), not below the whole tab-strip/toolbar stack — it's a
      // window-level settings menu, not part of the browser chrome.
      sEntry.view.setBounds(settingsPanelBounds(b.width, TITLEBAR_HEIGHT))
    } catch (_) {}
  }
}

function hideBrowserChromeForCollapse(win) {
  const toolbarView = browserToolbarViews.get(win.id)
  if (toolbarView) { try { toolbarView.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width: 0, height: 0 }) } catch (_) {} }
  const active = getActiveBrowserTab(win)
  if (active) { try { active.view.setBounds({ x: 0, y: BROWSER_CHROME_HEIGHT, width: win.getBounds().width, height: 0 }) } catch (_) {} }
}

function sendBrowserTabsChanged(win) {
  const toolbarView = browserToolbarViews.get(win.id)
  const state = browserTabState.get(win.id)
  if (!toolbarView || !state || toolbarView.webContents.isDestroyed()) return
  const payload = {
    activeTabId: state.activeTabId,
    tabs: state.tabs.map(t => ({
      id: t.id, url: t.url, title: t.title, favicon: t.favicon,
      isLoading: t.isLoading,
      canGoBack: t.view.webContents.navigationHistory ? t.view.webContents.navigationHistory.canGoBack() : t.view.webContents.canGoBack(),
      canGoForward: t.view.webContents.navigationHistory ? t.view.webContents.navigationHistory.canGoForward() : t.view.webContents.canGoForward()
    }))
  }
  try { toolbarView.webContents.send('browser:tabsChanged', payload) } catch (_) {}
}

function persistBrowserSession(win) {
  const state = browserTabState.get(win.id)
  if (!state) return
  const activeIndex = Math.max(0, state.tabs.findIndex(t => t.id === state.activeTabId))
  const entry = getBoundsStore()[BROWSER_KEY] || {}
  saveBounds(BROWSER_KEY, {
    ...entry,
    tabs: state.tabs.map(t => ({ url: t.url, title: t.title })),
    activeIndex
  })
}

function createBrowserTab(win, url) {
  const state = browserTabState.get(win.id)
  if (!state) return null

  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition('persist:overlay'),
      contextIsolation: true,
      nodeIntegration: false,
      preload: OVERLAY_PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  })
  try { view.setBackgroundColor('#191b1e') } catch (_) {}
  // Always insert at the bottom of the z-stack (index 0) so a tab opened
  // after window creation can never end up layered above the toolbar or
  // settings panel, which are added once at window-creation time.
  win.contentView.addChildView(view, 0)
  view.setBounds({ x: 0, y: BROWSER_CHROME_HEIGHT, width: 0, height: 0 })

  const tab = { id: `bt-${++_browserTabIdCounter}`, view, url: url || BROWSER_NEW_TAB_URL, title: '', favicon: '', isLoading: true }
  state.tabs.push(tab)

  const wc = view.webContents
  eveVaultViews.set(wc.id, { view, windowId: win.id })
  wc.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame !== false) clearTrackedEveVaultRequestsForWebContents(wc.id)
  })
  if (tab.url === BROWSER_NEW_TAB_URL) loadViewRenderer(view, 'browserNewTab')
  else wc.loadURL(tab.url)
  wc.setWindowOpenHandler(({ url: newUrl }) => {
    if (newUrl && newUrl.startsWith('chrome-extension://')) {
      try { openExtensionWindow(newUrl) } catch (_) {}
      return { action: 'deny' }
    }
    createBrowserTab(win, newUrl)
    activateBrowserTab(win, state.tabs[state.tabs.length - 1].id)
    return { action: 'deny' }
  })
  wc.on('did-start-loading', () => { tab.isLoading = true; sendBrowserTabsChanged(win) })
  wc.on('did-stop-loading', () => { tab.isLoading = false; sendBrowserTabsChanged(win) })
  // The internal browserNewTab renderer's own file:// / dev-server URL must
  // never leak into tab.url/the omnibox/persisted session — it's an
  // implementation detail of the blank state (BROWSER_NEW_TAB_URL). Checked
  // against the URL actually being navigated TO, not tab.url's current
  // value — tab.url is still BROWSER_NEW_TAB_URL at the moment the user's
  // first real navigation away from a blank tab fires this same event, so
  // comparing against tab.url would (and did) swallow that first navigation
  // and leave the omnibox showing nothing.
  const isInternalNewTabUrl = (navUrl) => navUrl.includes('/browserNewTab/')
  wc.on('did-navigate', (_e, navUrl) => {
    if (isInternalNewTabUrl(navUrl)) return
    tab.url = navUrl; sendBrowserTabsChanged(win); persistBrowserSession(win)
  })
  wc.on('did-navigate-in-page', (_e, navUrl) => {
    if (isInternalNewTabUrl(navUrl)) return
    tab.url = navUrl; sendBrowserTabsChanged(win); persistBrowserSession(win)
  })
  wc.on('page-title-updated', (_e, title) => { tab.title = title; sendBrowserTabsChanged(win); persistBrowserSession(win) })
  wc.on('page-favicon-updated', (_e, favicons) => { tab.favicon = (favicons && favicons[0]) || ''; sendBrowserTabsChanged(win) })
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED — usually a redirect, not a real failure */) return
    console.error('[SilverVision] Browser tab failed to load:', { url: validatedURL, errorCode, errorDescription })
  })
  wc.on('render-process-gone', (_e, details) => {
    console.error('[SilverVision] Browser tab renderer process gone:', details)
  })
  wc.on('focus', () => {
    const sEntry = settingsOverlayViews.get(win.id)
    if (!sEntry || !sEntry.visible) return
    sEntry.visible = false
    try { sEntry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch (_) {}
    try { win.webContents.send('chrome:settingsMenuClosed') } catch (_) {}
  })

  return tab
}

function activateBrowserTab(win, tabId) {
  const state = browserTabState.get(win.id)
  if (!state) return
  const next = state.tabs.find(t => t.id === tabId)
  if (!next) return
  const prev = getActiveBrowserTab(win)
  if (prev && prev.id !== tabId) {
    try { prev.view.setBounds({ x: 0, y: BROWSER_CHROME_HEIGHT, width: 0, height: 0 }) } catch (_) {}
  }
  state.activeTabId = tabId
  updateBrowserBounds(win)
  sendBrowserTabsChanged(win)
}

function closeBrowserTab(win, tabId) {
  const state = browserTabState.get(win.id)
  if (!state) return
  if (state.tabs.length <= 1) return // last tab can't be closed
  const idx = state.tabs.findIndex(t => t.id === tabId)
  if (idx === -1) return
  const [closed] = state.tabs.splice(idx, 1)
  clearTrackedEveVaultRequestsForWebContents(closed.view.webContents.id)
  eveVaultViews.delete(closed.view.webContents.id)
  try { win.contentView.removeChildView(closed.view) } catch (_) {}
  try { closed.view.webContents.close() } catch (_) {}
  if (state.activeTabId === tabId) {
    const neighbor = state.tabs[idx] || state.tabs[idx - 1] || state.tabs[0]
    state.activeTabId = neighbor.id
    updateBrowserBounds(win)
  }
  sendBrowserTabsChanged(win)
  persistBrowserSession(win)
}

function createBrowserWindow() {
  if (browserWindow && !browserWindow.isDestroyed()) {
    if (browserWindow.isMinimized()) browserWindow.restore()
    browserWindow.focus()
    return browserWindow
  }

  const saved = loadBounds(BROWSER_KEY)
  const initW = saved ? saved.width  : 1000
  const initH = saved ? saved.height : 700

  const winOpts = {
    width: initW, height: initH,
    minWidth: 400, minHeight: 300,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  }
  if (saved && saved.x !== undefined) { winOpts.x = saved.x; winOpts.y = saved.y }

  const win = new BrowserWindow(winOpts)
  browserWindow = win
  overlayKeys.set(win.id, BROWSER_KEY) // needed by window:togglePin et al, which key off this map

  const initialPinned     = saved ? !!saved.pinned                                             : false
  const initialOpacityMin = saved ? (saved.opacityMin ?? getConfigValue('defaultOpacityMin'))  : getConfigValue('defaultOpacityMin')
  const initialOpacityMax = saved ? (saved.opacityMax ?? getConfigValue('defaultOpacityMax'))  : getConfigValue('defaultOpacityMax')

  // Toolbar (tab strip + omnibox), layered above content — same technique as
  // the settings panel in createOverlayWindow.
  const toolbarView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      devTools: AUTO_OPEN_OVERLAY_DEVTOOLS
    }
  })
  win.contentView.addChildView(toolbarView)
  browserToolbarViews.set(win.id, toolbarView)
  loadViewRenderer(toolbarView, 'browserToolbar')

  browserTabState.set(win.id, { tabs: [], activeTabId: null })

  const restoredTabs = Array.isArray(saved?.tabs) && saved.tabs.length ? saved.tabs : [{ url: BROWSER_HOME_URL }]
  let firstTab = null
  for (const t of restoredTabs) {
    const tab = createBrowserTab(win, t.url)
    if (!firstTab) firstTab = tab
  }
  const restoreIndex = Number.isInteger(saved?.activeIndex) ? saved.activeIndex : 0
  const state = browserTabState.get(win.id)

  // Opacity settings panel (WebContentsView) — added LAST so it stacks above
  // the toolbar and every tab's content view (WebContentsView z-order is
  // purely addChildView call sequence — later calls render on top). Same
  // construction as createOverlayWindow's settingsView, so window:
  // setOpacityRange/settingsMenuVisible work identically for the browser.
  try {
    const settingsView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: PRELOAD_PATH,
        devTools: false
      }
    })
    // Fully transparent — the margin area around the floating card (added so
    // its drop shadow has room to render, see SETTINGS_PANEL_SHADOW_MARGIN)
    // must show whatever's behind it, not an opaque fill.
    try { settingsView.setBackgroundColor('#00000000') } catch (_) {}
    win.contentView.addChildView(settingsView)
    settingsView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    loadViewRenderer(settingsView, 'settingsPanel', {
      opacityMin: String(initialOpacityMin),
      opacityMax: String(initialOpacityMax)
    })
    settingsOverlayViews.set(win.id, { view: settingsView, visible: false })
  } catch (err) {
    console.error('[SilverVision] Failed to create settings overlay view for browser window:', err)
  }
  const initialActive = state.tabs[restoreIndex] || state.tabs[0]
  state.activeTabId = initialActive.id

  toolbarView.webContents.once('did-finish-load', () => sendBrowserTabsChanged(win))

  loadRenderer(win, 'window', {
    title: 'Browser',
    url: '',
    pinned: initialPinned ? '1' : '0',
    opacityMin: String(initialOpacityMin),
    opacityMax: String(initialOpacityMax)
  })

  if (AUTO_OPEN_OVERLAY_DEVTOOLS) {
    try { win.webContents.openDevTools({ mode: 'detach' }) } catch (_) {}
  }

  const ctrl = makeOverlayController(win, initialPinned, initialOpacityMin, initialOpacityMax)
  windowAnimators.set(win.id, ctrl)
  setupAlwaysOnTopBehavior(win)
  playWindowOpenAnimation(win, initialOpacityMax)

  updateBrowserBounds(win)

  let lastBounds = win.getBounds()
  win.on('resize', () => {
    try { lastBounds = win.getBounds() } catch (_) {}
    updateBrowserBounds(win)
  })
  win.on('move', () => { try { lastBounds = win.getBounds() } catch (_) {} })

  win.on('closed', () => {
    try {
      const entry = getBoundsStore()[BROWSER_KEY] || {}
      saveBounds(BROWSER_KEY, { ...entry, ...lastBounds })
    } catch (_) {}
    persistBrowserSession(win)
    ctrl.cleanup()
    const state = browserTabState.get(win.id)
    if (state) {
      for (const tab of state.tabs) {
        clearTrackedEveVaultRequestsForWebContents(tab.view.webContents.id)
        eveVaultViews.delete(tab.view.webContents.id)
        try { win.contentView.removeChildView(tab.view) } catch (_) {}
        try { tab.view.webContents.close() } catch (_) {}
      }
    }
    browserTabState.delete(win.id)
    try {
      const toolbarView = browserToolbarViews.get(win.id)
      if (toolbarView) {
        try { win.contentView.removeChildView(toolbarView) } catch (_) {}
        try { toolbarView.webContents.close() } catch (_) {}
      }
    } catch (_) {}
    browserToolbarViews.delete(win.id)
    try {
      const sEntry = settingsOverlayViews.get(win.id)
      if (sEntry?.view) {
        try { sEntry.view.webContents.close() } catch (_) {}
        try { win.contentView.removeChildView(sEntry.view) } catch (_) {}
      }
    } catch (_) {}
    settingsOverlayViews.delete(win.id)
    windowAnimators.delete(win.id)
    overlayKeys.delete(win.id)
    if (browserWindow === win) browserWindow = null
    if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('browser:closed')
  })

  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('browser:opened')

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
    console.log('[SilverVision] OAuth redirect captured:', url)
    const relay = (_keeperWindow && !_keeperWindow.isDestroyed()) ? _keeperWindow
                : (_vaultPopupWindow && !_vaultPopupWindow.isDestroyed()) ? _vaultPopupWindow
                : null
    if (relay) {
      relay.webContents.executeJavaScript(
        `chrome.runtime.sendMessage({type:'OAUTH_REDIRECT',url:${JSON.stringify(url)}})`
      ).then(() => console.log('[SilverVision] OAUTH_REDIRECT relayed OK'))
       .catch(e => console.error('[SilverVision] OAUTH_REDIRECT relay failed:', e))
    } else {
      console.warn('[SilverVision] No relay window available for OAUTH_REDIRECT')
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
      console.log('[SilverVision] EVE Vault auto-loaded:', _eveVaultExtId)
      createKeeperWindow(_eveVaultExtId)
    } catch (err) {
      console.error('[SilverVision] Failed to auto-load EVE Vault extension:', err)
    }
  }

  createMenu()
})

// window-all-closed doesn't fire while the hidden 1x1 keeper window (EVE
// Vault extension bridge) is alive, since Electron counts it like any other
// BrowserWindow even though it's never shown to the user. Quit as soon as no
// *visible* window remains instead, so closing the last visible window (e.g.
// the menu) actually ends the app rather than leaving it running invisibly.
function quitIfNoVisibleWindows() {
  const hasVisibleWindow = BrowserWindow.getAllWindows()
    .some((win) => !win.isDestroyed() && win !== _keeperWindow)
  if (!hasVisibleWindow) app.quit()
}
app.on('window-all-closed', quitIfNoVisibleWindows)

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

// On Windows, alwaysOnTop windows still stack normally with the taskbar, so
// minimizing just the clicked window is enough to reveal the desktop under
// it. On mac/Linux, alwaysOnTop windows float above everything including
// minimized windows/Show Desktop, so leaving the other overlays alwaysOnTop
// would leave them still covering the screen — drop alwaysOnTop on the
// window being minimized (and restore it on un-minimize) instead of pulling
// every other overlay down with it.
ipcMain.on('window:minimize', (event) => {
  if (process.platform === 'win32') {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.isMinimized()) win.minimize()
    }
    return
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed() || win.isMinimized()) return
  try { win.setAlwaysOnTop(false) } catch (_) {}
  win.minimize()
  win.once('restore', () => {
    if (!win.isDestroyed()) {
      try { win.setAlwaysOnTop(true, 'screen-saver') } catch (_) {}
    }
  })
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
      if (browserTabState.has(win.id)) hideBrowserChromeForCollapse(win)
    } else {
      const h = restoreHeight || collapseRestoreHeights.get(win.id) || 400
      collapseRestoreHeights.delete(win.id)
      win.setMinimumSize(300, 200)
      win.setBounds({ ...b, height: h })
      const cvEntry = overlayContentViews.get(win.id)
      if (cvEntry) setTimeout(() => { try { cvEntry.updateBounds() } catch (_) {} }, 50)
      if (browserTabState.has(win.id)) setTimeout(() => { try { updateBrowserBounds(win) } catch (_) {} }, 50)
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
      // Always floats directly under the titlebar, even in the browser
      // window, where the tab-strip/toolbar sit below it — it's a
      // window-level menu, not part of that chrome.
      sEntry.view.setBounds(settingsPanelBounds(b.width, TITLEBAR_HEIGHT))
      // The panel's WebContentsView is created once and just resized to/from
      // zero bounds on toggle — its page never reloads, so it needs an
      // explicit nudge each time to replay its show transition.
      try { sEntry.view.webContents.send('settingsPanel:shown') } catch (_) {}
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
ipcMain.on('menu:openBrowser',  () => createBrowserWindow())

// ---------------------------------------------------------------------------
// Browser toolbar commands — sent from the browserToolbar WebContentsView
// ---------------------------------------------------------------------------
ipcMain.on('browser:newTab', (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || !browserTabState.has(win.id)) return
  // "+" opens blank (BROWSER_NEW_TAB_URL, via createBrowserTab's own default)
  // rather than auto-navigating to BROWSER_HOME_URL — only the very first
  // tab of a fresh session (no saved state at all) defaults to the home URL.
  const tab = createBrowserTab(win, url ? resolveBrowserInput(url) : undefined)
  if (tab) activateBrowserTab(win, tab.id)
  persistBrowserSession(win)
})

ipcMain.on('browser:closeTab', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  closeBrowserTab(win, tabId)
})

ipcMain.on('browser:activateTab', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  activateBrowserTab(win, tabId)
  persistBrowserSession(win)
})

ipcMain.on('browser:navigate', (event, { tabId, input }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const state = win && browserTabState.get(win.id)
  const tab = state && state.tabs.find(t => t.id === tabId)
  if (!tab) return
  try { tab.view.webContents.loadURL(resolveBrowserInput(input)) } catch (_) {}
})

ipcMain.on('browser:goBack', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const state = win && browserTabState.get(win.id)
  const tab = state && state.tabs.find(t => t.id === tabId)
  if (!tab) return
  const nav = tab.view.webContents.navigationHistory
  try { nav ? nav.goBack() : tab.view.webContents.goBack() } catch (_) {}
})

ipcMain.on('browser:goForward', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const state = win && browserTabState.get(win.id)
  const tab = state && state.tabs.find(t => t.id === tabId)
  if (!tab) return
  const nav = tab.view.webContents.navigationHistory
  try { nav ? nav.goForward() : tab.view.webContents.goForward() } catch (_) {}
})

ipcMain.on('browser:reload', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const state = win && browserTabState.get(win.id)
  const tab = state && state.tabs.find(t => t.id === tabId)
  if (!tab) return
  try { tab.view.webContents.reload() } catch (_) {}
})

ipcMain.on('browser:stop', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const state = win && browserTabState.get(win.id)
  const tab = state && state.tabs.find(t => t.id === tabId)
  if (!tab) return
  try { tab.view.webContents.stop() } catch (_) {}
})

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
// IPC — App Store's user-authored catalog entries ("Custom" tab)
// ---------------------------------------------------------------------------
ipcMain.handle('appstore:getCustomApps', async () => getCatalogCustomApps())

ipcMain.handle('appstore:upsertCustomApp', async (_, app) => {
  if (!app || typeof app.name !== 'string' || typeof app.url !== 'string') return { ok: false, error: 'Invalid app' }
  if (app.url.includes('://')) {
    try {
      const p = new URL(app.url)
      if (!['http:', 'https:', 'file:'].includes(p.protocol)) return { ok: false, error: 'Invalid URL scheme' }
    } catch { return { ok: false, error: 'Invalid URL' } }
  }
  const sanitized = {
    id:          typeof app.id === 'string' && app.id ? app.id.slice(0, 100) : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
    name:        String(app.name).slice(0, 100),
    url:         String(app.url),
    icon:        String(app.icon || '').slice(0, 2048),
    description: String(app.description || '').slice(0, 500),
    width:       Math.max(200, Math.min(3840, Number(app.width)  || 800)),
    height:      Math.max(200, Math.min(2160, Number(app.height) || 600)),
    category:    String(app.category || '').slice(0, 50)
  }
  const apps = getCatalogCustomApps()
  const idx = apps.findIndex(a => a.id === sanitized.id)
  if (idx !== -1) apps[idx] = sanitized
  else apps.push(sanitized)
  saveCatalogCustomApps(apps)
  notifyCatalogCustomApps()
  return { ok: true, app: sanitized }
})

ipcMain.handle('appstore:removeCustomApp', async (_, { id }) => {
  if (typeof id !== 'string') return { ok: false }
  const apps = getCatalogCustomApps().filter(a => a.id !== id)
  saveCatalogCustomApps(apps)
  notifyCatalogCustomApps()
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
ipcMain.handle('settings:getVersion', () => app.getVersion())

ipcMain.on('settings:openExternal', (_, url) => {
  if (typeof url !== 'string') return
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    shell.openExternal(url)
  } catch (_) {}
})

ipcMain.on('settings:set', (_, key, value) => {
  if (!(key in CONFIG_DEFAULTS)) return
  getConfig()[key] = value
  saveConfig()
  if (key === 'theme') {
    // Every renderer — top-level windows AND every layered WebContentsView
    // (browser tabs, toolbar, settings panel) — is a separate webContents,
    // so a config write alone doesn't reach any of them; push it live to
    // all of them at once rather than waiting for the next window open.
    for (const wc of webContents.getAllWebContents()) {
      try { wc.send('settings:themeChanged', value) } catch (_) {}
    }
  }
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
  saveCatalogCustomApps([])
  notifyCatalogCustomApps()
})

ipcMain.on('settings:clearAll', () => {
  _boundsCache = {}; saveBoundsStore()
  _configCache = {}; saveConfig()
  saveCustomItems([])
  notifyMenuItems()
  saveCatalogCustomApps([])
  notifyCatalogCustomApps()
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
      console.log('[SilverVision] EVE Vault toggled on:', _eveVaultExtId)
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
      console.error('[SilverVision] Failed to load EVE Vault extension:', err)
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
    // The opener (e.g. the PIN popup) also has setupAlwaysOnTopBehavior, so
    // losing focus to this child would otherwise trigger its blur handler to
    // re-assert alwaysOnTop and win the race back above this freshly opened
    // child, burying it. Mark the opener as having an active child so its
    // blur handler skips reasserting while the child is open.
    win._activeChildPopup = childWin
    childWin.on('closed', () => {
      if (_oauthPopupWindow === childWin) _oauthPopupWindow = null
      if (win._activeChildPopup === childWin) {
        win._activeChildPopup = null
        if (!win.isDestroyed()) {
          try { win.setAlwaysOnTop(true, process.platform === 'win32' ? undefined : 'screen-saver') } catch (_) {}
        }
      }
    })
  })
  win.webContents.on('did-start-loading', () => {
    console.log('[SilverVision] vault window did-start-loading:', url)
  })
  win.webContents.on('dom-ready', () => {
    console.log('[SilverVision] vault window dom-ready:', win.webContents.getURL())
  })
  win.webContents.on('did-finish-load', () => {
    console.log('[SilverVision] vault window did-finish-load:', win.webContents.getURL())
    if (AUTO_OPEN_OVERLAY_DEVTOOLS) {
      try { win.webContents.openDevTools({ mode: 'detach' }) } catch (_) {}
    }
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('[SilverVision] vault window console:', { level, message, line, sourceId, url: win.webContents.getURL() })
  })
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[SilverVision] vault window failed to load:', { errorCode, errorDescription, validatedURL })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[SilverVision] vault window renderer crashed/gone:', details)
  })
  win.webContents.on('unresponsive', () => {
    console.error('[SilverVision] vault window became unresponsive:', win.webContents.getURL())
  })
  win.loadURL(url)
  win.once('ready-to-show', () => { win.show(); win.moveTop(); win.focus() })
  setupAlwaysOnTopBehavior(win)
  return win
}

// The overlay preload binds each public Wallet Standard request id to its
// initiating WebContentsView. Responses are validated, routed to that dApp
// only, and acknowledged after the page observes the postMessage event.
ipcMain.on('extension:trackDappRequest', (event, request) => {
  if (!isPlainRecord(request) || !isValidEveVaultRequestId(request.id)) return
  const source = getOverlayEntryByWebContents(event.sender)
  if (!source) return

  const origin = getPageOrigin(event.sender.getURL())
  if (!origin) return

  const existing = pendingEveVaultRequests.get(request.id)
  if (
    existing &&
    existing.expiresAt > Date.now() &&
    existing.webContentsId !== event.sender.id
  ) {
    console.warn('[SilverVision] Ignoring duplicate EveVault request id from another overlay:', request.id)
    return
  }

  pendingEveVaultRequests.set(request.id, {
    webContentsId: event.sender.id,
    origin,
    expiresAt: Date.now() + EVE_VAULT_REQUEST_TTL_MS
  })
})

ipcMain.handle('extension:relayTabMessage', async (event, request) => {
  if (!_keeperWindow || _keeperWindow.isDestroyed() || event.sender !== _keeperWindow.webContents) {
    return { ok: false, confirmed: false, error: 'untrusted-relay-sender' }
  }
  if (!isPlainRecord(request) || !isAllowedEveVaultPageResponse(request.message)) {
    return { ok: false, confirmed: false, error: 'invalid-page-response' }
  }

  const { message } = request
  const requestId = isValidEveVaultRequestId(message.id) ? message.id : null
  let targets = []

  if (message.event === 'change') {
    targets = Array.from(eveVaultViews, ([, entry]) => ({ windowId: entry.windowId, entry }))
  } else if (requestId) {
    const tracked = getTrackedEveVaultTarget(requestId)
    if (tracked) targets = [tracked]
  }

  if (targets.length === 0 && Number.isInteger(request.tabId)) {
    const byTabId = getOverlayEntryByWebContentsId(request.tabId)
    if (byTabId) targets = [byTabId]
  }

  // Covers a request emitted before the tracking preload initialized while
  // avoiding the cross-dApp response leak of the old broadcast behavior.
  if (targets.length === 0 && eveVaultViews.size === 1) {
    targets = Array.from(eveVaultViews, ([, entry]) => ({ windowId: entry.windowId, entry }))
  }

  if (targets.length === 0) {
    return { ok: false, confirmed: false, error: 'target-overlay-not-found' }
  }

  let script
  try {
    script = createConfirmedEveVaultResponseScript(message)
  } catch (error) {
    return {
      ok: false,
      confirmed: false,
      error: error?.message || String(error)
    }
  }

  const results = await Promise.all(targets.map(async ({ entry }) => {
    try {
      const result = await entry.view.webContents.executeJavaScript(script)
      return result?.confirmed === true
    } catch (_) {
      return false
    }
  }))
  const confirmedCount = results.filter(Boolean).length

  if (requestId && confirmedCount > 0) pendingEveVaultRequests.delete(requestId)
  console.log('[SilverVision] EveVault page response relay:', {
    id: requestId,
    type: message.type || message.event,
    targetCount: targets.length,
    confirmedCount
  })

  return {
    ok: confirmedCount > 0,
    confirmed: confirmedCount > 0,
    targetCount: targets.length,
    confirmedCount,
    ...(confirmedCount === 0 && { error: 'page-response-not-confirmed' })
  }
})

ipcMain.on('extension:requestOpenWindow', (event, url) => {
  console.log('[SilverVision] extension:requestOpenWindow received:', url, '| extId:', _eveVaultExtId)
  if (!url || typeof url !== 'string') return
  if (!_eveVaultExtId || !url.startsWith(`chrome-extension://${_eveVaultExtId}/`)) {
    console.warn('[SilverVision] extension:requestOpenWindow rejected — url does not match extension id')
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
  console.log('[SilverVision] overlay webview status:', url || '<no-url>', 'extId:', extId)
})
