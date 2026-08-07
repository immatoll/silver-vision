'use strict'
// Preload for the hidden keeper BrowserWindow.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__efcKeeperIpc', {
  openWindow:      (url) => ipcRenderer.send('extension:requestOpenWindow', url),
  openOAuthPopup:  (url) => ipcRenderer.send('extension:openOAuthPopup', url),
  relayTabMessage: (message) => ipcRenderer.send('extension:relayTabMessage', message)
})
