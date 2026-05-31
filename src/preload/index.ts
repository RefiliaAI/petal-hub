import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only surface the renderer can touch. Keeps Node out of the UI while
 * exposing a small, typed API for the hub's features.
 */
const api = {
  // --- environment ---
  runDoctor: () => ipcRenderer.invoke('doctor:run'),

  // --- projects ---
  createProject: (input: { slug: string; description: string; images?: string[] }) =>
    ipcRenderer.invoke('project:create', input),
  findProject: (query: string) => ipcRenderer.invoke('project:find', query),

  // --- settings & github ---
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: {
    projectsRoot?: string
    repoVisibility?: 'public' | 'private'
    collaborators?: string[]
  }) => ipcRenderer.invoke('settings:set', patch),
  saveToken: (token: string) => ipcRenderer.invoke('settings:save-token', token),
  clearToken: () => ipcRenderer.invoke('settings:clear-token'),
  testGitHub: () => ipcRenderer.invoke('github:test'),

  // --- screenshots ---
  saveImage: (payload: { name: string; dataUrl?: string; sourcePath?: string }) =>
    ipcRenderer.invoke('image:save', payload),

  // --- terminal tabs ---
  spawnTab: (cwd: string, seedPrompt?: string) =>
    ipcRenderer.invoke('tab:spawn', { cwd, seedPrompt }),
  // Resume a project's previous conversation (`claude --continue`) when one
  // exists; otherwise start a fresh session seeded with fallbackSeed.
  resumeTab: (cwd: string, fallbackSeed?: string) =>
    ipcRenderer.invoke('tab:resume', { cwd, fallbackSeed }),
  spawnTerminal: (cwd: string) => ipcRenderer.invoke('terminal:spawn', { cwd }),
  writeTab: (id: string, data: string) => ipcRenderer.send('tab:write', { id, data }),
  resizeTab: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('tab:resize', { id, cols, rows }),
  closeTab: (id: string) => ipcRenderer.send('tab:close', { id }),

  onTabData: (cb: (p: { id: string; data: string }) => void) => {
    const handler = (_e: unknown, p: { id: string; data: string }) => cb(p)
    ipcRenderer.on('tab:data', handler)
    return () => ipcRenderer.removeListener('tab:data', handler)
  },
  onTabExit: (cb: (p: { id: string; exitCode: number }) => void) => {
    const handler = (_e: unknown, p: { id: string; exitCode: number }) => cb(p)
    ipcRenderer.on('tab:exit', handler)
    return () => ipcRenderer.removeListener('tab:exit', handler)
  },

  // --- shell helpers ---
  openPath: (p: string) => ipcRenderer.send('shell:open-path', p),
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),

  // --- clipboard (copy; paste uses the browser's native paste event) ---
  writeClipboard: (text: string) => ipcRenderer.send('clipboard:write', text),

  // --- updates (manual check + install) ---
  checkUpdate: () => ipcRenderer.invoke('updates:check'),
  installUpdate: (url: string) => ipcRenderer.invoke('updates:install', url)
}

contextBridge.exposeInMainWorld('hub', api)

export type HubApi = typeof api
