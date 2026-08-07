import React from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/index.css'
import '../shared/electron.d'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
