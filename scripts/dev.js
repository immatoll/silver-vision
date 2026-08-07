#!/usr/bin/env node
// Some terminals (notably VS Code's integrated terminal, itself an Electron
// app) leak ELECTRON_RUN_AS_NODE=1 into child shells. When that var is set,
// any nested `electron` binary launches as a plain Node process instead of
// as Electron — main/index.js then crashes immediately on `require('electron')`
// (it resolves to a path string, not the Electron API), so `npm run dev`
// silently never shows your changes. Setting it to an empty string isn't
// enough on Windows (Electron checks for the var's *existence*, not
// truthiness) — it has to be actually removed from the child's env.
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true
})

child.on('exit', code => process.exit(code ?? 0))
