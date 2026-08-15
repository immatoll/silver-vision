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

// ── Card — the base surface every section groups into, replacing the old
// flat full-bleed pane + hairline-divider look with the browser toolbar's
// card language (rounded, bordered, its own background). ───────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col bg-efc-surface border border-efc-border rounded-lg overflow-hidden mb-3 last:mb-0">
      <div className="px-3.5 py-2.5 text-[11px] font-bold tracking-[1.5px] uppercase text-efc-text-dim border-b border-efc-border">
        {title}
      </div>
      <div className="px-3.5 py-1 flex flex-col">
        {children}
      </div>
    </div>
  )
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
    <div className="flex items-center gap-3 py-[10px] border-b border-efc-border-subtle last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-efc-text">{label}</div>
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
    <div className="flex items-center gap-3 py-[10px] border-b border-efc-border-subtle last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-efc-text">{label}</div>
        {sub && <div className="text-[12px] text-efc-text-dim mt-[3px] leading-[1.4]">{sub}</div>}
      </div>
      <label className="relative w-[38px] h-[20px] flex-shrink-0 cursor-pointer">
        <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="absolute inset-0 bg-efc-blue/20 border border-efc-blue/30 peer-checked:bg-efc-accent/10 peer-checked:border-efc-accent peer-checked:[&>span]:translate-x-[18px] peer-checked:[&>span]:bg-efc-accent rounded-sm transition-all">
          <span className="absolute left-[2px] top-[2px] w-[14px] h-[14px] bg-efc-blue translate-x-0 rounded-[1px] transition-all duration-150" />
        </span>
      </label>
    </div>
  )
}

// ── Segmented control (used for the Appearance theme picker) ───────────────
function SegmentedRow<T extends string>({ label, sub, value, options, onChange }: {
  label: string; sub?: string
  value: T; options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-3 py-[10px] border-b border-efc-border-subtle last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-efc-text">{label}</div>
        {sub && <div className="text-[12px] text-efc-text-dim mt-[3px] leading-[1.4]">{sub}</div>}
      </div>
      <div className="flex flex-shrink-0 border border-efc-border rounded-md overflow-hidden">
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`px-3 py-[5px] text-[11px] font-bold tracking-[0.5px] uppercase transition-colors ${
              value === o.value
                ? 'bg-efc-accent-solid text-white'
                : 'bg-efc-bg-alt text-efc-text-muted hover:text-efc-text'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Action row ────────────────────────────────────────────────────────────────
// `severe` marks an action as a broad/irreversible clear — instead of a
// separate boxed "Danger Zone" wrapper, it's called out inline (bold red
// warning line under the description) and the button itself reads as a
// clearly clickable warning action, not a washed-out disabled-looking one.
function ActionRow({ label, sub, warning, btnLabel, severe, onClick, flashVisible, okMessage }: {
  label: string; sub?: string; warning?: string; btnLabel: string; severe?: boolean
  onClick: () => void; flashVisible?: boolean; okMessage?: string
}) {
  return (
    <div className="flex flex-col border-b border-efc-border-subtle last:border-b-0">
      <div className="flex items-center gap-3 py-[10px]">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-efc-text">{label}</div>
          {sub && <div className="text-[12px] text-efc-text-dim mt-[3px] leading-[1.4]" dangerouslySetInnerHTML={{ __html: sub }} />}
          {warning && <div className="text-[12px] text-efc-red font-bold mt-[3px] leading-[1.4]">{warning}</div>}
        </div>
        <button onClick={onClick}
          className={`text-[11px] font-bold tracking-[1px] uppercase px-3.5 py-[7px] flex-shrink-0 rounded-md cursor-pointer transition-all ${
            severe
              ? 'bg-efc-red-solid text-white hover:bg-efc-red-solid-bright'
              : 'bg-efc-accent-solid text-white hover:bg-efc-accent-solid-bright'
          }`}>
          {btnLabel}
        </button>
      </div>
      <div className={`text-[12px] text-efc-success overflow-hidden transition-all duration-400 ${flashVisible ? 'max-h-6 opacity-100 pb-2' : 'max-h-0 opacity-0'}`}>
        {okMessage || 'Done.'}
      </div>
    </div>
  )
}

// ── Link row ──────────────────────────────────────────────────────────────────
function LinkRow({ label, value, href, onOpen }: {
  label: string; value: string; href?: string; onOpen?: (url: string) => void
}) {
  return (
    <div className="flex items-center gap-3 py-[10px] border-b border-efc-border-subtle last:border-b-0">
      <div className="text-[13px] text-efc-text-dim w-[110px] flex-shrink-0">{label}</div>
      {href ? (
        <button onClick={() => onOpen?.(href)}
          className="text-[13px] text-efc-accent hover:text-efc-accent-bright text-left truncate transition-colors">
          {value}
        </button>
      ) : (
        <div className="text-[13px] text-efc-text truncate">{value}</div>
      )}
    </div>
  )
}

type Tab = 'general' | 'windows' | 'appearance' | 'cache' | 'about'

const DEFAULT_CONFIG: AppConfig = {
  defaultOpacityMin: 0.5,
  defaultOpacityMax: 1.0,
  focusGuardMs: 500,
  closeOverlaysOnExit: true,
  eveVaultEnabled: false,
  theme: 'dark'
}

export default function App() {
  useFocusGuard()
  const api = window.electronAPI
  const { flash, visible } = useFlash()

  const [tab, setTab] = useState<Tab>('general')
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    api.settings.getVersion().then(setVersion).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    `pb-[7px] pt-[5px] text-[11px] font-bold tracking-[1px] uppercase cursor-pointer select-none transition-colors duration-100 border-b-2 ${
      tab === t ? 'text-efc-accent border-efc-accent' : 'text-efc-text-muted border-transparent hover:text-efc-text'
    }`

  if (!loaded) return <div className="flex items-center justify-center w-full h-full text-[13px] text-efc-text-muted bg-efc-bg">Loading…</div>

  return (
    <div className="flex flex-col w-full h-full select-none bg-efc-bg">
      {/* Titlebar */}
      <div className="h-[32px] flex-shrink-0 flex items-center justify-between px-2 bg-efc-bg border-b border-efc-border drag">
        <div className="text-[14px] font-bold uppercase text-efc-text">Settings</div>
        <div className="no-drag">
          <svg onClick={() => api.settings.close()} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity" viewBox="0 0 24 24">
            <line x1="5" y1="5" x2="19" y2="19" stroke="var(--color-efc-text)" strokeWidth="2" />
            <line x1="19" y1="5" x2="5" y2="19" stroke="var(--color-efc-text)" strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-4 px-3 bg-efc-bg border-b border-efc-border-subtle flex-shrink-0">
        {(['general', 'windows', 'appearance', 'cache', 'about'] as Tab[]).map(t => (
          <button key={t} className={tabCls(t)} onClick={() => setTab(t)}>
            {t === 'general' ? 'General' : t === 'windows' ? 'Windows' : t === 'appearance' ? 'Appearance' : t === 'cache' ? 'Cache' : 'About'}
          </button>
        ))}
      </div>

      {/* Pane area */}
      <div className="flex-1 min-h-0 bg-efc-bg px-2.5 pb-2.5 overflow-y-auto
        [scrollbar-width:thin] [scrollbar-color:var(--color-efc-border)_transparent]
        [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-efc-border [&::-webkit-scrollbar-thumb:hover]:bg-efc-border">

        {/* ── General ── */}
        {tab === 'general' && (
          <>
            <Card title="Default Opacity">
              <SliderRow label="Min opacity" sub="Faded level when idle / not hovered. Applied when a window is opened for the first time."
                value={Math.round(cfg.defaultOpacityMin * 100)} min={0} max={90} step={5}
                format={v => v + '%'} onChange={setSliderMin} />
              <SliderRow label="Max opacity" sub="Opacity when hovered or focused."
                value={Math.round(cfg.defaultOpacityMax * 100)} min={10} max={100} step={5}
                format={v => v + '%'} onChange={setSliderMax} />
            </Card>
            <Card title="Focus Guard">
              <SliderRow label="Click ignore delay"
                sub="Swallows the first click when a window gains focus. Prevents accidental clicks when a game warps the cursor on alt-tab."
                value={cfg.focusGuardMs} min={0} max={1000} step={50}
                format={v => v + 'ms'}
                onChange={v => setDebounced('focusGuardMs', v)} />
            </Card>
          </>
        )}

        {/* ── Windows ── */}
        {tab === 'windows' && (
          <>
            <Card title="Behaviour">
              <ToggleRow label="Close all overlays when menu closes"
                sub="When off, overlay windows keep running after the menu is closed."
                checked={cfg.closeOverlaysOnExit}
                onChange={v => set('closeOverlaysOnExit', v)} />
            </Card>
            <Card title="Saved Positions">
              <ActionRow label="Reset all window positions"
                sub="Clears saved positions, sizes, opacity and pin state. Windows reopen at their default size next time."
                warning="This affects every saved window — cannot be undone."
                btnLabel="Reset" severe
                onClick={() => { api.settings.clearBounds(); flash('bounds') }}
                flashVisible={visible['bounds']} okMessage="All positions reset." />
            </Card>
          </>
        )}

        {/* ── Appearance ── */}
        {tab === 'appearance' && (
          <Card title="Theme">
            <SegmentedRow label="Appearance" sub="Switches every SilverVision window immediately — no restart needed."
              value={cfg.theme}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
              onChange={v => set('theme', v)} />
          </Card>
        )}

        {/* ── Cache ── */}
        {tab === 'cache' && (
          <>
            <Card title="Webview Session">
              <ActionRow label="Clear webview cache"
                sub="Removes cached files, cookies and storage for all overlay windows. Takes effect after restart."
                warning="Clears cache for every open app — cannot be undone."
                btnLabel="Clear" severe
                onClick={() => { api.settings.clearSession(); flash('session') }}
                flashVisible={visible['session']} okMessage="Cleared." />
            </Card>

            <Card title="Menu Data">
              <ActionRow label="Clear custom menu items"
                sub='Removes all links added via the <span style="color:var(--color-efc-text-dim)">+</span> button.'
                warning="Removes every custom link — cannot be undone."
                btnLabel="Clear" severe
                onClick={() => { api.settings.clearCustomItems(); flash('custom') }}
                flashVisible={visible['custom']} okMessage="Cleared." />
            </Card>

            <Card title="Eve Vault">
              <ActionRow label="Reset vault data"
                sub="Clears all stored accounts, wallets and keys from Eve Vault. You will need to re-import your wallet after this."
                warning="Deletes all wallet data — cannot be undone."
                btnLabel="Reset" severe
                onClick={() => { api.settings.clearVaultData(); flash('vault') }}
                flashVisible={visible['vault']} okMessage="Vault data cleared." />
            </Card>

            <Card title="Full Reset">
              <ActionRow label="Clear all app data"
                sub="Resets all settings, window positions, session data and custom menu items to defaults."
                warning="This clears everything in SilverVision — cannot be undone."
                btnLabel="Clear All" severe
                onClick={async () => {
                  api.settings.clearAll()
                  const fresh = await api.settings.getAll()
                  setCfg({ ...DEFAULT_CONFIG, ...fresh })
                  flash('all')
                }}
                flashVisible={visible['all']} okMessage="All data cleared." />
            </Card>
          </>
        )}

        {/* ── About ── */}
        {tab === 'about' && (
          <>
            <Card title="SilverVision">
              <LinkRow label="Version" value={version || '—'} />
              <LinkRow label="Repository" value="github.com/immatoll/silver-vision"
                href="https://github.com/immatoll/silver-vision" onOpen={api.settings.openExternal} />
              <LinkRow label="Author" value="immatoll (Christian Remy)" />
              <LinkRow label="License" value="MIT — see LICENSE in the repository" />
            </Card>

            <Card title="Third-Party Components">
              <div className="text-[12px] text-efc-text-dim leading-[1.5] py-[10px]">
                Bundles the <span className="text-efc-text">EveVault</span> wallet browser extension
                and other vendored components, each under their own respective owners' terms — not
                covered by SilverVision's own MIT license. See the repository's LICENSE file for
                details.
              </div>
            </Card>

            <Card title="Special Thanks">
              <LinkRow label="ProtoDroidBot" value="github.com/ProtoDroidBot"
                href="https://github.com/ProtoDroidBot" onOpen={api.settings.openExternal} />
              <div className="text-[12px] text-efc-text-dim leading-[1.5] pb-[10px]">
                For contributing the fix that made EveVault transaction confirmations reliable
                inside SilverVision's Electron build.
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
