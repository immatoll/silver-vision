import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogApp, Catalog, MenuItem } from '../shared/types'

// -- Focus guard ---------------------------------------------------------------
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

// -- App icon ------------------------------------------------------------------
// Every icon renders into the same size square with a solid backing (so
// transparent-background source icons don't show the page through them) and
// rounded "app icon" corners that clip whatever's inside — images fill the
// square via object-cover (cropped, not letterboxed) to look uniform next to
// each other regardless of their native aspect ratio.
function AppIcon({ icon, name, size = 40 }: { icon?: string; name: string; size?: number }) {
  const iconStr = icon ?? ''
  const radius = Math.round(size * 0.22)

  let inner: React.ReactNode
  if (iconStr.startsWith('<svg')) {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(iconStr, 'image/svg+xml')
      const svgEl = doc.documentElement
      svgEl.querySelectorAll('script').forEach(s => s.remove())
      // Fill the square and crop overflow (like object-cover on <img>) so
      // small/oddly-proportioned source icons still reach full size instead
      // of shrinking to fit and leaving gaps.
      svgEl.setAttribute('width', '100%')
      svgEl.setAttribute('height', '100%')
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice')
      inner = <span className="flex items-center justify-center w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svgEl.outerHTML }} />
    } catch (_) { inner = null }
  } else if (iconStr.match(/^https?:|^data:image\//)) {
    inner = (
      <img src={iconStr} alt="" className="w-full h-full object-cover"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
    )
  } else {
    const words = (name || '?').trim().split(/[\s|_\-\.\/]+/).filter(Boolean)
    const initials = words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : (name || '?').slice(0, 2).toUpperCase()
    inner = <span className="font-bold text-efc-text-muted" style={{ fontSize: Math.round(size * 0.44) }}>{initials}</span>
  }

  return (
    <span
      className="flex-shrink-0 inline-flex items-center justify-center overflow-hidden bg-efc-surface2 border border-efc-border-subtle"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {inner}
    </span>
  )
}

// -- App card ------------------------------------------------------------------
function AppCard({
  app, added, onAdd, onRemove, onPreview, editBtn, delBtn
}: {
  app: CatalogApp | CustomApp
  added?: boolean
  onAdd?: () => void
  onRemove?: () => void
  onPreview?: () => void
  editBtn?: React.ReactNode
  delBtn?: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)

  async function handleToggle() {
    setBusy(true)
    if (added && onRemove) await onRemove()
    else if (!added && onAdd) await onAdd()
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-efc-bg transition-colors duration-100 last:border-b-0">
      <div className="flex-shrink-0">
        <AppIcon icon={app.icon} name={app.name} size={40} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="text-[14px] font-bold tracking-[0.3px] uppercase text-efc-text truncate">{app.name}</div>
        {app.description && <div className="text-[12px] text-efc-text-dim truncate">{app.description}</div>}
      </div>
      <div className="flex-shrink-0 flex gap-1.5 items-center no-drag">
        {onPreview && (
          <button onClick={onPreview} title="Preview"
            className="p-1 border border-transparent rounded-sm text-efc-text-muted hover:text-efc-text hover:border-efc-border-strong hover:bg-[rgba(255,255,255,0.04)] transition-all duration-100">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        )}
        {editBtn}
        {delBtn}
        {(onAdd || onRemove) && (
          <label className={`relative w-[38px] h-[20px] flex-shrink-0 cursor-pointer`} title={added ? 'Remove from menu' : 'Add to menu'}>
            <input type="checkbox" className="sr-only peer" checked={!!added} disabled={busy} onChange={handleToggle} />
            <span className="absolute inset-0 bg-efc-blue/20 border border-efc-blue/30 peer-checked:bg-efc-accent/10 peer-checked:border-efc-accent peer-checked:[&>span]:translate-x-[18px] peer-checked:[&>span]:bg-efc-accent rounded-sm transition-all">
              <span className="absolute left-[2px] top-[2px] w-[14px] h-[14px] bg-efc-blue translate-x-0 rounded-[1px] transition-all duration-150" />
            </span>
          </label>
        )}
      </div>
    </div>
  )
}

// -- Custom app type -----------------------------------------------------------
// Stored in userData (via api.appstore.*), not localStorage — so it's shared
// across windows (the browser toolbar's "add as app" writes here too) and
// survives settings:clearAll like every other persisted store.
interface CustomApp extends CatalogApp {
  id: string
}

// -- Custom form ---------------------------------------------------------------
interface CustomFormState {
  name: string; url: string; icon: string; description: string
  width: string; height: string; category: string
}
const FORM_EMPTY: CustomFormState = { name: '', url: '', icon: '', description: '', width: '1000', height: '1000', category: '' }

// -- Floating form panel ---------------------------------------------------
// Overlays the list instead of pushing it down — a DOM/CSS version of the
// same "popup" treatment built for the overlay-window opacity settings
// panel (fade+scale-in, elevation shadow, floats over the content below
// it). That one needed a separate WebContentsView with main-process-driven
// bounds since it floats above a page in a different renderer; here
// everything lives in one React tree, so plain position:absolute + a CSS
// transition does the same job with far less machinery.
function CustomFormPanel({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="absolute left-0 right-0 z-10 px-2 pt-2" style={{ top: '100%', pointerEvents: 'none' }}>
      <div
        className="rounded-lg border border-efc-border-strong bg-efc-bg overflow-hidden"
        style={{
          pointerEvents: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
          transformOrigin: 'top',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(-6px)',
          transition: 'opacity 120ms ease-out, transform 120ms ease-out'
        }}
      >
        {children}
      </div>
    </div>
  )
}

function CustomForm({
  initial, onSave, onCancel, onPreview
}: {
  initial?: CustomFormState
  onSave: (data: CustomFormState) => void
  onCancel: () => void
  onPreview: (data: CustomFormState) => void
}) {
  const [form, setForm] = useState<CustomFormState>(initial ?? FORM_EMPTY)
  const [errors, setErrors] = useState<{ name?: boolean; url?: boolean }>({})

  function set(k: keyof CustomFormState, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function handleSave() {
    const e: typeof errors = {}
    if (!form.name.trim()) e.name = true
    if (!form.url.trim())  e.url  = true
    if (Object.keys(e).length) { setErrors(e); return }
    onSave(form)
  }

  const inputCls = (err?: boolean) =>
    `w-full bg-[rgba(255,255,255,0.03)] border rounded-sm text-efc-text text-[13px] px-2 py-[5px] outline-none placeholder-efc-text-faint focus:bg-[rgba(255,255,255,0.04)] transition-colors ${
      err ? 'border-efc-red/50' : 'border-efc-border focus:border-efc-accent/35'
    }`

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">Name *</label>
        <input className={inputCls(errors.name)} value={form.name} onChange={e => set('name', e.target.value)} placeholder="App name" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">URL *</label>
        <input className={inputCls(errors.url)} value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://... or file path" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">Icon (SVG code or image URL)</label>
        <input className={inputCls()} value={form.icon} onChange={e => set('icon', e.target.value)} placeholder="<svg> or https://.../icon.png" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">Description</label>
        <input className={inputCls()} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short description (optional)" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">Width</label>
          <input type="number" className={inputCls()} value={form.width} onChange={e => set('width', e.target.value)} min="200" max="3840" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">Height</label>
          <input type="number" className={inputCls()} value={form.height} onChange={e => set('height', e.target.value)} min="200" max="2160" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold tracking-[1px] uppercase text-efc-text-muted">Category</label>
          <input className={inputCls()} value={form.category} onChange={e => set('category', e.target.value)} placeholder="Custom" />
        </div>
      </div>
      <div className="flex gap-1.5 justify-end pt-0.5">
        <button onClick={onCancel}
          className="text-[11px] font-bold tracking-[1px] uppercase px-2.5 py-1 bg-transparent border border-efc-border text-efc-text-muted rounded-sm hover:text-efc-text hover:border-efc-border transition-all">
          Cancel
        </button>
        <button onClick={() => onPreview(form)}
          className="text-[11px] font-bold tracking-[1px] uppercase px-2.5 py-1 bg-transparent border border-efc-border text-efc-text-muted rounded-sm hover:text-efc-text hover:border-efc-border transition-all">
          Preview
        </button>
        <button onClick={handleSave}
          className="text-[11px] font-bold tracking-[1px] uppercase px-2.5 py-1 bg-efc-blue/25 border border-efc-blue/30 text-efc-blue rounded-sm hover:bg-efc-blue/45 hover:text-efc-blue-bright transition-all">
          Save
        </button>
      </div>
    </div>
  )
}

// -- Main App ------------------------------------------------------------------
export default function App() {
  useFocusGuard()

  const api = window.electronAPI

  // Catalog state
  const [catalogApps, setCatalogApps]       = useState<CatalogApp[]>([])
  const [addedUrls, setAddedUrls]           = useState<Set<string>>(new Set())
  const [catalogStatus, setCatalogStatus]   = useState<'loading' | 'error' | 'ok'>('loading')
  const [catalogError, setCatalogError]     = useState<string>('')
  const [search, setSearch]                 = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Custom tab state
  const [customApps, setCustomApps]         = useState<CustomApp[]>([])
  const [showForm, setShowForm]             = useState(false)
  const [editingApp, setEditingApp]         = useState<CustomApp | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // Load catalog + added state
  const loadCatalog = useCallback(async () => {
    setCatalogStatus('loading')
    const result = await api.catalog.read()
    if (!result.ok || !result.text) { setCatalogStatus('error'); setCatalogError(result.error || 'catalog.json not found'); return }
    let data: Catalog
    try { data = JSON.parse(result.text) } catch { setCatalogStatus('error'); setCatalogError('catalog.json contains invalid JSON'); return }
    if (!Array.isArray(data.apps)) { setCatalogStatus('error'); setCatalogError('catalog.json must have an "apps" array'); return }
    setCatalogApps(data.apps.filter(a => a && typeof a.name === 'string' && typeof a.url === 'string'))
    // Refresh added state
    try {
      const items = await api.menu.getCustomItems()
      setAddedUrls(new Set((items || []).map(i => i.url)))
    } catch { setAddedUrls(new Set()) }
    setCatalogStatus('ok')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCatalog() }, [loadCatalog])

  useEffect(() => {
    api.appstore.getCustomApps().then(setCustomApps).catch(() => {})
    api.appstore.onCustomAppsChanged(setCustomApps)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(app: CatalogApp | CustomApp) {
    const res = await api.menu.addCustomItem({
      name: app.name, url: app.url, icon: app.icon || '',
      width: app.width || 1000, height: app.height || 1000,
      category: app.category || ''
    })
    if (!res || res.ok !== false) setAddedUrls(prev => new Set([...prev, app.url]))
  }

  async function handleRemove(app: CatalogApp | CustomApp) {
    const res = await api.menu.removeCustomItem(app.url)
    if (!res || res.ok !== false) setAddedUrls(prev => { const n = new Set(prev); n.delete(app.url); return n })
  }

  function previewApp(app: CatalogApp | CustomApp) {
    api.menu.openOverlay({ title: app.name, url: app.url, width: app.width || 1000, height: app.height || 1000 })
  }

  // Catalog + custom apps share one list, filter, and category grouping —
  // a custom app just lands in its own category (existing or new) alongside
  // catalog apps instead of living in a separate section.
  function isCustomApp(app: CatalogApp | CustomApp): app is CustomApp {
    return 'id' in app
  }
  const allApps: (CatalogApp | CustomApp)[] = [...catalogApps, ...customApps]
  const categories = [...new Set(allApps.map(a => a.category).filter(Boolean))].sort()
  const filtered = allApps.filter(app => {
    if (categoryFilter !== 'all' && app.category !== categoryFilter) return false
    const q = search.toLowerCase()
    if (q && !(app.name.toLowerCase().includes(q) || (app.description || '').toLowerCase().includes(q))) return false
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))

  // Group into category sections (skipped once the user's already filtered
  // down to one category — a single-group header would be redundant then).
  // Essential apps get pulled out of their normal category into their own
  // "Essential" group, pinned above every other category regardless of
  // alphabetical order.
  const ESSENTIAL_CATEGORY = 'Essential'
  const groupedByCategory: [string, (CatalogApp | CustomApp)[]][] = (() => {
    if (categoryFilter !== 'all') return [['', filtered]]
    const map = new Map<string, (CatalogApp | CustomApp)[]>()
    for (const app of filtered) {
      const cat = app.essential ? ESSENTIAL_CATEGORY : (app.category || 'Other')
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(app)
    }
    const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const essentialIdx = entries.findIndex(([cat]) => cat === ESSENTIAL_CATEGORY)
    if (essentialIdx > 0) entries.unshift(...entries.splice(essentialIdx, 1))
    return entries
  })()

  async function handleSaveForm(data: CustomFormState) {
    const app: Partial<CustomApp> = {
      id: editingApp?.id,
      name: data.name.trim(), url: data.url.trim(),
      icon: data.icon.trim(), description: data.description.trim(),
      width: Math.max(200, Math.min(3840, parseInt(data.width) || 1000)),
      height: Math.max(200, Math.min(2160, parseInt(data.height) || 1000)),
      category: data.category.trim() || 'Custom',
    }
    const res = await api.appstore.upsertCustomApp(app)
    if (editingApp && res.ok && addedUrls.has(editingApp.url)) {
      // Update the corresponding menu item if this custom app was added
      await api.menu.removeCustomItem(editingApp.url)
      setAddedUrls(prev => { const n = new Set(prev); n.delete(editingApp.url); return n })
      await api.menu.addCustomItem({ name: app.name, url: app.url, icon: app.icon, width: app.width, height: app.height, category: app.category })
      setAddedUrls(prev => new Set([...prev, app.url!]))
    }
    setShowForm(false); setEditingApp(null)
  }

  // -- Btn styles -------------------------------------------------------------
  const selectCls = 'bg-efc-bg border border-efc-border text-efc-text text-[12px] font-bold tracking-[0.5px] uppercase cursor-pointer outline-none px-2 py-[3px] rounded-sm hover:border-efc-border-subtle transition-colors appearance-none'

  return (
    <div className="flex flex-col w-full h-full select-none">
      {/* Titlebar */}
      <div className="h-[32px] flex-shrink-0 flex items-center justify-between px-2 bg-efc-bg border border-efc-border drag">
        <div className="text-[14px] font-bold uppercase text-efc-text">App Store</div>
        <div className="flex items-center gap-1.5 no-drag">
          <svg onClick={loadCatalog} className="w-5 h-5 cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <title>Refresh catalog</title>
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.45"/>
          </svg>
          <svg onClick={() => api.close()} className="w-5 h-5 cursor-pointer opacity-50 hover:opacity-100 transition-opacity" viewBox="0 0 24 24">
            <line x1="5" y1="5" x2="19" y2="19" stroke="var(--color-efc-text)" strokeWidth="2"/>
            <line x1="19" y1="5" x2="5" y2="19" stroke="var(--color-efc-text)" strokeWidth="2"/>
          </svg>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 bg-efc-bg border-x border-b border-efc-border">
        {/* Search + filter bar — position:relative anchor for the floating
            add-app panel below, so the panel sits right under THIS bar
            specifically rather than at the top of the whole content area. */}
        <div className="flex-shrink-0" style={{ position: 'relative' }}>
          <div className="flex items-center gap-2 px-3 py-2 bg-efc-bg border-b border-efc-border">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-efc-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-none text-efc-text text-[13px] outline-none placeholder-efc-text-dim"
              placeholder="Search apps..." autoComplete="off" spellCheck={false}
            />
            {search && (
              <button onClick={() => { setSearch(''); searchRef.current?.focus() }}
                className="text-efc-text-muted hover:text-efc-text-muted text-[16px] leading-none bg-none border-none cursor-pointer">&times;</button>
            )}
            {catalogStatus === 'ok' && (
              <>
                <div className="w-px h-[13px] bg-efc-border flex-shrink-0" />
                {categories.length > 0 && (
                  <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={selectCls}>
                    <option value="all">All Categories</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <div className="w-px h-[13px] bg-efc-border flex-shrink-0" />
            <button onClick={() => { setEditingApp(null); setShowForm(true) }}
              className="flex-shrink-0 text-[11px] font-bold tracking-[1px] uppercase px-2.5 py-1 bg-efc-blue/20 border border-efc-blue/25 text-efc-blue rounded-sm hover:bg-efc-blue/40 hover:text-efc-blue-bright transition-all">
              Add
            </button>
          </div>

          {/* App form, when adding/editing a custom app — floats below the
              search/filter bar like a popup (same treatment as the
              overlay-window opacity settings panel) instead of pushing the
              list down. */}
          {showForm && (
            <CustomFormPanel>
              <CustomForm
                initial={editingApp ? {
                  name: editingApp.name, url: editingApp.url, icon: editingApp.icon || '',
                  description: editingApp.description || '', width: String(editingApp.width || 1000),
                  height: String(editingApp.height || 1000), category: editingApp.category || ''
                } : undefined}
                onSave={handleSaveForm}
                onCancel={() => { setShowForm(false); setEditingApp(null) }}
                onPreview={data => api.menu.openOverlay({ title: data.name || 'Preview', url: data.url, width: parseInt(data.width) || 1000, height: parseInt(data.height) || 1000 })}
              />
            </CustomFormPanel>
          )}
        </div>

        {/* Catalog + custom apps, one continuous scroll */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {catalogStatus === 'loading' && <div className="text-center py-8 text-[13px] text-efc-text-muted">Loading catalog...</div>}
          {catalogStatus === 'error'   && <div className="text-center py-8 text-[13px] text-efc-red px-4 leading-relaxed">{catalogError}</div>}
          {catalogStatus === 'ok' && filtered.length === 0 && (
            <div className="text-center py-8 text-[13px] text-efc-text-muted">
              {allApps.length === 0 ? 'No apps yet.' : 'No apps match your filters.'}
            </div>
          )}
          {catalogStatus === 'ok' && groupedByCategory.map(([cat, apps]) => (
            <div key={cat || 'flat'}>
              {cat && (
                <div className="sticky top-0 z-[1] px-3 py-1.5 bg-efc-bg border-b border-efc-border-subtle text-[10px] font-bold tracking-[1.5px] uppercase text-efc-text">
                  {cat} <span className="text-efc-text-text">- {apps.length}</span>
                </div>
              )}
              {apps.map(app => (
                <AppCard key={isCustomApp(app) ? app.id : app.url} app={app} added={addedUrls.has(app.url)}
                  onAdd={() => handleAdd(app)} onRemove={() => handleRemove(app)}
                  onPreview={() => previewApp(app)}
                  editBtn={isCustomApp(app) ? (
                    <button onClick={() => { setEditingApp(app); setShowForm(true) }} title="Edit"
                      className="p-1 border border-transparent rounded-sm text-efc-text-muted hover:text-efc-text hover:border-efc-border-strong hover:bg-[rgba(255,255,255,0.04)] transition-all duration-100">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  ) : undefined}
                  delBtn={isCustomApp(app) ? (
                    <button onClick={async () => {
                      const customApp = app
                      if (addedUrls.has(customApp.url)) { await api.menu.removeCustomItem(customApp.url); setAddedUrls(prev => { const n = new Set(prev); n.delete(customApp.url); return n }) }
                      await api.appstore.removeCustomApp(customApp.id)
                    }} title="Delete"
                      className="p-1 border border-transparent rounded-sm text-efc-text-muted hover:text-efc-red hover:border-efc-red/30 hover:bg-efc-red/5 transition-all duration-100">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  ) : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
