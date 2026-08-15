import React, { useCallback, useEffect, useMemo, useState } from 'react'

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

interface CatalogApp {
  name:        string
  url:         string
  icon?:       string
  width?:      number
  height?:     number
  category?:   string
}

interface MenuItem {
  name:      string
  url:       string
  icon?:     string
  width?:    number
  height?:   number
  category?: string
}

interface CustomApp extends CatalogApp {
  id: string
}

// Mirrors BROWSER_NEW_TAB_URL in main/index.js — a blank/unnavigated tab.
const NEW_TAB_URL = 'silvervision://new-tab'

// Normalize a URL down to a comparable host — ignores scheme, subpaths,
// query/hash, and a leading "www." so http(s)://ef-map.com/anything all
// match the same existing app.
function originKey(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function GlobeIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
    </svg>
  )
}

function Favicon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <GlobeIcon className="w-3.5 h-3.5 text-efc-text-muted flex-shrink-0" />
  return (
    <img src={src} onError={() => setFailed(true)} className="w-3.5 h-3.5 flex-shrink-0" alt="" />
  )
}

export default function App() {
  const api = window.electronAPI
  const [state, setState] = useState<BrowserTabsState>({ activeTabId: null, tabs: [] })
  const [inputValue, setInputValue] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [addStatus, setAddStatus] = useState<'idle' | 'working' | 'added' | 'exists' | 'error'>('idle')

  useEffect(() => {
    api.browser.onTabsChanged(setState)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = useMemo(
    () => state.tabs.find(t => t.id === state.activeTabId) || null,
    [state]
  )

  useEffect(() => {
    if (!inputFocused && activeTab) setInputValue(activeTab.url === NEW_TAB_URL ? '' : activeTab.url)
  }, [activeTab, inputFocused])

  const handleNavigate = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTab) return
    api.browser.navigate(activeTab.id, inputValue)
    setInputFocused(false)
  }, [activeTab, inputValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewTab = useCallback(() => api.browser.newTab(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAsApp = useCallback(async () => {
    if (!activeTab || !activeTab.url || activeTab.url === NEW_TAB_URL) return
    const key = originKey(activeTab.url)
    if (!key) return
    setAddStatus('working')
    try {
      const [items, customApps, catalogRes] = await Promise.all([
        api.menu.getCustomItems(),
        api.appstore.getCustomApps(),
        api.catalog.read()
      ])

      const alreadyMenu = (items || []).some(i => originKey(i.url) === key)
      const alreadyCustom = (customApps || []).some(a => originKey(a.url) === key)
      if (alreadyMenu || alreadyCustom) { setAddStatus('exists'); setTimeout(() => setAddStatus('idle'), 1800); return }

      let catalogMatch: CatalogApp | undefined
      if (catalogRes?.ok && catalogRes.text) {
        try {
          const parsed = JSON.parse(catalogRes.text) as { apps?: CatalogApp[] }
          catalogMatch = (parsed.apps || []).find(a => a && typeof a.url === 'string' && originKey(a.url) === key)
        } catch { /* ignore malformed catalog.json — fall through to adding a new item */ }
      }

      const fields = catalogMatch
        ? {
            name: catalogMatch.name, url: catalogMatch.url, icon: catalogMatch.icon || '',
            width: catalogMatch.width || 1000, height: catalogMatch.height || 1000,
            category: catalogMatch.category || ''
          }
        : {
            name: activeTab.title || key, url: activeTab.url, icon: activeTab.favicon || '',
            width: 1000, height: 700, category: ''
          }

      // Register in both stores: custom-items.json (what the menu launcher
      // reads) and the App Store's own catalog-custom-apps.json (so it shows
      // up as a manually-added entry there too, browsable/editable/removable
      // the same as one authored via the App Store's own form).
      const [menuRes, customRes] = await Promise.all([
        api.menu.addCustomItem(fields as Partial<MenuItem>),
        api.appstore.upsertCustomApp(fields)
      ])
      setAddStatus((menuRes && menuRes.ok === false) || (customRes && customRes.ok === false) ? 'error' : 'added')
    } catch {
      setAddStatus('error')
    }
    setTimeout(() => setAddStatus('idle'), 1800)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    api.browser.closeTab(tabId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const canCloseTabs = state.tabs.length > 1
  // Shrink target tab width as more tabs open; floor high enough to still show a favicon.
  const tabMaxWidth = Math.max(32, Math.min(180, Math.floor(720 / Math.max(1, state.tabs.length))))
  const showTabTitle = tabMaxWidth > 60

  return (
    <div className="flex flex-col w-full h-full bg-efc-bg border-l border-r border-efc-border select-none"
      style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Tab strip */}
      <div className="flex-shrink-0 h-[36px] flex items-center gap-1 px-1.5 border-b border-efc-border overflow-hidden">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          {state.tabs.map(tab => {
            const active = tab.id === state.activeTabId
            return (
              <div
                key={tab.id}
                onClick={() => api.browser.activateTab(tab.id)}
                className={`flex items-center gap-1.5 h-[26px] px-2 rounded-t-sm cursor-pointer flex-shrink min-w-[32px] transition-colors border ${
                  active
                    ? 'bg-efc-surface text-efc-text border-efc-border-strong border-b-efc-accent border-b-2'
                    : 'bg-efc-bg-alt text-efc-text-muted border-efc-border-subtle hover:bg-efc-surface2 hover:text-efc-text'
                }`}
                style={{ maxWidth: tabMaxWidth }}
                title={tab.url === NEW_TAB_URL ? 'New Tab' : (tab.title || tab.url)}
              >
                <Favicon src={tab.url === NEW_TAB_URL ? '' : tab.favicon} />
                {showTabTitle && (
                  <span className="text-[11px] truncate">
                    {tab.url === NEW_TAB_URL ? 'New Tab' : (tab.title || tab.url)}
                  </span>
                )}
                {canCloseTabs && (
                  <svg onClick={e => handleCloseTab(e, tab.id)}
                    className="w-3 h-3 flex-shrink-0 opacity-50 hover:opacity-100 cursor-pointer" viewBox="0 0 24 24">
                    <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
                    <line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </div>
            )
          })}
        </div>
        <svg onClick={handleNewTab}
          className="w-5 h-5 flex-shrink-0 cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <title>New tab</title>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>

      {/* Omnibox + nav buttons */}
      <div className="flex-shrink-0 h-[40px] flex items-center gap-1.5 px-2">
        <svg onClick={() => activeTab && api.browser.goBack(activeTab.id)}
          className={`w-5 h-5 flex-shrink-0 ${activeTab?.canGoBack ? 'cursor-pointer opacity-70 hover:opacity-100' : 'opacity-25 cursor-default'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <title>Back</title>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <svg onClick={() => activeTab && api.browser.goForward(activeTab.id)}
          className={`w-5 h-5 flex-shrink-0 ${activeTab?.canGoForward ? 'cursor-pointer opacity-70 hover:opacity-100' : 'opacity-25 cursor-default'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <title>Forward</title>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg onClick={() => activeTab && api.browser.reload(activeTab.id)}
          className="w-5 h-5 flex-shrink-0 cursor-pointer opacity-70 hover:opacity-100"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <title>{activeTab?.isLoading ? 'Stop' : 'Reload'}</title>
          {activeTab?.isLoading
            ? <line x1="6" y1="6" x2="18" y2="18" />
            : <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />}
        </svg>

        <form onSubmit={handleNavigate} className="flex-1 min-w-0">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onFocus={e => { setInputFocused(true); e.target.select() }}
            onBlur={() => setInputFocused(false)}
            placeholder="Search Google or enter address"
            className="w-full h-[26px] px-2.5 text-[12px] rounded-sm bg-efc-surface border border-efc-border text-efc-text
                       focus:outline-none focus:border-efc-accent placeholder:text-efc-text-muted"
          />
        </form>

        <svg onClick={activeTab?.url === NEW_TAB_URL ? undefined : handleAddAsApp}
          className={`w-5 h-5 flex-shrink-0 transition-opacity ${
            activeTab?.url === NEW_TAB_URL ? 'opacity-25 cursor-default'
              : addStatus === 'working' ? 'opacity-40 cursor-wait'
              : addStatus === 'added' || addStatus === 'exists' ? 'opacity-100 text-efc-accent'
              : addStatus === 'error' ? 'opacity-100 text-efc-red'
              : 'cursor-pointer opacity-70 hover:opacity-100'
          }`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <title>
            {activeTab?.url === NEW_TAB_URL ? 'Nothing to add yet'
              : addStatus === 'added' ? 'Added to menu'
              : addStatus === 'exists' ? 'Already in menu'
              : addStatus === 'error' ? 'Could not add app'
              : 'Add this page as an app'}
          </title>
          {addStatus === 'added' || addStatus === 'exists'
            ? <polyline points="20 6 9 17 4 12" />
            : <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </>}
        </svg>
      </div>
    </div>
  )
}
