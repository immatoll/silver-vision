'use strict'
// Preload for extension popup windows opened via openExtensionWindow().
// contextIsolation is FALSE for these windows so chrome extension APIs work.
//
// Provides chrome.identity.launchWebAuthFlow for the vault popup.
const { ipcRenderer } = require('electron')

ipcRenderer.on('extension:oauthRedirect', (_ev, url) => {
  if (typeof window.__efcOAuthFinish === 'function') {
    const fn = window.__efcOAuthFinish
    window.__efcOAuthFinish = null
    fn(url)
  }
})

;(function () {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return
    if (chrome.identity && typeof chrome.identity.launchWebAuthFlow === 'function') return

    if (!chrome.identity) chrome.identity = {}

    if (typeof chrome.identity.getRedirectURL !== 'function') {
      chrome.identity.getRedirectURL = function (path) {
        return 'https://' + chrome.runtime.id + '.chromiumapp.org/' + (path || '')
      }
    }

    if (typeof chrome.identity.launchWebAuthFlow !== 'function') {
      chrome.identity.launchWebAuthFlow = function (details, cb) {
        if (!details || !details.url) {
          if (typeof cb === 'function') cb(undefined)
          return
        }
        window.__efcOAuthFinish = function (url) {
          if (typeof cb === 'function') cb(url)
        }
        ipcRenderer.send('extension:openOAuthPopup', details.url)
      }
    }
  } catch (_) {}
})()
