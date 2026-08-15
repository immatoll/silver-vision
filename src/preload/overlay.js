'use strict'
// Preload for remote dApp WebContentsViews. It records public Wallet Standard
// request ids so main can return EveVault responses only to the overlay that
// initiated the request. No Electron API is exposed to the page.
const { ipcRenderer } = require('electron')

const WALLET_ACTIONS = new Set([
  'sign_personal_message',
  'sign_transaction',
  'sign_and_execute_transaction',
  'sign_sponsored_transaction'
])

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidRequestId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isPublicWalletRequest(data) {
  if (!isRecord(data) || data.__to !== 'Eve Vault' || !isValidRequestId(data.id)) return false
  if (data.type === 'connect' || data.type === 'disconnect') return true
  return typeof data.action === 'string' && WALLET_ACTIONS.has(data.action)
}

window.addEventListener('message', (event) => {
  const origin = window.location.origin
  if (!origin || origin === 'null') return
  if (event.source !== window || event.origin !== origin) return
  if (!isPublicWalletRequest(event.data)) return

  ipcRenderer.send('extension:trackDappRequest', {
    id: event.data.id,
    operation: event.data.type || event.data.action
  })
})
