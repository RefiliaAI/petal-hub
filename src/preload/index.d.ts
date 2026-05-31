import type { HubApi } from './index'

export interface DoctorCheck {
  id: string
  label: string
  ok: boolean
  detail: string
  fix?: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  canScaffold: boolean
  canGitHub: boolean
  canEmbedTerminal: boolean
}

export interface CreateProjectResult {
  projectDir: string
  slug: string
  repoUrl: string | null
  steps: string[]
  seedPrompt: string
}

export interface PublicSettings {
  hasToken: boolean
  tokenMasked: string
  githubUser: string
  projectsRoot: string
  repoVisibility: 'public' | 'private'
  collaborators: string[]
}

export interface ProjectMatch {
  name: string
  dir: string
  score: number
}

export interface UpdateInfo {
  current: string
  latest: string | null
  hasUpdate: boolean
  downloadUrl: string | null
  releaseUrl: string | null
  error?: string
}

export interface TokenInfo {
  ok: boolean
  login?: string
  scopes?: string[]
  canCreateRepos?: boolean
  error?: string
}

declare global {
  interface Window {
    hub: HubApi
  }
}
