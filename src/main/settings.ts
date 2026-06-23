/**
 * Settings — persisted in the OS user-data dir (NOT in any project repo).
 * Holds the GitHub token, the chosen GitHub user, the projects root, and the
 * default repo visibility.
 */
import { app } from 'electron'
import { promises as fs, existsSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'

/**
 * A saved remote machine, opened with "open <name>" → a tab running
 * `ssh <user>@<host>`. The password is auto-typed at the SSH prompt (the native
 * Windows ssh client can't take it as a flag), so it's stored here in plaintext
 * — same as the GitHub token. `remotePath` is cd'd into before resuming Claude.
 */
export interface RemoteProject {
  id: string
  name: string
  host: string
  user: string
  password: string
  remotePath: string
}

export interface Settings {
  githubToken: string
  githubUser: string
  projectsRoot: string
  repoVisibility: 'public' | 'private'
  /** GitHub usernames auto-invited as collaborators on every new repo. */
  collaborators: string[]
  /** Saved SSH remotes, opened by name from the command bar. */
  remotes: RemoteProject[]
}

const DEFAULTS: Settings = {
  githubToken: '',
  githubUser: '',
  projectsRoot: 'D:\\Projects',
  repoVisibility: 'public',
  collaborators: [],
  remotes: []
}

/** A renderer-safe view of a remote — the password is never sent back. */
export interface PublicRemote {
  id: string
  name: string
  host: string
  user: string
  remotePath: string
  hasPassword: boolean
}

/** A renderer-safe view of settings — secrets are never sent back in full. */
export interface PublicSettings {
  hasToken: boolean
  tokenMasked: string
  githubUser: string
  projectsRoot: string
  repoVisibility: 'public' | 'private'
  collaborators: string[]
  remotes: PublicRemote[]
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
    collaborators: s.collaborators ?? [],
    remotes: (s.remotes ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      user: r.user,
      remotePath: r.remotePath,
      hasPassword: !!r.password
    }))
  }
}

/**
 * Save the remotes list from the renderer. The renderer never receives stored
 * passwords, so an incoming remote with an empty password means "keep the
 * existing one" (matched by id); a non-empty password replaces it. New remotes
 * (no id, or an id we don't recognise) get a fresh id.
 */
export async function saveRemotes(
  incoming: (Partial<RemoteProject> & { name: string; host: string; user: string })[]
): Promise<Settings> {
  const prev = loadSettingsSync().remotes ?? []
  const byId = new Map(prev.map((r) => [r.id, r]))
  const remotes: RemoteProject[] = incoming.map((r) => {
    const old = r.id ? byId.get(r.id) : undefined
    return {
      id: old?.id ?? r.id ?? randomUUID(),
      name: (r.name ?? '').trim(),
      host: (r.host ?? '').trim(),
      user: (r.user ?? '').trim(),
      remotePath: (r.remotePath ?? '').trim(),
      password: r.password && r.password.length ? r.password : (old?.password ?? '')
    }
  })
  return saveSettings({ remotes })
}
