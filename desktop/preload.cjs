const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pixelAgentsBridge', {
  postMessage: (message) => ipcRenderer.send('pixel-agents:message', message),
  onMessage: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('pixel-agents:host-message', listener)
    return () => ipcRenderer.removeListener('pixel-agents:host-message', listener)
  },
})
