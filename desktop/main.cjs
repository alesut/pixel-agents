const fs = require('fs')
const os = require('os')
const path = require('path')
const { PNG } = require('pngjs')
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')

const isDev = process.env.PIXEL_AGENTS_DESKTOP_DEV === '1'

const LAYOUT_FILE = 'layout.json'
const SETTINGS_FILE = 'settings.json'

const PNG_ALPHA_THRESHOLD = 128
const WALL_PIECE_WIDTH = 16
const WALL_PIECE_HEIGHT = 32
const WALL_GRID_COLS = 4
const WALL_BITMASK_COUNT = 16
const FLOOR_PATTERN_COUNT = 7
const FLOOR_TILE_SIZE = 16
const CHAR_FRAME_W = 16
const CHAR_FRAME_H = 32
const CHAR_FRAMES_PER_ROW = 7
const CHAR_COUNT = 6
const CHAR_DIRECTIONS = ['down', 'up', 'right']

const PROJECT_CWD = path.resolve(process.cwd())
const CODEX_SCAN_INTERVAL_MS = 1500

/** @type {Map<string, SessionState>} */
const codexSessions = new Map()
const sessionCwdCache = new Map()
let codexPollTimer = null
let nextAgentId = 1

/**
 * @typedef {{
 *   filePath: string
 *   agentId: number
 *   offset: number
 *   partial: string
 *   activeTools: Map<string, { name: string, status: string }>
 *   status: 'active' | 'waiting'
 * }} SessionState
 */

function isRecord(value) {
  return value !== null && typeof value === 'object'
}

function isLayout(value) {
  return isRecord(value) && value.version === 1 && Array.isArray(value.tiles)
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.warn('[desktop] failed to read json', filePath, error)
    return null
  }
}

function writeJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  } catch (error) {
    console.warn('[desktop] failed to write json', filePath, error)
  }
}

function getLayoutPath() {
  return path.join(app.getPath('userData'), LAYOUT_FILE)
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function getCodexSessionsRoot() {
  return path.join(os.homedir(), '.codex', 'sessions')
}

function normalizePath(inputPath) {
  try {
    return path.resolve(inputPath)
  } catch {
    return inputPath
  }
}

function isSameProjectPath(a, b) {
  const left = normalizePath(a)
  const right = normalizePath(b)
  if (left === right) return true
  return left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`)
}

function sendHostMessage(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('pixel-agents:host-message', payload)
}

function broadcastHostMessage(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    sendHostMessage(win.webContents, payload)
  }
}

function toHex(r, g, b) {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

function readPng(pngPath) {
  if (!fs.existsSync(pngPath)) return null
  try {
    return PNG.sync.read(fs.readFileSync(pngPath))
  } catch (error) {
    console.warn('[desktop] failed to parse png', pngPath, error)
    return null
  }
}

function slicePngSprite(png, offsetX, offsetY, width, height) {
  const sprite = []
  for (let y = 0; y < height; y++) {
    const row = []
    for (let x = 0; x < width; x++) {
      const px = offsetX + x
      const py = offsetY + y
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
        row.push('')
        continue
      }
      const idx = (py * png.width + px) * 4
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]
      const a = png.data[idx + 3]
      row.push(a < PNG_ALPHA_THRESHOLD ? '' : toHex(r, g, b))
    }
    sprite.push(row)
  }
  return sprite
}

function resolveDesktopAssetRoot() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'desktop-ui'),
    path.join(__dirname, '..', 'dist'),
    path.join(__dirname, '..', 'webview-ui', 'public'),
  ]
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'assets'))) return root
  }
  return null
}

function loadDesktopAssets() {
  const assetRoot = resolveDesktopAssetRoot()
  if (!assetRoot) return null

  const assetsDir = path.join(assetRoot, 'assets')
  const result = {
    defaultLayout: null,
    floorSprites: null,
    wallSprites: null,
    characterSprites: null,
    furniture: null,
  }

  const defaultLayout = readJson(path.join(assetsDir, 'default-layout.json'))
  if (isLayout(defaultLayout)) {
    result.defaultLayout = defaultLayout
  }

  const floorPng = readPng(path.join(assetsDir, 'floors.png'))
  if (floorPng) {
    const sprites = []
    for (let i = 0; i < FLOOR_PATTERN_COUNT; i++) {
      sprites.push(slicePngSprite(floorPng, i * FLOOR_TILE_SIZE, 0, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE))
    }
    result.floorSprites = sprites
  }

  const wallPng = readPng(path.join(assetsDir, 'walls.png'))
  if (wallPng) {
    const sprites = []
    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT
      sprites.push(slicePngSprite(wallPng, ox, oy, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT))
    }
    result.wallSprites = sprites
  }

  const characterDir = path.join(assetsDir, 'characters')
  if (fs.existsSync(characterDir)) {
    const characters = []
    for (let ci = 0; ci < CHAR_COUNT; ci++) {
      const png = readPng(path.join(characterDir, `char_${ci}.png`))
      if (!png) {
        characters.length = 0
        break
      }
      const charData = { down: [], up: [], right: [] }
      for (let dirIndex = 0; dirIndex < CHAR_DIRECTIONS.length; dirIndex++) {
        const direction = CHAR_DIRECTIONS[dirIndex]
        const rowOffsetY = dirIndex * CHAR_FRAME_H
        const frames = []
        for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
          const frameOffsetX = frame * CHAR_FRAME_W
          frames.push(slicePngSprite(png, frameOffsetX, rowOffsetY, CHAR_FRAME_W, CHAR_FRAME_H))
        }
        charData[direction] = frames
      }
      characters.push(charData)
    }
    if (characters.length === CHAR_COUNT) {
      result.characterSprites = characters
    }
  }

  const catalogPath = path.join(assetsDir, 'furniture', 'furniture-catalog.json')
  const catalogRaw = readJson(catalogPath)
  if (isRecord(catalogRaw)) {
    const catalog = Array.isArray(catalogRaw.assets) ? catalogRaw.assets : []
    const sprites = {}
    for (const asset of catalog) {
      if (!isRecord(asset) || typeof asset.id !== 'string') continue
      const width = typeof asset.width === 'number' ? asset.width : 0
      const height = typeof asset.height === 'number' ? asset.height : 0
      if (width <= 0 || height <= 0 || typeof asset.file !== 'string') continue

      let filePath
      if (path.isAbsolute(asset.file)) {
        filePath = asset.file
      } else if (asset.file.startsWith('assets/')) {
        filePath = path.join(assetRoot, asset.file)
      } else {
        filePath = path.join(assetsDir, asset.file)
      }

      const png = readPng(filePath)
      if (!png) continue
      sprites[asset.id] = slicePngSprite(png, 0, 0, width, height)
    }

    if (Object.keys(sprites).length > 0) {
      result.furniture = { catalog, sprites }
    }
  }

  return result
}

function shortStatus(value, maxLen = 56) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed
}

function formatCodexToolStatus(name, argumentsJson) {
  let parsed = null
  if (typeof argumentsJson === 'string') {
    try {
      parsed = JSON.parse(argumentsJson)
    } catch {
      parsed = null
    }
  }

  if (name === 'exec_command') {
    const cmd = shortStatus(parsed?.cmd)
    return cmd ? `Running: ${cmd}` : 'Running command'
  }
  if (name === 'write_stdin') {
    return 'Reading command output'
  }
  if (name === 'apply_patch') {
    return 'Editing files'
  }
  if (name === 'search_query' || name === 'image_query') {
    return 'Searching the web'
  }
  if (name === 'open' || name === 'click' || name === 'find') {
    return 'Reading web content'
  }
  if (name === 'mcp__playwright__browser_navigate' || name === 'mcp__playwright__browser_run_code') {
    return 'Working in browser'
  }
  if (name.startsWith('mcp__')) {
    return `Using ${name.replace(/^mcp__/, '')}`
  }
  return `Using ${name}`
}

function parseSessionLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function setSessionStatus(session, status, emit) {
  if (session.status === status) return
  session.status = status
  if (emit) {
    broadcastHostMessage({ type: 'agentStatus', id: session.agentId, status })
  }
}

function processCodexRecord(session, record, emit) {
  if (!isRecord(record)) return
  const payload = isRecord(record.payload) ? record.payload : null

  if (record.type === 'response_item' && payload && payload.type === 'function_call') {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : null
    const toolName = typeof payload.name === 'string' ? payload.name : 'Tool'
    if (!callId) return

    if (!session.activeTools.has(callId)) {
      const status = formatCodexToolStatus(toolName, payload.arguments)
      session.activeTools.set(callId, { name: toolName, status })
      if (emit) {
        broadcastHostMessage({
          type: 'agentToolStart',
          id: session.agentId,
          toolId: callId,
          status,
        })
      }
    }
    setSessionStatus(session, 'active', emit)
    return
  }

  if (record.type === 'response_item' && payload && payload.type === 'function_call_output') {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : null
    if (!callId) return
    if (session.activeTools.delete(callId) && emit) {
      broadcastHostMessage({
        type: 'agentToolDone',
        id: session.agentId,
        toolId: callId,
      })
    }
    if (session.activeTools.size === 0) {
      setSessionStatus(session, 'waiting', emit)
    }
    return
  }

  if (record.type === 'event_msg' && payload) {
    if (payload.type === 'task_started') {
      setSessionStatus(session, 'active', emit)
      return
    }
    if (payload.type === 'task_complete') {
      if (session.activeTools.size > 0) {
        session.activeTools.clear()
        if (emit) {
          broadcastHostMessage({ type: 'agentToolsClear', id: session.agentId })
        }
      }
      setSessionStatus(session, 'waiting', emit)
    }
  }
}

function hydrateSessionState(session) {
  if (!fs.existsSync(session.filePath)) return
  const content = fs.readFileSync(session.filePath, 'utf8')
  const lines = content.split('\n')
  for (const line of lines) {
    if (!line) continue
    const record = parseSessionLine(line)
    if (!record) continue
    processCodexRecord(session, record, false)
  }
  session.offset = Buffer.byteLength(content, 'utf8')
  session.partial = ''
}

function readSessionCwd(filePath) {
  if (sessionCwdCache.has(filePath)) {
    return sessionCwdCache.get(filePath)
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    for (const line of lines) {
      if (!line) continue
      const record = parseSessionLine(line)
      if (record?.type !== 'turn_context') continue
      const cwd = record?.payload?.cwd
      if (typeof cwd === 'string' && cwd) {
        const normalized = normalizePath(cwd)
        sessionCwdCache.set(filePath, normalized)
        return normalized
      }
    }
  } catch (error) {
    console.warn('[desktop] failed to inspect codex session cwd', filePath, error)
  }
  sessionCwdCache.set(filePath, null)
  return null
}

function getDatePathParts(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const y = String(d.getFullYear())
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return [y, m, day]
}

function listRecentCodexSessionFiles() {
  const root = getCodexSessionsRoot()
  const files = []
  for (let i = 0; i <= 1; i++) {
    const [y, m, d] = getDatePathParts(i)
    const dir = path.join(root, y, m, d)
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(dir, entry.name))
      }
    }
  }
  files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
  return files
}

function getProjectCodexSessionFiles() {
  const candidates = listRecentCodexSessionFiles()
  const matches = []
  for (const filePath of candidates) {
    const sessionCwd = readSessionCwd(filePath)
    if (!sessionCwd) continue
    if (!isSameProjectPath(sessionCwd, PROJECT_CWD)) continue
    matches.push(filePath)
  }
  return matches.slice(-8)
}

function registerSession(filePath, emitCreation) {
  if (codexSessions.has(filePath)) return codexSessions.get(filePath)
  const session = {
    filePath,
    agentId: nextAgentId++,
    offset: 0,
    partial: '',
    activeTools: new Map(),
    status: 'waiting',
  }
  hydrateSessionState(session)
  codexSessions.set(filePath, session)
  if (emitCreation) {
    broadcastHostMessage({ type: 'agentCreated', id: session.agentId })
    if (session.status === 'active') {
      broadcastHostMessage({ type: 'agentStatus', id: session.agentId, status: 'active' })
    }
    for (const [toolId, tool] of session.activeTools) {
      broadcastHostMessage({
        type: 'agentToolStart',
        id: session.agentId,
        toolId,
        status: tool.status,
      })
    }
  }
  return session
}

function syncCodexSessions(emitCreation) {
  const files = getProjectCodexSessionFiles()
  for (const filePath of files) {
    registerSession(filePath, emitCreation)
  }
  return files.map((filePath) => codexSessions.get(filePath)).filter(Boolean)
}

function pollSessionFile(session) {
  if (!fs.existsSync(session.filePath)) return
  let stat
  try {
    stat = fs.statSync(session.filePath)
  } catch {
    return
  }

  if (stat.size < session.offset) {
    session.offset = 0
    session.partial = ''
    session.activeTools.clear()
    session.status = 'waiting'
  }
  if (stat.size === session.offset) return

  const fd = fs.openSync(session.filePath, 'r')
  try {
    const chunkSize = stat.size - session.offset
    const chunk = Buffer.alloc(chunkSize)
    fs.readSync(fd, chunk, 0, chunkSize, session.offset)
    session.offset = stat.size

    const text = session.partial + chunk.toString('utf8')
    const lines = text.split('\n')
    session.partial = lines.pop() || ''

    for (const line of lines) {
      if (!line) continue
      const record = parseSessionLine(line)
      if (!record) continue
      processCodexRecord(session, record, true)
    }
  } finally {
    fs.closeSync(fd)
  }
}

function ensureCodexPollerStarted() {
  if (codexPollTimer) return
  codexPollTimer = setInterval(() => {
    syncCodexSessions(true)
    for (const session of codexSessions.values()) {
      pollSessionFile(session)
    }
  }, CODEX_SCAN_INTERVAL_MS)
}

function stopCodexPoller() {
  if (!codexPollTimer) return
  clearInterval(codexPollTimer)
  codexPollTimer = null
}

function sendSessionSnapshot(webContents, session) {
  if (session.status === 'active') {
    sendHostMessage(webContents, { type: 'agentStatus', id: session.agentId, status: 'active' })
  }
  for (const [toolId, tool] of session.activeTools) {
    sendHostMessage(webContents, {
      type: 'agentToolStart',
      id: session.agentId,
      toolId,
      status: tool.status,
    })
  }
}

function bootstrapRenderer(webContents) {
  const settingsRaw = readJson(getSettingsPath())
  const soundEnabled = isRecord(settingsRaw) && typeof settingsRaw.soundEnabled === 'boolean'
    ? settingsRaw.soundEnabled
    : true

  ensureCodexPollerStarted()
  const sessions = syncCodexSessions(false)
  const existingAgentIds = sessions.map((s) => s.agentId)

  const loadedAssets = loadDesktopAssets()
  const hasFurnitureCatalog = !!loadedAssets?.furniture

  const savedLayoutRaw = readJson(getLayoutPath())
  const savedLayout = isLayout(savedLayoutRaw) ? savedLayoutRaw : null
  const defaultLayout = loadedAssets?.defaultLayout && hasFurnitureCatalog ? loadedAssets.defaultLayout : null
  const layout = savedLayout || defaultLayout || null

  sendHostMessage(webContents, { type: 'settingsLoaded', soundEnabled })

  if (loadedAssets?.characterSprites) {
    sendHostMessage(webContents, {
      type: 'characterSpritesLoaded',
      characters: loadedAssets.characterSprites,
    })
  }
  if (loadedAssets?.floorSprites) {
    sendHostMessage(webContents, {
      type: 'floorTilesLoaded',
      sprites: loadedAssets.floorSprites,
    })
  }
  if (loadedAssets?.wallSprites) {
    sendHostMessage(webContents, {
      type: 'wallTilesLoaded',
      sprites: loadedAssets.wallSprites,
    })
  }
  if (loadedAssets?.furniture) {
    sendHostMessage(webContents, {
      type: 'furnitureAssetsLoaded',
      catalog: loadedAssets.furniture.catalog,
      sprites: loadedAssets.furniture.sprites,
    })
  }

  sendHostMessage(webContents, {
    type: 'existingAgents',
    agents: existingAgentIds,
    agentMeta: {},
  })
  sendHostMessage(webContents, { type: 'layoutLoaded', layout })

  for (const session of sessions) {
    sendSessionSnapshot(webContents, session)
  }
}

function exportLayoutFromDesktop(win) {
  const layout = readJson(getLayoutPath())
  if (!isLayout(layout)) return
  const filePath = dialog.showSaveDialogSync(win, {
    title: 'Export Pixel Agents Layout',
    defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  })
  if (!filePath) return
  writeJson(filePath, layout)
}

function importLayoutToDesktop(win, sender) {
  const filePaths = dialog.showOpenDialogSync(win, {
    title: 'Import Pixel Agents Layout',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (!filePaths || filePaths.length === 0) return
  const imported = readJson(filePaths[0])
  if (!isLayout(imported)) return
  writeJson(getLayoutPath(), imported)
  sendHostMessage(sender, { type: 'layoutLoaded', layout: imported })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Pixel Agents',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    win.loadURL('http://127.0.0.1:4173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'desktop-ui', 'index.html'))
  }
}

function handleRendererMessage(event, message) {
  if (isDev) {
    console.log('[desktop] renderer message', message)
  }
  if (!isRecord(message) || typeof message.type !== 'string') return

  if (message.type === 'webviewReady') {
    bootstrapRenderer(event.sender)
    return
  }

  if (message.type === 'saveLayout') {
    if (isLayout(message.layout)) {
      writeJson(getLayoutPath(), message.layout)
    }
    return
  }

  if (message.type === 'setSoundEnabled') {
    const soundEnabled = typeof message.enabled === 'boolean' ? message.enabled : true
    writeJson(getSettingsPath(), { soundEnabled })
    return
  }

  if (message.type === 'openClaude') {
    // Standalone mode tracks Codex sessions that are already running in this cwd.
    syncCodexSessions(true)
    return
  }

  if (message.type === 'openSessionsFolder') {
    shell.openPath(getCodexSessionsRoot())
    return
  }

  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return

  if (message.type === 'exportLayout') {
    exportLayoutFromDesktop(win)
    return
  }

  if (message.type === 'importLayout') {
    importLayoutToDesktop(win, event.sender)
  }
}

app.whenReady().then(() => {
  ipcMain.on('pixel-agents:message', handleRendererMessage)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  stopCodexPoller()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
