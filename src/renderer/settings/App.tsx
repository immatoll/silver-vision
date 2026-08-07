import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig } from '../shared/types'

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

// ── Status flash ──────────────────────────────────────────────────────────────
function useFlash() {
  const [msg, setMsg] = useState<{ [k: string]: boolean }>({})
  const timers = useRef<{ [k: string]: ReturnType<typeof setTimeout> }>({})
  const flash = useCallback((key: string) => {
    setMsg(m => ({ ...m, [key]: true }))
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => setMsg(m => ({ ...m, [key]: false })), 3000)
  }, [])
  return { flash, visible: msg }
}

// ── Slider row ────────────────────────────────────────────────────────────────
function SliderRow({
  label, sub, value, min, max, step, format,
  onChange
}: {
  label: string; sub?: string
  value: number; min: number; max: number; step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 py-[9px] border-b border-efc-surface last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-efc-text-muted">{label}</div>
        {sub && <div className="text-[12px] text-efc-text-dim mt-[3px] leading-[1.4]">{sub}</div>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-[100px] cursor-pointer accent-efc-accent" />
        <span className="text-[12px] font-bold text-efc-accent w-10 text-right flex-shrink-0">
          {format(value)}
        </span>
      </div>
    </div>
  )
}

// ── Toggle row ────────────────────────────────────────────────────────────────
function ToggleRow({ label, sub, checked, onChange }: {
  label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 py-[9px] border-b border-efc-surface last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-efc-text-muted">{label}</div>
        {sub && <div className="text-[12px] text-efc-text-dim mt-[3px] leading-[1.4]">{sub}</div>}
      </div>
      <label className="relative w-[38px] h-[20px] flex-shrink-0 cursor-pointer">
        <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="absolute inset-0 bg-efc-surface border border-efc-border-subtle peer-checked:bg-efc-accent-deep peer-checked:border-efc-accent peer-checked:[&>span]:translate-x-[18px] peer-checked:[&>span]:bg-efc-accent transition-all">
          <span className="absolute left-[2px] top-[2px] w-[14px] h-[14px] bg-efc-border translate-x-0 transition-all duration-150" />
        </span>
      </label>
    </div>
  )
}

// ── Action row ────────────────────────────────────────────────────────────────
function ActionRow({ label, sub, btnLabel, danger, onClick, flashVisible }: {
  label: string; sub?: string; btnLabel: string; danger?: boolean
  onClick: () => void; flashVisible?: boolean
}) {
  const okMsg = (() => {
    if (!danger) return 'Done.'
    if (btnLabel === 'Reset')  return 'All positions reset.'
    if (btnLabel === 'Clear')  return 'Cleared.'
    if (btnLabel === 'Clear All') return 'All data cleared.'
    if (btnLabel === 'Reset')  return 'Vault data cleared.'
    return 'Done.'
  })()

  return (
    <div className="flex flex-col border-b border-efc-surface last:border-b-0">
      <div className="flex items-center gap-3 py-[9px]">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-efc-text-muted">{label}</div>
          {sub && <div className="text-[12px] text-efc-text-dim mt-[3px] leading-[1.4]" dangerouslySetInnerHTML={{ __html: sub }} />}
        </div>
        <button onClick={onClick}
          className={`text-[11px] font-bold tracking-[1px] uppercase px-3 py-[5px] flex-shrink-0 border cursor-pointer transition-all ${
            danger
              ? 'bg-efc-bg text-efc-red/55 border-efc-red-deep hover:text-efc-red hover:border-efc-red/55 hover:bg-efc-red-deep'
              : 'bg-efc-surface text-efc-text-muted border-efc-border hover:text-efc-text hover:border-efc-border hover:bg-efc-surface2'
          }`}>
          {btnLabel}
        </button>
      </div>
      <div className={`text-[12px] text-efc-success pb-1 transition-opacity duration-400 ${flashVisible ? 'opacity-100' : 'opacity-0'}`}>
        {okMsg}
      </div>
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold tracking-[1.8px] uppercase text-efc-text-dim pb-[5px] border-b border-efc-surface mb-[2px] mt-[18px] first:mt-0 flex-shrink-0">
      {children}
    </div>
  )
}

// ── Danger zone ───────────────────────────────────────────────────────────────
// Visually fences off the most severe destructive actions (irreversible,
// broad-impact) from routine settings on the same tab — a red-bordered
// block with its own label, instead of a bare red button sitting in the
// normal flow where it's easy to click without registering the stakes.
function DangerZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 px-3 border border-efc-red/55 bg-efc-red/5 rounded-sm">
      <div className="flex items-center gap-1.5 pt-2.5 pb-1 text-[10px] font-bold tracking-[1.8px] uppercase text-efc-red">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Danger Zone
      </div>
      {children}
    </div>
  )
}

type Tab = 'general' | 'windows' | 'cache' | 'extension'

const DEFAULT_CONFIG: AppConfig = {
  defaultOpacityMin: 0.5,
  defaultOpacityMax: 1.0,
  focusGuardMs: 500,
  closeOverlaysOnExit: true,
  eveVaultEnabled: false
}

export default function App() {
  useFocusGuard()
  const api = window.electronAPI
  const { flash, visible } = useFlash()

  const [tab, setTab] = useState<Tab>('general')
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(false)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    api.settings.getAll().then(c => { setCfg({ ...DEFAULT_CONFIG, ...c }); setLoaded(true) })

    // Mouse tracking
    document.body.addEventListener('mouseenter', () => api.mouseenter())
    document.body.addEventListener('mouseleave', () => api.mouseleave())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setCfg(c => ({ ...c, [key]: value }))
    api.settings.set(key, value)
  }

  function setDebounced<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setCfg(c => ({ ...c, [key]: value }))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => api.settings.set(key, value), 150)
  }

  function setSliderMin(v: number) {
    const clamped = Math.min(v, Math.round(cfg.defaultOpacityMax * 100))
    setDebounced('defaultOpacityMin', clamped / 100)
  }
  function setSliderMax(v: number) {
    const clamped = Math.max(v, 10)
    const min = Math.min(Math.round(cfg.defaultOpacityMin * 100), clamped)
    setDebounced('defaultOpacityMax', clamped / 100)
    if (min !== Math.round(cfg.defaultOpacityMin * 100)) setDebounced('defaultOpacityMin', min / 100)
  }

  const tabCls = (t: Tab) =>
    `py-[5px] px-3 text-[11px] font-bold tracking-[1.5px] uppercase border border-transparent cursor-pointer select-none transition-all duration-100 ${
      tab === t ? 'text-efc-accent border-efc-accent bg-efc-accent-deep' : 'text-efc-text-muted bg-none hover:text-efc-text hover:bg-[rgba(255,255,255,0.04)]'
    }`

  if (!loaded) return <div className="flex items-center justify-center w-full h-full text-[13px] text-efc-text-muted">Loading…</div>

  return (
    <div className="flex flex-col w-full h-full select-none">
      {/* Titlebar */}
      <div className="h-[32px] flex-shrink-0 flex items-center justify-between px-2 bg-efc-bg border border-efc-border drag">
        <div className="text-[14px] font-bold uppercase text-efc-text">Settings</div>
        <div className="no-drag">
          <svg onClick={() => api.settings.close()} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity" viewBox="0 0 24 24">
            <line x1="5" y1="5" x2="19" y2="19" stroke="var(--color-efc-text)" strokeWidth="2" />
            <line x1="19" y1="5" x2="5" y2="19" stroke="var(--color-efc-text)" strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-[2px] pt-2 px-2.5 pb-0 bg-efc-surface border-l border-r border-efc-border border-b border-b-efc-border-dark flex-shrink-0">
        {(['general', 'windows', 'cache', 'extension'] as Tab[]).map(t => (
          <button key={t} className={tabCls(t)} onClick={() => setTab(t)}>
            {t === 'general' ? 'General' : t === 'windows' ? 'Windows' : t === 'cache' ? 'Cache' : 'Extension'}
          </button>
        ))}
      </div>

      {/* Pane area */}
      <div className="flex-1 min-h-0 bg-efc-surface border-l border-r border-b border-efc-border overflow-y-auto
        [scrollbar-width:thin] [scrollbar-color:var(--color-efc-border)_transparent]
        [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-efc-border [&::-webkit-scrollbar-thumb:hover]:bg-efc-border">

        {/* ── General ── */}
        {tab === 'general' && (
          <div className="p-3.5 flex flex-col">
            <SectionLabel>Default Opacity</SectionLabel>
            <SliderRow label="Min opacity" sub="Faded level when idle / not hovered. Applied when a window is opened for the first time."
              value={Math.round(cfg.defaultOpacityMin * 100)} min={0} max={90} step={5}
              format={v => v + '%'} onChange={setSliderMin} />
            <SliderRow label="Max opacity" sub="Opacity when hovered or focused."
              value={Math.round(cfg.defaultOpacityMax * 100)} min={10} max={100} step={5}
              format={v => v + '%'} onChange={setSliderMax} />

            <SectionLabel>Focus Guard</SectionLabel>
            <SliderRow label="Click ignore delay"
              sub="Swallows the first click when a window gains focus. Prevents accidental clicks when a game warps the cursor on alt-tab."
              value={cfg.focusGuardMs} min={0} max={1000} step={50}
              format={v => v + 'ms'}
              onChange={v => setDebounced('focusGuardMs', v)} />
          </div>
        )}

        {/* ── Windows ── */}
        {tab === 'windows' && (
          <div className="p-3.5 flex flex-col">
            <SectionLabel>Behaviour</SectionLabel>
            <ToggleRow label="Close all overlays when menu closes"
              sub="When off, overlay windows keep running after the menu is closed."
              checked={cfg.closeOverlaysOnExit}
              onChange={v => set('closeOverlaysOnExit', v)} />

            <SectionLabel>Saved Positions</SectionLabel>
            <DangerZone>
              <ActionRow label="Reset all window positions"
                sub="Clears saved positions, sizes, opacity and pin state. Windows reopen at their default size next time."
                btnLabel="Reset" danger
                onClick={() => { api.settings.clearBounds(); flash('bounds') }}
                flashVisible={visible['bounds']} />
            </DangerZone>
          </div>
        )}

        {/* ── Cache ── */}
        {tab === 'cache' && (
          <div className="p-3.5 flex flex-col">
            <SectionLabel>Webview Session</SectionLabel>
            <ActionRow label="Clear webview cache"
              sub="Removes cached files, cookies and storage for all overlay windows. Takes effect after restart."
              btnLabel="Clear" danger
              onClick={() => { api.settings.clearSession(); flash('session') }}
              flashVisible={visible['session']} />

            <SectionLabel>Menu Data</SectionLabel>
            <ActionRow label="Clear custom menu items"
              sub='Removes all links added via the <span style="color:var(--color-efc-text-dim)">+</span> button.'
              btnLabel="Clear" danger
              onClick={() => { api.settings.clearCustomItems(); flash('custom') }}
              flashVisible={visible['custom']} />

            <SectionLabel>Full Reset</SectionLabel>
            <DangerZone>
              <ActionRow label="Clear all app data"
                sub="Resets all settings, window positions, session data and custom menu items to defaults."
                btnLabel="Clear All" danger
                onClick={async () => {
                  api.settings.clearAll()
                  const fresh = await api.settings.getAll()
                  setCfg({ ...DEFAULT_CONFIG, ...fresh })
                  flash('all')
                }}
                flashVisible={visible['all']} />
            </DangerZone>
          </div>
        )}

        {/* ── Extension ── */}
        {tab === 'extension' && (
          <div className="p-3.5 flex flex-col">
            <SectionLabel>Eve Vault</SectionLabel>
            <ActionRow label="Open vault popup"
              sub="Opens the Eve Vault popup to manage wallets, accounts or unlock the vault."
              btnLabel="Open"
              onClick={() => api.extension.openPopup()}
              flashVisible={false} />
            <DangerZone>
              <ActionRow label="Reset vault data"
                sub="Clears all stored accounts, wallets and keys from Eve Vault. You will need to re-import your wallet after this."
                btnLabel="Reset" danger
                onClick={() => { api.settings.clearVaultData(); flash('vault') }}
                flashVisible={visible['vault']} />
            </DangerZone>
          </div>
        )}
      </div>
    </div>
  )
}
