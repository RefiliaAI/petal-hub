import { useEffect, useState } from 'react'
import type { PublicSettings, TokenInfo } from '../../../preload/index.d'

interface Props {
  onClose: () => void
  onChanged: () => void
}

/** A remote row being edited. `password` is blank unless the user types a new one. */
interface EditRemote {
  id?: string
  name: string
  host: string
  user: string
  remotePath: string
  password: string
  hasPassword: boolean
}

const BLANK_REMOTE: EditRemote = {
  name: '',
  host: '',
  user: '',
  remotePath: '',
  password: '',
  hasPassword: false
}

export function SettingsPanel({ onClose, onChanged }: Props): JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [token, setToken] = useState('')
  const [collabText, setCollabText] = useState('')
  const [remotes, setRemotes] = useState<EditRemote[]>([])
  const [remoteStatus, setRemoteStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)

  const refresh = (): void => {
    window.hub.getSettings().then((s) => {
      setSettings(s)
      setCollabText((s.collaborators ?? []).join(', '))
      setRemotes(
        (s.remotes ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          host: r.host,
          user: r.user,
          remotePath: r.remotePath,
          password: '',
          hasPassword: r.hasPassword
        }))
      )
    })
  }
  useEffect(refresh, [])

  const updateRemote = (i: number, patch: Partial<EditRemote>): void => {
    setRemotes((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  const saveRemotes = async (): Promise<void> => {
    const cleaned = remotes
      .map((r) => ({ ...r, name: r.name.trim(), host: r.host.trim(), user: r.user.trim() }))
      .filter((r) => r.name && r.host && r.user)
    const saved = await window.hub.saveRemotes(
      cleaned.map((r) => ({
        id: r.id,
        name: r.name,
        host: r.host,
        user: r.user,
        remotePath: r.remotePath,
        password: r.password
      }))
    )
    setSettings(saved)
    setRemotes(
      (saved.remotes ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        host: r.host,
        user: r.user,
        remotePath: r.remotePath,
        password: '',
        hasPassword: r.hasPassword
      }))
    )
    setRemoteStatus('Saved. Open with “open <name>”.')
    onChanged()
  }

  const saveCollaborators = async (text: string): Promise<void> => {
    const list = text
      .split(',')
      .map((x) => x.trim().replace(/^@/, ''))
      .filter(Boolean)
    const s = await window.hub.setSettings({ collaborators: list })
    setSettings(s)
    setCollabText((s.collaborators ?? []).join(', '))
    onChanged()
  }

  const saveToken = async (): Promise<void> => {
    if (!token.trim()) return
    setBusy(true)
    setStatus({ kind: 'info', text: 'Verifying with GitHub…' })
    try {
      const info: TokenInfo = await window.hub.saveToken(token.trim())
      if (info.ok) {
        const scopeNote =
          info.scopes && info.scopes.length
            ? ` Scopes: ${info.scopes.join(', ')}.`
            : ' (fine-grained token)'
        const repoNote = info.canCreateRepos
          ? ' Can create repos. 🎉'
          : ' ⚠️ This token may not have repo-creation rights — add the “repo” scope.'
        setStatus({ kind: info.canCreateRepos ? 'ok' : 'err', text: `Connected as @${info.login}.${scopeNote}${repoNote}` })
        setToken('')
        refresh()
        onChanged()
      } else {
        setStatus({ kind: 'err', text: info.error ?? 'Token was rejected by GitHub.' })
      }
    } catch (err: any) {
      setStatus({ kind: 'err', text: err?.message ?? 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  const clearToken = async (): Promise<void> => {
    await window.hub.clearToken()
    setStatus({ kind: 'info', text: 'Token removed.' })
    refresh()
    onChanged()
  }

  const setVisibility = async (v: 'public' | 'private'): Promise<void> => {
    const s = await window.hub.setSettings({ repoVisibility: v })
    setSettings(s)
    onChanged()
  }

  const setProjectsRoot = async (root: string): Promise<void> => {
    const s = await window.hub.setSettings({ projectsRoot: root })
    setSettings(s)
    onChanged()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>🔑 Settings</span>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-section">
          <div className="field-label">GITHUB TOKEN</div>
          {settings?.hasToken ? (
            <div className="token-status">
              <span className="pill ok">SET</span>
              <span>
                {settings.tokenMasked}
                {settings.githubUser ? ` · @${settings.githubUser}` : ''}
              </span>
              <button className="btn ghost small" onClick={clearToken}>
                Remove
              </button>
            </div>
          ) : (
            <p className="hint" style={{ marginBottom: 8 }}>
              No token yet. Paste a <strong>classic PAT with the “repo” scope</strong> below — it's
              stored locally on your machine and used to create repos &amp; push.
            </p>
          )}

          <div className="token-row">
            <input
              type="password"
              className="name-input"
              placeholder={settings?.hasToken ? 'Paste a new token to replace…' : 'ghp_…'}
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveToken()
              }}
            />
            <button className="btn" disabled={busy || !token.trim()} onClick={saveToken}>
              {busy ? 'Checking…' : 'Save & verify'}
            </button>
          </div>

          {status && (
            <p
              className="settings-status"
              style={{
                color:
                  status.kind === 'ok'
                    ? '#3aa76d'
                    : status.kind === 'err'
                      ? 'var(--rose-deep)'
                      : 'var(--text-soft)'
              }}
            >
              {status.text}
            </p>
          )}
          <p className="hint">
            Create one at{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                window.hub.openExternal('https://github.com/settings/tokens/new?scopes=repo&description=Petal%20Hub')
              }}
            >
              github.com/settings/tokens
            </a>{' '}
            → “Generate new token (classic)” → tick <strong>repo</strong>.
          </p>
        </div>

        <div className="settings-section">
          <div className="field-label">NEW REPO VISIBILITY</div>
          <div className="seg">
            <button
              className={settings?.repoVisibility === 'public' ? 'on' : ''}
              onClick={() => setVisibility('public')}
            >
              🌍 Public
            </button>
            <button
              className={settings?.repoVisibility === 'private' ? 'on' : ''}
              onClick={() => setVisibility('private')}
            >
              🔒 Private
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="field-label">PROJECTS FOLDER</div>
          <input
            className="name-input"
            value={settings?.projectsRoot ?? ''}
            spellCheck={false}
            onChange={(e) => setSettings((s) => (s ? { ...s, projectsRoot: e.target.value } : s))}
            onBlur={(e) => setProjectsRoot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <p className="hint">New projects are created here, each as its own git repo.</p>
        </div>

        <div className="settings-section">
          <div className="field-label">AUTO-INVITE COLLABORATORS</div>
          <input
            className="name-input"
            placeholder="github-username, another-user"
            value={collabText}
            spellCheck={false}
            onChange={(e) => setCollabText(e.target.value)}
            onBlur={(e) => saveCollaborators(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <p className="hint">
            Comma-separated GitHub usernames invited (write access) to every new repo the hub
            creates. Stored only on this machine.
          </p>
        </div>

        <div className="settings-section">
          <div className="field-label">REMOTE PROJECTS (SSH)</div>
          <p className="hint" style={{ marginBottom: 10 }}>
            Each remote is opened with <strong>open &lt;name&gt;</strong> — it SSHes in, cd's to the
            path, and resumes Claude there. The password is stored on this machine and auto-typed at
            the SSH prompt.
          </p>

          {remotes.map((r, i) => (
            <div className="remote-card" key={r.id ?? `new-${i}`}>
              <div className="remote-grid">
                <input
                  className="name-input"
                  placeholder="Name (e.g. RefiliaAI)"
                  value={r.name}
                  spellCheck={false}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className="name-input"
                  placeholder="user (e.g. Refilia)"
                  value={r.user}
                  spellCheck={false}
                  onChange={(e) => updateRemote(i, { user: e.target.value })}
                />
                <input
                  className="name-input"
                  placeholder="host (e.g. 192.168.178.200)"
                  value={r.host}
                  spellCheck={false}
                  onChange={(e) => updateRemote(i, { host: e.target.value })}
                />
                <input
                  type="password"
                  className="name-input"
                  placeholder={r.hasPassword ? '•••• (leave blank to keep)' : 'password'}
                  value={r.password}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => updateRemote(i, { password: e.target.value })}
                />
                <input
                  className="name-input remote-path"
                  placeholder="remote path (e.g. C:\\Users\\Refilia\\Projects)"
                  value={r.remotePath}
                  spellCheck={false}
                  onChange={(e) => updateRemote(i, { remotePath: e.target.value })}
                />
              </div>
              <button
                className="btn ghost small"
                onClick={() => setRemotes((list) => list.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}

          <div className="command-row" style={{ marginTop: 10 }}>
            <button
              className="btn ghost small"
              onClick={() => setRemotes((list) => [...list, { ...BLANK_REMOTE }])}
            >
              + Add remote
            </button>
            <button className="btn" onClick={saveRemotes}>
              Save remotes 🌐
            </button>
          </div>
          {remoteStatus && (
            <p className="settings-status" style={{ color: 'var(--text-soft)' }}>
              {remoteStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
