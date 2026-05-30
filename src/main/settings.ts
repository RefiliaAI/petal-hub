/**
 * Settings — persisted in the OS user-data dir (NOT in any project repo).
 * Holds the GitHub token, the chosen GitHub user, the projects root, and the
 * default repo visibility.
 */
import { app } from 'electron'
import { promises as fs, existsSync, readFileSync } from 'fs'
import path from 'path'

export interface Settings {
  githubToken: string
  githubUser: string
  projectsRoot: string
  repoVisibility: 'public' | 'private'
  /** GitHub usernames auto-invited as collaborators on every new repo. */
  collaborators: string[]
}

const DEFAULTS: Settings = {
  githubToken: '',
  githubUser: '',
  projectsRoot: 'D:\\Projects',
  repoVisibility: 'public',
  collaborators: []
}

/** A renderer-safe view of settings — the token is never sent back in full. */
export interface PublicSettings {
  hasToken: boolean
  tokenMasked: string
  githubUser: string
  projectsRoot: string
  repoVisibility: 'public' | 'private'
  collaborators: string[]
}

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadSettingsSync(): Settings {
  try {
    if (existsSync(file())) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) }
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULTS }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...loadSettingsSync(), ...patch }
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

export function toPublic(s: Settings = loadSettingsSync()): PublicSettings {
  return {
    hasToken: !!s.githubToken,
    tokenMasked: s.githubToken ? '••••••••' + s.githubToken.slice(-4) : '',
    githubUser: s.githubUser,
    projectsRoot: s.projectsRoot,
    repoVisibility: s.repoVisibility,
    collaborators: s.collaborators ?? []
  }
}
