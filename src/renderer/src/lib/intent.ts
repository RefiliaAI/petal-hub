/**
 * Renderer-side mirror of the main IntentParser, used to drive the editable
 * confirm chip before a project is created. Kept tiny and dependency-free.
 */
const CREATE_RE = /^\s*(?:please\s+)?(create|make|new|start|build|set\s*up|spin\s*up)\b/i
const PROJECT_RE = /\bprojects?\b/i
const LEADING_FILLER_RE =
  /^\s*(?:a\s+|an\s+|the\s+)?(?:new\s+|fresh\s+)?projects?\s+(?:called\s+|named\s+|for\s+|about\s+|that\s+|to\s+|which\s+)?/i

const OPEN_RE = /^\s*(?:please\s+)?(open|reopen|resume|continue|load|launch|go\s*to|switch\s*to)\b/i
const OPEN_FILLER_RE = /^\s*(?:the\s+|my\s+|a\s+|an\s+)?(?:existing\s+)?(?:projects?\s+)?(?:called\s+|named\s+)?/i

// "terminal", "open a terminal", "new powershell", "give me a shell", …
const TERMINAL_RE =
  /^\s*(?:please\s+)?(?:(?:open|new|start|launch|create|run|give\s+me|spin\s*up)\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(terminal|power\s*shell|pwsh|shell|command\s*prompt)\b/i

const SLUG_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'and', 'or', 'with', 'that', 'this',
  'my', 'our', 'app', 'application', 'project', 'called', 'named', 'about',
  'which', 'is', 'will', 'can', 'lets', "let's", 'me', 'i', 'want', 'wanna',
  'would', 'like', 'please', 'new'
])

export function slugify(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const meaningful = words.filter((w) => !SLUG_STOPWORDS.has(w))
  const chosen = (meaningful.length ? meaningful : words).slice(0, 5)
  const slug = chosen.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug || 'untitled-project'
}

export interface ParsedIntent {
  kind: 'create' | 'open' | 'terminal' | 'unknown'
  /** For create: the project description. */
  description: string
  /** For create: kebab-case folder/repo name. */
  slug: string
  /** For open: the (possibly misspelled) name the user is looking for. */
  query: string
}

export function parseIntent(raw: string): ParsedIntent {
  const text = raw.trim()

  // "terminal" / "open a powershell" — checked first so the keyword wins.
  if (TERMINAL_RE.test(text)) {
    return { kind: 'terminal', description: '', slug: '', query: '' }
  }

  // "open <name>" — checked before create so "open project x" isn't mis-read.
  if (OPEN_RE.test(text)) {
    let query = text.replace(OPEN_RE, '').trim()
    query = query.replace(OPEN_FILLER_RE, '').trim()
    query = query.replace(/\bprojects?\b/gi, ' ')
    query = query.replace(/["'`]/g, '').replace(/[.!?]+$/, '').trim()
    return { kind: 'open', description: '', slug: '', query }
  }

  if (CREATE_RE.test(text) && PROJECT_RE.test(text)) {
    let description = text.replace(CREATE_RE, '').trim()
    description = description.replace(LEADING_FILLER_RE, '').trim()
    description = description.replace(/[.!?]+$/, '').trim()
    if (!description) description = text
    return { kind: 'create', description, slug: slugify(description), query: '' }
  }

  return { kind: 'unknown', description: text, slug: '', query: '' }
}
