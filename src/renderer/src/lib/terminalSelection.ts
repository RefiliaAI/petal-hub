/**
 * Pure keyboard-selection logic for the embedded terminal, decoupled from xterm's
 * DOM so it can be unit-tested against a headless terminal buffer.
 *
 * Offsets are linear cell positions: `offset = row * cols + col`, where `row` is an
 * absolute buffer row (scrollback included). The caller holds the anchor/focus pair
 * and drives the actual term.select() highlight; everything here is side-effect free.
 */

/** Minimal read-only view of a terminal grid that both xterm and tests can provide. */
export interface TermGrid {
  cols: number
  rows: number
  /** First visible row's absolute index. */
  baseY: number
  /** Total rows in the buffer (scrollback + viewport). */
  length: number
  /** The real hardware cursor, absolute row. */
  realCursor: { col: number; row: number }
  /** Full text of an absolute row, right-padded to `cols` (no trailing trim). */
  rowText: (row: number) => string
  /** Whether the cell at (row, col) is drawn inverse-video. */
  isInverse: (row: number, col: number) => boolean
}

// Prompt markers stripped from the start of a Ctrl+A line selection. '❯' is the
// claude prompt glyph. The trailing space matches after NBSP normalization (see
// lineSelection), so a plain space covers both ' ' and claude's ' '.
const PROMPT_MARKERS = ['\u276f ', '> ', '$ ', '# ']
const NBSP = /\u00a0/g

// Keys sent to the pty to erase one cell each.
const BACKSPACE = '\x7f' // Backspace deletes the char left of the cursor.
const FORWARD_DELETE = '\x1b[3~' // Delete key erases the char at the cursor.

const isWordChar = (ch: string): boolean => /\S/.test(ch)

export const clampOffset = (g: TermGrid, off: number): number =>
  Math.max(0, Math.min(off, g.length * g.cols))

/**
 * The *visible* cursor. A TUI like `claude` draws its own block cursor as a single
 * inverse-video cell and parks the real terminal cursor elsewhere (often the far
 * right edge), so buffer.cursorX/Y is wrong there. We locate that lone inverse cell
 * instead. Normal shells have no inverse cell, so we fall back to the real cursor,
 * which is correct there. Multiple inverse cells are ambiguous → fall back too.
 */
export const getVisibleCursor = (g: TermGrid): { col: number; row: number } => {
  let found: { col: number; row: number } | null = null
  let count = 0
  for (let r = g.baseY; r < g.baseY + g.rows && count < 2; r++) {
    for (let x = 0; x < g.cols; x++) {
      if (g.isInverse(r, x)) {
        found = { col: x, row: r }
        if (++count >= 2) break
      }
    }
  }
  return found && count === 1 ? found : g.realCursor
}

/** Next word boundary to the right of `off` (used by Ctrl+Shift+→). */
export const wordRight = (g: TermGrid, off: number): number => {
  const c = g.cols
  const row = Math.floor(off / c)
  const startCol = off % c
  if (startCol >= c) return clampOffset(g, (row + 1) * c)
  const text = g.rowText(row)
  let col = startCol
  while (col < c && !isWordChar(text[col] ?? ' ')) col++
  while (col < c && isWordChar(text[col] ?? ' ')) col++
  if (col === startCol) return clampOffset(g, (row + 1) * c)
  return clampOffset(g, row * c + col)
}

/** Previous word boundary to the left of `off` (used by Ctrl+Shift+←). */
export const wordLeft = (g: TermGrid, off: number): number => {
  const c = g.cols
  const row = Math.floor(off / c)
  const startCol = off % c
  if (startCol === 0) return row === 0 ? 0 : clampOffset(g, (row - 1) * c + c)
  const text = g.rowText(row)
  let col = startCol - 1
  while (col > 0 && !isWordChar(text[col] ?? ' ')) col--
  while (col > 0 && isWordChar(text[col - 1] ?? ' ')) col--
  return clampOffset(g, row * c + col)
}

/**
 * Text between two offsets, trimming trailing spaces from each row so the blank
 * cell-padding xterm keeps to the right of every line never ends up copied.
 */
export const extractText = (g: TermGrid, a: number, b: number): string => {
  const c = g.cols
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  const startRow = Math.floor(start / c)
  const startCol = start % c
  const endRow = Math.floor(end / c)
  const endCol = end % c
  if (startRow === endRow) return g.rowText(startRow).substring(startCol, endCol).trimEnd()
  const parts = [g.rowText(startRow).substring(startCol).trimEnd()]
  for (let r = startRow + 1; r < endRow; r++) parts.push(g.rowText(r).trimEnd())
  parts.push(g.rowText(endRow).substring(0, endCol).trimEnd())
  return parts.join('\n')
}

/**
 * Ctrl+A selection of the visible cursor's row: the typed content only, with any
 * leading prompt marker and trailing spaces excluded.
 */
export const lineSelection = (g: TermGrid): { anchor: number; focus: number } => {
  const c = g.cols
  const cursor = getVisibleCursor(g)
  // claude pads its '❯' prompt with a non-breaking space (U+00A0), and rows are
  // right-padded with spaces. Normalize NBSP→space so marker and trailing-space
  // detection treat both like a regular space. Indices stay 1:1 with the raw row.
  const text = g.rowText(cursor.row).replace(NBSP, ' ')

  let end = c
  while (end > 0 && text[end - 1] === ' ') end--

  let start = 0
  for (const marker of PROMPT_MARKERS) {
    const idx = text.lastIndexOf(marker, cursor.col)
    if (idx >= 0) start = Math.max(start, idx + marker.length)
  }
  if (start > end) start = end

  return { anchor: cursor.row * c + start, focus: cursor.row * c + end }
}

/** Selected text for an anchor/focus pair (empty when zero-width). */
export const selectionText = (g: TermGrid, anchor: number | null, focus: number | null): string =>
  anchor === null || focus === null || anchor === focus ? '' : extractText(g, anchor, focus)

/**
 * Key bytes that delete the current selection from the pty's input line. Our highlight
 * is decoupled from the app's editing, but the app's real cursor stays within the
 * selection while shift-selecting, so we erase relative to it: Backspace for the part
 * left of the cursor, forward-Delete for the part at/right of it. Returns null for a
 * multi-row selection (don't risk corrupting the input) — the caller just clears then.
 */
export const deleteSelectionKeys = (
  g: TermGrid,
  anchor: number,
  focus: number
): string | null => {
  const c = g.cols
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  if (start === end) return null
  if (Math.floor(start / c) !== Math.floor((end - 1) / c)) return null // multi-row
  const cur = getVisibleCursor(g)
  const cursorOff = Math.max(start, Math.min(end, cur.row * c + cur.col))
  return BACKSPACE.repeat(cursorOff - start) + FORWARD_DELETE.repeat(end - cursorOff)
}

// ---- Key handler (pure reducer) -------------------------------------------------

export interface SelectionState {
  anchor: number | null
  focus: number | null
  selectedText: string
}

export interface KeyInput {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** What the component should do after the reducer runs. */
export type SelectionEffect =
  | { kind: 'passthrough' } // let xterm/pty handle the key (return true)
  | { kind: 'swallow' } // handled, do nothing else (return false)
  | { kind: 'render' } // re-draw highlight from state (return false)
  | { kind: 'selectAll' } // term.selectAll() (return false)
  | { kind: 'paste' } // allow the browser's native paste (return false)
  | { kind: 'copy'; text: string } // write text to clipboard (return false)
  | { kind: 'sendKeys'; data: string } // forward data to the pty (return false)
  | { kind: 'interrupt' } // no selection: let Ctrl+C through as SIGINT (return true)
  | { kind: 'cancelPassthrough' } // a stale selection was cleared; clear highlight + pass (true)

const reset = (s: SelectionState): void => {
  s.anchor = null
  s.focus = null
  s.selectedText = ''
}

const isArrowKey = (key: string): boolean =>
  key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'

/**
 * Pure keyboard handler for selection + clipboard. Mutates `s` and returns the side
 * effect for the component to perform. Keeps all selection behavior in one tested place.
 */
export const handleSelectionKey = (
  s: SelectionState,
  e: KeyInput,
  g: TermGrid
): SelectionEffect => {
  const c = g.cols
  const lower = e.key.toLowerCase()

  // Shift+Arrow extends the selection; add Ctrl to move by whole words.
  if (e.shiftKey && isArrowKey(e.key)) {
    if (s.anchor === null) {
      const cur = getVisibleCursor(g)
      s.anchor = cur.row * c + cur.col
    }
    let f = s.focus ?? s.anchor
    if (e.key === 'ArrowRight') f = e.ctrlKey ? wordRight(g, f) : clampOffset(g, f + 1)
    else if (e.key === 'ArrowLeft') f = e.ctrlKey ? wordLeft(g, f) : clampOffset(g, f - 1)
    else if (e.key === 'ArrowDown') f = clampOffset(g, f + c)
    else f = clampOffset(g, f - c)
    s.focus = f
    s.selectedText = selectionText(g, s.anchor, s.focus)
    return { kind: 'render' }
  }

  if (e.ctrlKey) {
    if (lower === 'a' && !e.shiftKey) {
      const sel = lineSelection(g)
      s.anchor = sel.anchor
      s.focus = sel.focus
      s.selectedText = selectionText(g, sel.anchor, sel.focus)
      return { kind: 'render' }
    }
    if (lower === 'a' && e.shiftKey) {
      reset(s)
      return { kind: 'selectAll' }
    }
    if (lower === 'v') {
      reset(s)
      return { kind: 'paste' }
    }
    if (lower === 'c') {
      if (s.selectedText) {
        const text = s.selectedText
        reset(s)
        return { kind: 'copy', text }
      }
      reset(s)
      return e.shiftKey ? { kind: 'swallow' } : { kind: 'interrupt' }
    }
  }

  // Backspace / Delete with an active selection erases the selected text.
  if ((e.key === 'Backspace' || e.key === 'Delete') && s.anchor !== null && s.focus !== null) {
    const data = deleteSelectionKeys(g, s.anchor, s.focus)
    reset(s)
    return data ? { kind: 'sendKeys', data } : { kind: 'swallow' }
  }

  // Any other keystroke cancels a stale selection and passes through — but ignore lone
  // modifiers and shifted keys so the selection above can keep extending.
  if (s.anchor !== null) {
    const mod = e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta'
    if (!mod && !e.shiftKey) {
      reset(s)
      return { kind: 'cancelPassthrough' }
    }
  }
  return { kind: 'passthrough' }
}
