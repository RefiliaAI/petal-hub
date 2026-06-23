/**
 * TerminalManager — one node-pty per tab, each running an interactive `claude`
 * session in the project's directory. Streams output to the renderer and
 * optionally types a seed prompt once the session has booted.
 */
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'
import type { WebContents } from 'electron'
import { hasClaudeHistory } from './history'
import type { RemoteProject } from './settings'

// Lazy import so the app still launches if the native module failed to load.
// node-pty ships N-API prebuilds (ABI-stable across Node & Electron) so no
// C++ compiler is needed.
type PtyModule = typeof import('node-pty')
type IPty = import('node-pty').IPty
let pty: PtyModule | null = null
function loadPty(): PtyModule {
  if (!pty) pty = require('node-pty')
  return pty!
}

/** Resolve the real path to the claude launcher on this machine. */
function resolveClaude(): string {
  // 1) Known npm global shim location on Windows.
  const npmShim = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')
  if (existsSync(npmShim)) return npmShim
  // 2) Ask the shell where it is.
  try {
    const found = execSync('where claude', { windowsHide: true }).toString().split(/\r?\n/)
    const cmd = found.find((l) => l.toLowerCase().endsWith('.cmd')) || found[0]
    if (cmd && existsSync(cmd.trim())) return cmd.trim()
  } catch {
    /* fall through */
  }
  // 3) Last resort: let conpty resolve it from PATH.
  return 'claude.cmd'
}

/** Resolve a PowerShell executable — prefer PowerShell 7 (pwsh), else Windows PowerShell. */
function resolvePwsh(): string {
  try {
    const found = execSync('where pwsh', { windowsHide: true }).toString().split(/\r?\n/)[0]?.trim()
    if (found && existsSync(found)) return found
  } catch {
    /* pwsh not installed */
  }
  const winps = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  if (existsSync(winps)) return winps
  return 'powershell.exe'
}

interface Session {
  id: string
  proc: IPty
  seeded: boolean
}

export class TerminalManager {
  private sessions = new Map<string, Session>()
  private seq = 0
  private claudePath = resolveClaude()
  private pwshPath = resolvePwsh()
  private disposed = false

  constructor(private sender: WebContents) {}

  /**
   * Forward an event to the renderer, but only if it can still receive it.
   * Killing a pty flushes a final burst of data/exit events asynchronously;
   * by the time those land on quit, the BrowserWindow's webContents may already
   * be destroyed — calling .send() then throws "Object has been destroyed" as an
   * uncaught exception (Electron pops an error dialog). Guard every send.
   */
  private emit(channel: string, payload: unknown): void {
    if (this.disposed || this.sender.isDestroyed()) return
    try {
      this.sender.send(channel, payload)
    } catch {
      /* webContents torn down mid-send */
    }
  }

  /** Open a tab running an interactive `claude` session (optionally seeded). */
  spawn(cwd: string, seedPrompt?: string): { id: string } {
    return this.launch(this.claudePath, [], cwd, seedPrompt)
  }

  /**
   * Open a project tab, resuming the previous conversation when one exists.
   * If Claude has saved history for this directory we launch `claude --continue`
   * (which restores the real prior session); otherwise we fall back to a fresh
   * seeded session so first-time opens still get a helpful kickoff prompt.
   */
  spawnResume(cwd: string, fallbackSeed?: string): { id: string } {
    if (hasClaudeHistory(cwd)) {
      return this.launch(this.claudePath, ['--continue'], cwd)
    }
    return this.launch(this.claudePath, [], cwd, fallbackSeed)
  }

  /** Open a tab running a plain PowerShell shell. */
  spawnShell(cwd: string): { id: string } {
    const dir = cwd && existsSync(cwd) ? cwd : os.homedir()
    return this.launch(this.pwshPath, ['-NoLogo'], dir)
  }

  /**
   * Open a tab SSH'd into a remote machine, resuming Claude there.
   *
   * The native Windows `ssh` client can't take a password as a flag, so we run
   * it in a real PTY and auto-type the stored password when its prompt appears
   * (and auto-accept the host key on first connect via accept-new). Once logged
   * in we cd into the remote project path and run `claude --continue`. Timed
   * sends rather than prompt-detection, so it's shell-agnostic (cmd/PowerShell).
   *
   * The password is only ever written INTO the pty (ssh hides it; it is never
   * echoed back), so it never reaches the renderer or any log.
   */
  spawnRemote(remote: RemoteProject): { id: string } {
    const ptyLib = loadPty()
    const id = `tab-${++this.seq}`
    const args = [
      '-tt', // force a PTY even though our stdin isn't a terminal to ssh
      '-o',
      'StrictHostKeyChecking=accept-new', // trust an unknown host on first connect
      `${remote.user}@${remote.host}`
    ]
    const proc = ptyLib.spawn('ssh', args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: { ...process.env } as Record<string, string>,
      useConpty: true
    })

    const session: Session = { id, proc, seeded: false }
    this.sessions.set(id, session)

    let sentPassword = false
    let sentInit = false
    let recent = ''
    const timers: NodeJS.Timeout[] = []

    const sendInit = (): void => {
      if (sentInit || !this.sessions.has(id)) return
      sentInit = true
      // cd works in both cmd and PowerShell (same drive). Then resume Claude.
      proc.write(`cd "${remote.remotePath}"\r`)
      timers.push(
        setTimeout(() => {
          if (this.sessions.has(id)) proc.write('claude --continue\r')
        }, 700)
      )
    }

    proc.onData((data) => {
      this.emit('tab:data', { id, data })
      if (!sentPassword) {
        // Keep a small rolling window so the prompt matches across chunks.
        recent = (recent + data).slice(-200)
        if (/password:/i.test(recent)) {
          sentPassword = true
          recent = ''
          proc.write(remote.password + '\r')
          // Give the remote shell a moment to come up, then run the init.
          timers.push(setTimeout(sendInit, 1800))
        }
      }
    })

    proc.onExit(({ exitCode }) => {
      timers.forEach(clearTimeout)
      this.sessions.delete(id)
      this.emit('tab:exit', { id, exitCode })
    })

    return { id }
  }

  private launch(file: string, args: string[], cwd: string, seedPrompt?: string): { id: string } {
    const ptyLib = loadPty()
    const id = `tab-${++this.seq}`

    const proc = ptyLib.spawn(file, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env } as Record<string, string>,
      useConpty: true
    })

    const session: Session = { id, proc, seeded: false }
    this.sessions.set(id, session)

    let seedTimer: NodeJS.Timeout | null = null
    proc.onData((data) => {
      this.emit('tab:data', { id, data })
      // Seed once: wait for the REPL to settle after first output.
      if (seedPrompt && !session.seeded) {
        session.seeded = true
        seedTimer = setTimeout(() => {
          if (this.sessions.has(id)) proc.write(seedPrompt + '\r')
        }, 2500)
      }
    })

    proc.onExit(({ exitCode }) => {
      if (seedTimer) clearTimeout(seedTimer)
      this.sessions.delete(id)
      this.emit('tab:exit', { id, exitCode })
    })

    return { id }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (s && cols > 0 && rows > 0) {
      try {
        s.proc.resize(cols, rows)
      } catch {
        /* window may be mid-teardown */
      }
    }
  }

  close(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.proc.kill()
    } catch {
      /* already gone */
    }
    this.sessions.delete(id)
  }

  disposeAll(): void {
    // Stop forwarding before we start killing — pty death throws one last
    // data/exit burst we must not relay to a dying webContents.
    this.disposed = true
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}
