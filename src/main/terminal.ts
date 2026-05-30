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

interface Session {
  id: string
  proc: IPty
  seeded: boolean
}

export class TerminalManager {
  private sessions = new Map<string, Session>()
  private seq = 0
  private claudePath = resolveClaude()

  constructor(private sender: WebContents) {}

  spawn(cwd: string, seedPrompt?: string): { id: string } {
    const ptyLib = loadPty()
    const id = `tab-${++this.seq}`

    const proc = ptyLib.spawn(this.claudePath, [], {
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
      this.sender.send('tab:data', { id, data })
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
      this.sender.send('tab:exit', { id, exitCode })
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
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}
