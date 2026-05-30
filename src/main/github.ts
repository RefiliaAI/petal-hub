/**
 * GitHub — talks to the REST API with a personal access token, so we don't
 * need the `gh` CLI. Also registers the token with git's credential helper so
 * plain `git push` (from the user or from Claude in a tab) just works.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

const API = 'https://api.github.com'

function headers(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'petal-hub',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

export interface TokenInfo {
  ok: boolean
  login?: string
  scopes?: string[]
  /** True when the token can create repos (classic 'repo'/'public_repo'). */
  canCreateRepos?: boolean
  error?: string
}

export async function validateToken(token: string): Promise<TokenInfo> {
  if (!token.trim()) return { ok: false, error: 'No token provided.' }
  try {
    const res = await fetch(`${API}/user`, { headers: headers(token) })
    if (!res.ok) {
      return { ok: false, error: `GitHub responded ${res.status} ${res.statusText}` }
    }
    const data = (await res.json()) as { login: string }
    const scopes = (res.headers.get('x-oauth-scopes') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // Fine-grained tokens send no x-oauth-scopes header; assume capable and
    // let the actual create call be the source of truth.
    const canCreateRepos =
      scopes.length === 0 || scopes.includes('repo') || scopes.includes('public_repo')
    return { ok: true, login: data.login, scopes, canCreateRepos }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Network error reaching GitHub.' }
  }
}

export interface CreatedRepo {
  html_url: string
  clone_url: string
  owner: string
}

export async function createRepo(
  token: string,
  name: string,
  opts: { private: boolean; description: string }
): Promise<CreatedRepo> {
  const res = await fetch(`${API}/user/repos`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: opts.description.slice(0, 350),
      private: opts.private,
      auto_init: false
    })
  })
  if (res.status === 422) {
    throw new Error(`A repo named "${name}" already exists (or the name is invalid).`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub repo create failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    html_url: string
    clone_url: string
    owner: { login: string }
  }
  return { html_url: data.html_url, clone_url: data.clone_url, owner: data.owner.login }
}

/**
 * Register the token with git's credential helper for github.com so future
 * `git push`es authenticate without prompting. Best-effort; never throws.
 */
export async function storeGitCredential(login: string, token: string): Promise<void> {
  try {
    const { stdout } = await exec('git', ['config', '--global', 'credential.helper'])
    if (!stdout.trim()) {
      // Git for Windows ships Git Credential Manager under the name "manager".
      await exec('git', ['config', '--global', 'credential.helper', 'manager']).catch(() => {})
    }
  } catch {
    await exec('git', ['config', '--global', 'credential.helper', 'manager']).catch(() => {})
  }

  await new Promise<void>((resolve) => {
    const child = execFile('git', ['credential', 'approve'], () => resolve())
    child.stdin?.end(
      `protocol=https\nhost=github.com\nusername=${login}\npassword=${token}\n\n`
    )
  })
}

/**
 * Push the current branch to origin as `main`, authenticating with the token
 * via an inline header so it never lands in .git/config or the argv URL.
 */
export async function tokenPush(
  dir: string,
  login: string,
  token: string
): Promise<void> {
  const basic = Buffer.from(`${login || 'x-access-token'}:${token}`).toString('base64')
  await exec(
    'git',
    ['-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, 'push', '-u', 'origin', 'HEAD:main'],
    { cwd: dir, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
  )
}
