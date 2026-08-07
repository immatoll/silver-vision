import React, { useCallback, useEffect, useRef, useState } from 'react'

const params     = new URLSearchParams(window.location.search)
const TITLE      = params.get('title') || 'Window'
const INIT_URL   = params.get('url')   || ''
const INIT_PINNED = params.get('pinned') === '1'

// ── Focus guard ───────────────────────────────────────────────────────────────
function useFocusGuard() {
  const justFocused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const onFocus = () => {
      justFocused.current = true
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { justFocused.current = false }, 500)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (justFocused.current) {
        justFocused.current = false; clearTimeout(timer.current)
        e.stopPropagation(); e.preventDefault()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [])
}

export default function App() {
  useFocusGuard()

  const api = window.electronAPI
  const [pinned, setPinned]       = useState(INIT_PINNED)
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettings] = useState(false)
  const restoreHeight = useRef<number | null>(null)

  // Mouse tracking
  useEffect(() => {
    const enter = () => api.mouseenter()
    const leave = () => api.mouseleave()
    document.body.addEventListener('mouseenter', enter)
    document.body.addEventListener('mouseleave', leave)
    return () => {
      document.body.removeEventListener('mouseenter', enter)
      document.body.removeEventListener('mouseleave', leave)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // IPC listeners
  useEffect(() => {
    api.overlay.onPinChanged(active => setPinned(active))
    api.overlay.onSettingsMenuClosed(() => setSettings(false))
    api.overlay.onSetVisible(visible => {
      if (!visible && settingsOpen) {
        setSettings(false)
        api.overlay.settingsMenuVisible(false)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => api.close(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePin = useCallback(() => {
    api.overlay.togglePin()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSettings = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !settingsOpen
    setSettings(next)
    api.overlay.settingsMenuVisible(next)
  }, [settingsOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCollapse = useCallback(async () => {
    const next = !collapsed
    setCollapsed(next)
    if (next) {
      const bounds = await api.overlay.getBounds()
      restoreHeight.current = bounds.height
      api.overlay.setCollapsed({ collapsed: true, restoreHeight: bounds.height })
    } else {
      api.overlay.setCollapsed({ collapsed: false, restoreHeight: restoreHeight.current || 400 })
    }
  }, [collapsed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pin visual
  const pinColor  = pinned ? 'var(--color-efc-accent)' : 'var(--color-efc-text)'
  const pinFill   = pinned ? 'color-mix(in srgb, var(--color-efc-accent) 15%, transparent)' : 'none'

  return (
    <div className={`flex flex-col w-full h-full ${collapsed ? 'overflow-hidden' : ''}`}
      style={{ background: 'transparent' }}>
      {/* Titlebar */}
      <div className="flex-shrink-0 h-[32px] flex items-center justify-between px-2 bg-efc-bg border border-efc-border drag"
        style={{ boxSizing: 'border-box' }}>
        <div className="text-[14px] font-bold uppercase text-efc-text truncate pr-2">{TITLE}</div>
        <div className="flex items-center gap-1.5 flex-shrink-0 no-drag">
          {/* Pin */}
          <svg onClick={handlePin} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <title>Pin window (stay visible)</title>
            <circle cx="11.5" cy="8.5" r="5.5" stroke={pinColor} fill={pinFill} />
            <path d="M11.5 14v7" stroke={pinColor} />
          </svg>
          {/* Settings (3-dot) */}
          <svg onClick={handleSettings} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <title>Window settings</title>
            <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
          {/* Collapse */}
          <svg onClick={handleCollapse} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            viewBox="0 0 24 24" fill="none" stroke="var(--color-efc-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <title>{collapsed ? 'Expand window' : 'Collapse window'}</title>
            {collapsed
              ? <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              : <line x1="5" y1="12" x2="19" y2="12" />}
          </svg>
          {/* Close */}
          <svg onClick={handleClose} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity" viewBox="0 0 24 24">
            <line x1="5" y1="5" x2="19" y2="19" stroke="var(--color-efc-text)" strokeWidth="2" />
            <line x1="19" y1="5" x2="5" y2="19" stroke="var(--color-efc-text)" strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Content area */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden border-r border-l border-b border-efc-border bg-efc-bg"
          style={{ position: 'relative' }}>
          {INIT_URL && INIT_URL.startsWith('file://') && (
            <iframe src={INIT_URL} className="absolute inset-0 w-full h-full border-none" title={TITLE} />
          )}
          {/* Remote URLs: WebContentsView placed by main process — no element needed */}
        </div>
      )}
    </div>
  )
}
