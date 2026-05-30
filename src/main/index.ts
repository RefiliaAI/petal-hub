import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { runDoctor } from './doctor'
import { createProject } from './scaffolder'
import { TerminalManager } from './terminal'
import { loadSettingsSync, saveSettings, toPublic, type Settings } from './settings'
import { validateToken, storeGitCredential } from './github'

let mainWindow: BrowserWindow | null = null
let terminals: TerminalManager | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'Petal Hub',
    backgroundColor: '#fff0f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  terminals = new TerminalManager(mainWindow.webContents)

  // electron-vite injects the dev server URL in development.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** Persist a dropped image (data URL or path) to a temp file, return its path. */
async function saveDroppedImage(payload: {
  name: string
  dataUrl?: string
  sourcePath?: string
}): Promise<string> {
  const dir = path.join(os.tmpdir(), 'petal-hub-drops')
  await fs.mkdir(dir, { recursive: true })
  const safe = payload.name.replace(/[^a-zA-Z0-9._-]/g, '_') || `drop-${Date.now()}.png`
  const dest = path.join(dir, `${Date.now()}-${safe}`)

  if (payload.dataUrl) {
    const base64 = payload.dataUrl.replace(/^data:[^;]+;base64,/, '')
    await fs.writeFile(dest, Buffer.from(base64, 'base64'))
  } else if (payload.sourcePath) {
    await fs.copyFile(payload.sourcePath, dest)
  } else {
    throw new Error('No image data provided')
  }
  return dest
}

function registerIpc(): void {
  ipcMain.handle('doctor:run', () => runDoctor())

  ipcMain.handle('image:save', (_e, payload) => saveDroppedImage(payload))

  ipcMain.handle('project:create', async (_e, input) => {
    const report = await runDoctor()
    if (!report.canScaffold) {
      throw new Error('Git identity not set — run: git config --global user.name/.email')
    }
    const s = loadSettingsSync()
    return createProject(input, {
      token: s.githubToken,
      login: s.githubUser,
      visibility: s.repoVisibility,
      projectsRoot: s.projectsRoot
    })
  })

  // --- settings ---
  ipcMain.handle('settings:get', () => toPublic())

  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    // The token has its own validated path; ignore it here.
    const { githubToken: _ignore, ...safe } = patch
    return toPublic(await saveSettings(safe))
  })

  // Validates the token, and only persists it (+ registers git credential) if good.
  ipcMain.handle('settings:save-token', async (_e, token: string) => {
    const info = await validateToken(token)
    if (!info.ok) return info
    await saveSettings({ githubToken: token, githubUser: info.login ?? '' })
    if (info.login) await storeGitCredential(info.login, token)
    return info
  })

  ipcMain.handle('settings:clear-token', async () => {
    await saveSettings({ githubToken: '', githubUser: '' })
    return toPublic()
  })

  ipcMain.handle('github:test', async () => {
    const s = loadSettingsSync()
    return validateToken(s.githubToken)
  })

  ipcMain.handle('tab:spawn', (_e, { cwd, seedPrompt }) => {
    if (!terminals) throw new Error('Terminal manager not ready')
    return terminals.spawn(cwd, seedPrompt)
  })

  ipcMain.on('tab:write', (_e, { id, data }) => terminals?.write(id, data))
  ipcMain.on('tab:resize', (_e, { id, cols, rows }) => terminals?.resize(id, cols, rows))
  ipcMain.on('tab:close', (_e, { id }) => terminals?.close(id))
  ipcMain.on('shell:open-path', (_e, p: string) => shell.openPath(p))
  ipcMain.on('shell:open-external', (_e, url: string) => shell.openExternal(url))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  terminals?.disposeAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => terminals?.disposeAll())
