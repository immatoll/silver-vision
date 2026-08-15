import React, { useEffect, useRef, useState } from 'react'

const p = new URLSearchParams(window.location.search)
const INIT_MIN = Math.round(parseFloat(p.get('opacityMin') || '0.3') * 100)
const INIT_MAX = Math.round(parseFloat(p.get('opacityMax') || '0.9') * 100)

export default function App() {
  const [minVal, setMinVal] = useState(INIT_MIN)
  const [maxVal, setMaxVal] = useState(INIT_MAX)
  const [mounted, setMounted] = useState(false)
  const dbn = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The host WebContentsView is created once and just resized to/from zero
  // bounds on toggle — its page never reloads — so fake the "popping up"
  // feel with a CSS transition replayed via an explicit main-process nudge
  // each time the panel is shown, not just once at initial mount.
  useEffect(() => {
    const playIn = () => {
      setMounted(false)
      requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)))
    }
    playIn()
    window.electronAPI.settingsPanel.onShown(playIn)
  }, [])

  const send = (min: number, max: number) => {
    clearTimeout(dbn.current)
    dbn.current = setTimeout(() => {
      window.electronAPI.settingsPanel.setOpacityRange(min / 100, max / 100)
    }, 100)
  }

  function changeMin(v: number) {
    const clamped = Math.min(v, maxVal)
    setMinVal(clamped); send(clamped, maxVal)
  }
  function changeMax(v: number) {
    const clamped = Math.max(v, 10)
    const newMin = Math.min(minVal, clamped)
    setMaxVal(clamped); setMinVal(newMin); send(newMin, clamped)
  }

  // The host WebContentsView is inflated by SETTINGS_PANEL_SHADOW_MARGIN
  // (main/index.js) on every side beyond the panel's visual size, purely so
  // this drop shadow has room to render without being clipped — this outer
  // div's padding must match that margin exactly.
  return (
    <div className="w-full h-full" style={{ padding: 16 }}>
      <div
        className="flex flex-col gap-[10px] px-3 py-[10px] w-full h-full bg-efc-surface border border-efc-border-strong rounded-lg select-none"
        style={{
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
          transformOrigin: 'top right',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(-4px)',
          transition: 'opacity 120ms ease-out, transform 120ms ease-out'
        }}
      >
        <div>
          <label className="flex justify-between text-[11px] text-efc-text-muted mb-1">
            <span>Min opacity</span>
            <span>{minVal}%</span>
          </label>
          <input type="range" min={0} max={100} step={5} value={minVal}
            onChange={e => changeMin(Number(e.target.value))}
            className="w-full cursor-pointer accent-efc-accent" />
        </div>
        <div>
          <label className="flex justify-between text-[11px] text-efc-text-muted mb-1">
            <span>Max opacity</span>
            <span>{maxVal}%</span>
          </label>
          <input type="range" min={0} max={100} step={5} value={maxVal}
            onChange={e => changeMax(Number(e.target.value))}
            className="w-full cursor-pointer accent-efc-accent" />
        </div>
      </div>
    </div>
  )
}
