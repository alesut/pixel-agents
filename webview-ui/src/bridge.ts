export interface HostBridge {
  postMessage: (msg: unknown) => void
  onMessage: (handler: (data: unknown) => void) => () => void
}

declare global {
  interface Window {
    pixelAgentsBridge?: {
      postMessage: (msg: unknown) => void
      onMessage: (handler: (data: unknown) => void) => () => void
    }
    acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void }
  }
}

function createVsCodeBridge(): HostBridge {
  const vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null
  return {
    postMessage: (msg) => vscode?.postMessage(msg),
    onMessage: (handler) => {
      const listener = (event: MessageEvent) => handler(event.data)
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
  }
}

function createBrowserFallbackBridge(): HostBridge {
  return {
    postMessage: (msg) => console.log('[Pixel Agents] No host bridge, dropped message:', msg),
    onMessage: (handler) => {
      const listener = (event: MessageEvent) => handler(event.data)
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
  }
}

export const bridge: HostBridge = window.pixelAgentsBridge
  ? window.pixelAgentsBridge
  : window.acquireVsCodeApi
    ? createVsCodeBridge()
    : createBrowserFallbackBridge()
