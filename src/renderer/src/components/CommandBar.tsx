import { useRef, useState } from 'react'
import { parseIntent, slugify } from '../lib/intent'
import { fileToImagePayload } from '../lib/images'
import type { CreateProjectResult, ProjectMatch, PublicRemote } from '../../../preload/index.d'

interface Attachment {
  name: string
  path: string
  thumb: string
}

type Phase = 'compose' | 'confirm' | 'creating' | 'done' | 'error' | 'open-confirm' | 'open-none'

interface Props {
  canScaffold: boolean
  projectsRoot: string
  remotes: PublicRemote[]
  onProjectCreated: (result: CreateProjectResult) => void
  onOpenProject: (dir: string, title: string) => void
  onOpenRemote: (remote: PublicRemote) => void
  onOpenTerminal: () => void
}

export function CommandBar({
  canScaffold,
  projectsRoot,
  remotes,
  onProjectCreated,
  onOpenProject,
  onOpenRemote,
  onOpenTerminal
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [phase, setPhase] = useState<Phase>('compose')
  const [dragover, setDragover] = useState(false)
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState('')
  // open flow
  const [openQuery, setOpenQuery] = useState('')
  const [matches, setMatches] = useState<ProjectMatch[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Live intent so the action button reads "Open" vs "Create".
  const liveKind = parseIntent(text).kind

  const addImages = async (files: File[]): Promise<void> => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    for (const f of imgs) {
      try {
        const payload = await fileToImagePayload(f)
        const path = await window.hub.saveImage(payload)
        setAttachments((a) => [...a, { name: f.name, path, thumb: payload.dataUrl }])
      } catch {
        /* ignore */
      }
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragover(false)
    await addImages(Array.from(e.dataTransfer.files))
  }

  const onPaste = async (e: React.ClipboardEvent): Promise<void> => {
    const files = Array.from(e.clipboardData.files)
    if (files.length) {
      e.preventDefault()
      await addImages(files)
    }
  }

  const submit = async (): Promise<void> => {
    const parsed = parseIntent(text)
    if (parsed.kind === 'terminal') {
      onOpenTerminal()
      setText('')
      reset()
    } else if (parsed.kind === 'create') {
      setSlug(parsed.slug)
      setDescription(parsed.description)
      setError('')
      setPhase('confirm')
    } else if (parsed.kind === 'open') {
      setError('')
      // A saved remote wins over a local folder of the same name: "open RefiliaAI"
      // should SSH in, not look for a local D:\Projects\RefiliaAI.
      const q = normalizeLoose(parsed.query)
      const remote = remotes.find((r) => normalizeLoose(r.name) === q)
      if (remote) {
        onOpenRemote(remote)
        setText('')
        reset()
        return
      }
      setOpenQuery(parsed.query)
      const found = await window.hub.findProject(parsed.query)
      setMatches(found)
      setPhase(found.length && found[0].score >= 0.4 ? 'open-confirm' : 'open-none')
    } else {
      setError('Try “create a new project for …” or “open <project name>”.')
      setPhase('error')
    }
  }

  const confirmCreate = async (): Promise<void> => {
    const finalSlug = slugify(slug)
    setPhase('creating')
    setSteps(['Working…'])
    try {
      const result: CreateProjectResult = await window.hub.createProject({
        slug: finalSlug,
        description,
        images: attachments.map((a) => a.path)
      })
      setSteps(result.steps)
      setPhase('done')
      onProjectCreated(result)
      setText('')
      setAttachments([])
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong while creating the project.')
      setPhase('error')
    }
  }

  const open = (m: ProjectMatch): void => {
    onOpenProject(m.dir, m.name)
    setText('')
    reset()
  }

  const reset = (): void => {
    setPhase('compose')
    setError('')
    setSteps([])
    inputRef.current?.focus()
  }

  return (
    <div
      className={`home-panel ${dragover ? 'dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragover(true)
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={onDrop}
    >
      <div>
        <h1>🩷 What should we build today?</h1>
        <p className="sub">
          Describe a project to <strong>create</strong> it, type{' '}
          <strong>open &lt;name&gt;</strong> to jump back into an existing one (typos are okay), or
          just <strong>terminal</strong> for a PowerShell tab. Drag screenshots in anytime.
        </p>
      </div>

      {phase === 'compose' || phase === 'error' ? (
        <div className="command-card">
          <textarea
            ref={inputRef}
            className="command-input"
            rows={3}
            autoFocus
            placeholder="create a new project for a cozy recipe app  —  or:  open recipe app"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
            }}
          />

          {attachments.length > 0 && (
            <div className="attachments">
              {attachments.map((a, i) => (
                <span className="attachment" key={a.path}>
                  <img src={a.thumb} alt="" />
                  {a.name}
                  <button
                    onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="command-row">
            <span className="hint">
              {error ? (
                <span className="err" style={{ color: 'var(--rose-deep)' }}>
                  {error}
                </span>
              ) : (
                'Tip: Ctrl+Enter to go · drop or paste screenshots to attach'
              )}
            </span>
            <button className="btn" onClick={submit} disabled={!text.trim()}>
              {liveKind === 'terminal' ? 'Terminal 🫧' : liveKind === 'open' ? 'Open 🫧' : 'Create 🫧'}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'confirm' && (
        <div className="confirm-card">
          <div className="field-label">PROJECT NAME (you can edit this)</div>
          <input
            className="name-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            spellCheck={false}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCreate()
            }}
          />
          <div className="path-preview">
            {projectsRoot.replace(/[\\/]$/, '')}\{slugify(slug)}
          </div>
          <p className="desc">
            <strong>About:</strong> {description}
          </p>
          {attachments.length > 0 && (
            <p className="desc" style={{ color: 'var(--text-soft)' }}>
              📎 {attachments.length} screenshot(s) will be saved with the project.
            </p>
          )}
          {!canScaffold && (
            <p className="desc err">
              ⚠️ Git identity isn't set yet — see the banner above. Creation will fail until it is.
            </p>
          )}
          <div className="command-row">
            <button className="btn ghost" onClick={reset}>
              ← Back
            </button>
            <button className="btn" onClick={confirmCreate}>
              Create it 💮
            </button>
          </div>
        </div>
      )}

      {phase === 'open-confirm' && matches.length > 0 && (
        <div className="confirm-card">
          <div className="field-label">OPEN EXISTING PROJECT</div>
          <p className="desc">
            Did you mean <strong>{matches[0].name}</strong>?
            {normalizeLoose(openQuery) !== normalizeLoose(matches[0].name) && (
              <span style={{ color: 'var(--text-soft)' }}> (you typed “{openQuery}”)</span>
            )}
          </p>
          <div className="path-preview">{matches[0].dir}</div>

          {matches.length > 1 && matches.some((m, i) => i > 0 && m.score > 0.2) && (
            <>
              <div className="field-label" style={{ marginTop: 12 }}>
                OR PICK ANOTHER
              </div>
              <div className="match-list">
                {matches
                  .slice(1)
                  .filter((m) => m.score > 0.2)
                  .map((m) => (
                    <button key={m.dir} className="match-item" onClick={() => open(m)}>
                      {m.name}
                    </button>
                  ))}
              </div>
            </>
          )}

          <div className="command-row">
            <button className="btn ghost" onClick={reset}>
              ← Back
            </button>
            <button className="btn" onClick={() => open(matches[0])}>
              Open 💮
            </button>
          </div>
        </div>
      )}

      {phase === 'open-none' && (
        <div className="confirm-card">
          <div className="field-label">NO MATCH FOUND</div>
          <p className="desc">
            I couldn't find a project matching “{openQuery}” in{' '}
            {projectsRoot.replace(/[\\/]$/, '')}.
          </p>
          <div className="command-row">
            <button className="btn ghost" onClick={reset}>
              ← Back
            </button>
            <button
              className="btn"
              onClick={() => {
                setSlug(slugify(openQuery))
                setDescription(openQuery)
                setError('')
                setPhase('confirm')
              }}
            >
              Create “{slugify(openQuery)}” instead
            </button>
          </div>
        </div>
      )}

      {(phase === 'creating' || phase === 'done') && (
        <div className="log">
          {phase === 'creating' && (
            <div className="step">
              <span className="spinner" /> Setting things up…
            </div>
          )}
          {steps.map((s, i) => (
            <div className="step" key={i}>
              <span className="tick">✓</span>
              <span>{s}</span>
            </div>
          ))}
          {phase === 'done' && (
            <div className="command-row" style={{ marginTop: 14 }}>
              <span className="hint">Opening a Claude tab for this project… 🎀</span>
              <button className="btn ghost" onClick={reset}>
                New project
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalizeLoose(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}
