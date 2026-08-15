import React from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/index.css'
import '../shared/electron.d'
import { initTheme } from '../shared/theme'
import App from './App.tsx'

initTheme()
createRoot(document.getElementById('root')!).render(<App />)
