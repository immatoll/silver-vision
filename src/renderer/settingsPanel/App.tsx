import React, { useEffect, useRef, useState } from 'react'

const p = new URLSearchParams(window.location.search)
const INIT_MIN = Math.round(parseFloat(p.get('opacityMin') || '0.3') * 100)
const INIT_MAX = Math.round(parseFloat(p.get('opacityMax') || '0.9') * 100)

export default function App() {
  const [minVal, setMinVal] = useState(INIT_MIN)
  const [maxVal, setMaxVal] = useState(INIT_MAX)
  const dbn = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

  return (
    <div className="flex flex-col gap-[10px] px-3 py-[10px] bg-efc-bg border border-t-0 border-efc-border select-none"
      style={{ fontFamily: 'system-ui, sans-serif' }}>
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
  )
}
