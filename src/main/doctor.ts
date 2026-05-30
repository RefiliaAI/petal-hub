/**
 * Doctor — checks the environment so the hub can show friendly fix-it banners
 * instead of failing silently. Never throws; always resolves to a report.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { loadSettingsSync } from './settings'

const exec = promisify(execFile)

export interface Check {
  id: string
  label: string
  ok: boolean
  detail: string
  /** Copy-paste command the user can run to fix it. */
  fix?: string
}

export interface DoctorReport {
  checks: Check[]
  /** True when projects can be scaffolded locally (git identity present). */
  canScaffold: boolean
  /** True when a public GitHub repo can be auto-created. */
  canGitHub: boolean
  /** True when terminals can be embedded (node-pty loads). */
  canEmbedTerminal: boolean
}

async function tryExec(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { windowsHide: true, shell: false })
    return { ok: true, out: (stdout || stderr || '').trim() }
  } catch (err: any) {
    return { ok: false, out: (err?.stdout || err?.stderr || err?.message || '').toString().trim() }
  }
}

async function checkGitIdentity(): Promise<Check> {
  const name = await tryExec('git', ['config', '--global', 'user.name'])
  const email = await tryExec('git', ['config', '--global', 'user.email'])
  const ok = name.ok && !!name.out && email.ok && !!email.out
  return {
    id: 'git-identity',
    label: 'Git identity',
    ok,
    detail: ok ? `${name.out} <${email.out}>` : 'Not set — commits will fail.',
    fix: ok
      ? undefined
      : 'git config --global user.name "Your Name"; git config --global user.email "deanjoy.lol@gmail.com"'
  }
}

function checkGitHubToken(): Check {
  const s = loadSettingsSync()
  if (!s.githubToken) {
    return {
      id: 'github-token',
      label: 'GitHub token',
      ok: false,
      detail: 'No token set — projects stay local until you add one.',
      fix: 'Open ⚙ Settings and paste a classic PAT (repo scope)'
    }
  }
  return {
    id: 'github-token',
    label: 'GitHub token',
    ok: true,
    detail: s.githubUser ? `Token set for @${s.githubUser} — repos will auto-create.` : 'Token set.'
  }
}

function checkNodePty(): Check {
  try {
    // Loaded lazily so a load failure here degrades gracefully.
    require('node-pty')
    return { id: 'node-pty', label: 'Embedded terminals', ok: true, detail: 'node-pty ready.' }
  } catch (err: any) {
    return {
      id: 'node-pty',
      label: 'Embedded terminals',
      ok: false,
      detail: 'node-pty failed to load — rebuild needed.',
      fix: 'npm run rebuild'
    }
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const gitIdentity = await checkGitIdentity()
  const github = checkGitHubToken()
  const nodePty = checkNodePty()
  const checks = [gitIdentity, github, nodePty]
  return {
    checks,
    canScaffold: gitIdentity.ok,
    canGitHub: github.ok,
    canEmbedTerminal: nodePty.ok
  }
}
