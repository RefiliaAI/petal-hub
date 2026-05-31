/**
 * Manual update check + install for Petal Hub.
 *
 * Not "auto": the renderer shows the current version in a footer and, only when
 * the user is looking, asks GitHub whether a newer release exists. If they click
 * Update we download that release's NSIS installer and launch it, then quit so it
 * can replace the running files.
 *
 * The repo is public, so the releases API works unauthenticated; we pass the
 * stored PAT when present purely to dodge the 60/hr anonymous rate limit.
 */
import { app, shell } from 'electron'
import { createWriteStream } from 'fs'
import path from 'path'
import https from 'https'
import { loadSettingsSync } from './settings'

const OWNER = 'RefiliaAI'
const REPO = 'petal-hub'

export interface UpdateInfo {
  current: string
  latest: string | null
  hasUpdate: boolean
  downloadUrl: string | null
  releaseUrl: string | null
  error?: string
}

/** Compare dotted versions; true when `latest` is strictly newer than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/** GET a URL as JSON, following redirects, with the GitHub API headers. */
function getJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = {
    'User-Agent': 'petal-hub-updater',
    Accept: 'application/vnd.github+json'
  }
  try {
    const token = loadSettingsSync().githubToken
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    /* no token is fine for a public repo */
  }
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          getJson(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`GitHub API ${res.statusCode}`))
          return
        }
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(e as Error)
          }
        })
      })
      .on('error', reject)
  })
}

/** Ask GitHub for the latest release and decide whether it's newer than us. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const rel = (await getJson(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
    )) as {
      tag_name?: string
      html_url?: string
      assets?: { name: string; browser_download_url: string }[]
    }
    const latest = (rel.tag_name || '').replace(/^v/, '')
    const exe = (rel.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe'))
    const hasUpdate = !!latest && isNewer(latest, current)
    return {
      current,
      latest: latest || null,
      hasUpdate,
      downloadUrl: exe?.browser_download_url ?? null,
      releaseUrl: rel.html_url ?? null
    }
  } catch (e) {
    return {
      current,
      latest: null,
      hasUpdate: false,
      downloadUrl: null,
      releaseUrl: null,
      error: (e as Error).message
    }
  }
}

/** Download a binary URL (following redirects) to `dest`. */
function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'petal-hub-updater' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          download(res.headers.location, dest).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }
        const file = createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

/**
 * Download the given installer and launch it, then quit so it can replace the
 * running app. Returns once the installer has been handed off to the OS.
 */
export async function downloadAndInstall(url: string): Promise<void> {
  const dest = path.join(app.getPath('temp'), `petal-hub-update-${Date.now()}.exe`)
  await download(url, dest)
  // Launch the NSIS installer, then quit so its files aren't locked.
  await shell.openPath(dest)
  setTimeout(() => app.quit(), 800)
}
