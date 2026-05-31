/**
 * Detect whether a project directory already has a Claude Code conversation
 * history, so "open" can resume the real previous session (`claude --continue`)
 * instead of starting a fresh one.
 *
 * Claude Code stores per-project transcripts as `*.jsonl` files under
 * `~/.claude/projects/<encoded-cwd>/`, where the cwd is encoded by replacing
 * every non-alphanumeric character with a dash (e.g. `D:\Projects\petal-hub`
 * becomes `D--Projects-petal-hub`).
 */
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import os from 'os'

/** Encode an absolute path the way Claude Code names its project history dir. */
function encodeProjectDir(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/** True if Claude has at least one saved conversation for this directory. */
export function hasClaudeHistory(dir: string): boolean {
  const histDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(dir))
  try {
    if (!existsSync(histDir)) return false
    return readdirSync(histDir).some((f) => f.endsWith('.jsonl'))
  } catch {
    return false
  }
}
