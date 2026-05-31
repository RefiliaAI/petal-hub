import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { fileToImagePayload } from '../lib/images'
import {
  clampOffset,
  extractText,
  getVisibleCursor,
  lineSelection,
  wordLeft,
  wordRight,
  type TermGrid
} from '../lib/terminalSelection'

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

    // ---- Keyboard text selection (a copy-style highlight, not editing) ----
    // xterm has no built-in keyboard selection — its model is mouse-only — so we track
    // an anchor/focus pair as linear cell offsets and drive term.select(). The pty's
    // own cursor is untouched; this only highlights cells for copying. The offset math
    // lives in ../lib/terminalSelection (pure + unit-tested); here we just adapt the
    // live xterm buffer to its TermGrid view and hold the anchor/focus state.
    let anchor: number | null = null
    let focus: number | null = null
    // We extract selected text ourselves (trimming per-row padding) rather than relying
    // on term.getSelection(), which can return empty after a programmatic term.select().
    let selectedText = ''

    const cols = (): number => term.cols
    const grid = (): TermGrid => {
      const b = term.buffer.active
      return {
        cols: term.cols,
        rows: term.rows,
        baseY: b.baseY,
        length: b.length,
        realCursor: { col: b.cursorX, row: b.baseY + b.cursorY },
        rowText: (row) => b.getLine(row)?.translateToString(false) ?? '',
        isInverse: (row, col) => !!b.getLine(row)?.getCell(col)?.isInverse()
      }
    }
    const cursorOffset = (): number => {
      const { col, row } = getVisibleCursor(grid())
      return row * term.cols + col
    }

    const ensureVisible = (off: number): void => {
      try {
        const row = Math.floor(off / cols())
        const top = term.buffer.active.viewportY
        if (row < top) term.scrollToLine(row)
        else if (row >= top + term.rows) term.scrollToLine(row - term.rows + 1)
      } catch {
        /* ignore */
      }
    }

    const renderSelection = (): void => {
      if (anchor === null || focus === null || anchor === focus) {
        term.clearSelection()
        selectedText = ''
        return
      }
      const start = Math.min(anchor, focus)
      const end = Math.max(anchor, focus)
      term.select(start % cols(), Math.floor(start / cols()), end - start)
      selectedText = extractText(grid(), start, end)
      ensureVisible(focus)
    }

    // Ctrl+A: select the typed content on the visible cursor's row.
    const selectWholeLine = (): void => {
      const sel = lineSelection(grid())
      anchor = sel.anchor
      focus = sel.focus
      renderSelection()
    }

    const clearSel = (): void => {
      anchor = null
      focus = null
      selectedText = ''
      term.clearSelection()
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key
      const lower = key.toLowerCase()
      const isArrow =
        key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'

      // Shift+Arrow extends the selection; add Ctrl to move by whole words.
      if (e.shiftKey && isArrow) {
        const g = grid()
        if (anchor === null) anchor = cursorOffset()
        let f = focus ?? anchor
        const c = cols()
        if (key === 'ArrowRight') f = e.ctrlKey ? wordRight(g, f) : clampOffset(g, f + 1)
        else if (key === 'ArrowLeft') f = e.ctrlKey ? wordLeft(g, f) : clampOffset(g, f - 1)
        else if (key === 'ArrowDown') f = clampOffset(g, f + c)
        else f = clampOffset(g, f - c)
        focus = f
        renderSelection()
        return false
      }

      if (e.ctrlKey) {
        // Ctrl+A: select the whole current line.
        if (lower === 'a' && !e.shiftKey) {
          selectWholeLine()
          return false
        }
        // Ctrl+Shift+A: select the entire buffer.
        if (lower === 'a' && e.shiftKey) {
          term.selectAll()
          anchor = focus = null
          return false
        }
        // Ctrl+V / Ctrl+Shift+V: xterm would send ^V and preventDefault, suppressing
        // the browser's native paste. Returning false lets that native paste feed the
        // pty exactly once — don't paste manually too, or it pastes twice.
        if (lower === 'v') {
          clearSel()
          return false
        }
        // Ctrl+C / Ctrl+Shift+C: copy selection if there is one, otherwise pass
        // through as interrupt (SIGINT). We use our own selectedText rather than
        // term.getSelection() because the latter can return empty after a programmatic
        // term.select() call.
        if (lower === 'c') {
          if (selectedText) {
            window.hub.writeClipboard(selectedText)
            clearSel()
            return false
          }
          if (e.shiftKey) return false
          return true
        }
      }

      // Any other keystroke cancels a stale keyboard selection and is passed to the
      // pty — but ignore lone modifiers and shifted keys so the selection above can
      // keep extending across repeated Shift+Arrow presses.
      if (anchor !== null) {
        const mod = key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'
        if (!mod && !e.shiftKey) clearSel()
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
