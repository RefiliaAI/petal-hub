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

/**
 * Prompt markers stripped from the start of a Ctrl+A line selection. '❯' is the
 * claude prompt glyph (❯). The trailing space is matched after NBSP normalization
 * (see lineSelection), so a plain space covers both ' ' and claude's ' '.
 */
const PROMPT_MARKERS = ['❯ ', '> ', '$ ', '# ']

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
  const text = g.rowText(cursor.row).replace(/ /g, ' ')

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
