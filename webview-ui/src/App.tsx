import { useState, useEffect } from 'react'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vscode = acquireVsCodeApi()

function App() {
  const [agents, setAgents] = useState<number[]>([])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'agentCreated') {
        setAgents((prev) => prev.includes(msg.id) ? prev : [...prev, msg.id as number])
      } else if (msg.type === 'agentClosed') {
        setAgents((prev) => prev.filter((id) => id !== msg.id))
      } else if (msg.type === 'existingAgents') {
        setAgents((prev) => {
          const merged = new Set([...prev, ...(msg.ids as number[])])
          return Array.from(merged).sort((a, b) => a - b)
        })
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'webviewReady' })
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 8 }}>
      <button onClick={() => vscode.postMessage({ type: 'openClaude' })}>
        Open Claude Code
      </button>
      {agents.map((id) => (
        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => vscode.postMessage({ type: 'focusAgent', id })}
            style={{ borderRadius: '3px 0 0 3px' }}
          >
            Agent #{id}
          </button>
          <button
            onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
            style={{ borderRadius: '0 3px 3px 0', padding: '4px 6px', opacity: 0.7 }}
            title="Close agent"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  )
}

export default App
