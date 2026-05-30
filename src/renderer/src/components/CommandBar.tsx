import { useRef, useState } from 'react'
import { parseIntent, slugify } from '../lib/intent'
import { fileToImagePayload } from '../lib/images'
import type { CreateProjectResult } from '../../../preload/index.d'

interface Attachment {
  name: string
  path: string
  thumb: string
}

type Phase = 'compose' | 'confirm' | 'creating' | 'done' | 'error'

interface Props {
  canScaffold: boolean
  projectsRoot: string
  onProjectCreated: (result: CreateProjectResult) => void
}

export function CommandBar({ canScaffold, projectsRoot, onProjectCreated }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [phase, setPhase] = useState<Phase>('compose')
  const [dragover, setDragover] = useState(false)
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  const submit = (): void => {
    const parsed = parseIntent(text)
    if (!parsed.isCreate) {
      setError('Try something like: “create a new project for a recipe sharing app”')
      setPhase('error')
      return
    }
    setSlug(parsed.slug)
    setDescription(parsed.description)
    setError('')
    setPhase('confirm')
  }

  const confirmCreate = async (): Promise<void> => {
    const finalSlug = slugify(slug) // sanitize whatever the user typed
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
      // Reset compose state for the next project.
      setText('')
      setAttachments([])
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong while creating the project.')
      setPhase('error')
    }
  }

  // ---------- render helpers ----------
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
        <h1>💖 What should we build today?</h1>
        <p className="sub">
          Describe a project in plain words and I'll set up the folder, git, a public GitHub repo,
          and open a fresh Claude session for it. Drag screenshots in anytime.
        </p>
      </div>

      {phase === 'compose' || phase === 'error' ? (
        <div className="command-card">
          <textarea
            ref={inputRef}
            className="command-input"
            rows={3}
            autoFocus
            placeholder="create a new project for a cozy recipe sharing app…"
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
              Create ✨
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
              Create it 🌸
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
