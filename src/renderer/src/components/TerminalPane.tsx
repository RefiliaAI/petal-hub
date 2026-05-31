import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { fileToImagePayload } from '../lib/images'

interface Props {
  id: string
  active: boolean
  onExit: (id: string) => void
}

/**
 * One embedded `claude` session. Stays mounted (just hidden) when inactive so
 * the session keeps running and scrollback is preserved.
 */
export function TerminalPane({ id, active, onExit }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [dead, setDead] = useState(false)
  const [dragover, setDragover] = useState(false)

  // Create the terminal once.
  useEffect(() => {
    if (!mountRef.current) return
    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      letterSpacing: 0.2,
      cursorBlink: true,
      allowProposedApi: true,
      // Light pastel theme. ANSI colors are tuned to stay legible on a near-white
      // background; "white"/"brightWhite" are remapped to dark tones so programs
      // that print white-on-dark text remain readable here.
      theme: {
        background: '#fff7fb',
        foreground: '#5c3a4d',
        cursor: '#ff5fa8',
        cursorAccent: '#fff7fb',
        selectionBackground: '#ffcfe6',
        selectionForeground: '#4a2d3d',
        black: '#5c3a4d',
        red: '#d6336c',
        green: '#2f9e6f',
        yellow: '#b0820a',
        blue: '#3b6fd4',
        magenta: '#b5179e',
        cyan: '#0f8b8d',
        white: '#9c8090',
        brightBlack: '#a87a90',
        brightRed: '#f06595',
        brightGreen: '#37b979',
        brightYellow: '#c99a1e',
        brightBlue: '#5b8def',
        brightMagenta: '#da77f2',
        brightCyan: '#1fb6b6',
        brightWhite: '#4a2d3d'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(mountRef.current)

    // Standard clipboard shortcuts. xterm doesn't wire these up itself, so the
    // raw keystrokes would otherwise reach the pty (e.g. Ctrl+V as a control char).
    // Returning false tells xterm we handled the event and to swallow it.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true
      const key = e.key.toLowerCase()

      // Paste: Ctrl+V or Ctrl+Shift+V. xterm would normally send ^V as a control
      // char and preventDefault, which suppresses the browser's native paste.
      // Returning false skips that, letting the native paste feed the pty exactly
      // once — don't paste manually here too, or it pastes twice.
      if (key === 'v') {
        return false
      }

      // Copy: Ctrl+Shift+C always copies the selection; plain Ctrl+C copies only
      // when something is selected, otherwise it passes through as interrupt (SIGINT).
      if (key === 'c') {
        const sel = term.getSelection()
        if (e.shiftKey) {
          if (sel) window.hub.writeClipboard(sel)
          return false
        }
        if (sel) {
          window.hub.writeClipboard(sel)
          term.clearSelection()
          return false
        }
        return true
      }

      // Select all: Ctrl+Shift+A.
      if (e.shiftKey && key === 'a') {
        term.selectAll()
        return false
      }

      return true
    })
    try {
      fit.fit()
    } catch {
      /* not visible yet */
    }
    termRef.current = term
    fitRef.current = fit

    // UI keystrokes → pty.
    const keySub = term.onData((data) => window.hub.writeTab(id, data))
    // pty output → UI.
    const offData = window.hub.onTabData(({ id: tid, data }) => {
      if (tid === id) term.write(data)
    })
    const offExit = window.hub.onTabExit(({ id: tid }) => {
      if (tid === id) {
        setDead(true)
        onExit(id)
      }
    })

    // Push the initial size to the pty.
    const c = term.cols
    const r = term.rows
    window.hub.resizeTab(id, c, r)

    return () => {
      keySub.dispose()
      offData()
      offExit()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Refit when the pane becomes visible or the window resizes.
  useEffect(() => {
    if (!active) return
    const refit = (): void => {
      const fit = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
        window.hub.resizeTab(id, term.cols, term.rows)
        term.focus()
      } catch {
        /* ignore */
      }
    }
    const raf = requestAnimationFrame(refit)
    const ro = new ResizeObserver(refit)
    if (mountRef.current) ro.observe(mountRef.current)
    window.addEventListener('resize', refit)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', refit)
    }
  }, [active, id])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragover(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    for (const f of files) {
      try {
        const payload = await fileToImagePayload(f)
        const savedPath = await window.hub.saveImage(payload)
        // Type the path into the live session so Claude can read the image.
        window.hub.writeTab(id, savedPath + ' ')
      } catch {
        /* ignore bad drop */
      }
    }
    termRef.current?.focus()
  }

  return (
    <div
      className={`term-host ${active ? '' : 'hidden'}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragover(true)
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={onDrop}
      style={dragover ? { outline: '3px dashed #ff89bd', outlineOffset: '-8px' } : undefined}
    >
      <div className="term-mount" ref={mountRef} />
      {dead && (
        <div className="term-dead">
          <div>🥀 This session ended.</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Close the tab from the strip above.</div>
        </div>
      )}
    </div>
  )
}
