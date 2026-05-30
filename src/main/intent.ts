/**
 * IntentParser — deterministic, no API key required.
 *
 * Detects "create a new project for X" style requests and extracts:
 *   - description: the cleaned-up natural-language description
 *   - slug:        a kebab-case repo/folder name derived from it
 */

const CREATE_RE = /^\s*(?:please\s+)?(create|make|new|start|build|set\s*up|spin\s*up)\b/i
const PROJECT_RE = /\bprojects?\b/i

// Filler removed from the front of the description after the verb.
const LEADING_FILLER_RE =
  /^\s*(?:a\s+|an\s+|the\s+)?(?:new\s+|fresh\s+)?projects?\s+(?:called\s+|named\s+|for\s+|about\s+|that\s+|to\s+|which\s+)?/i

// Stopwords stripped when building the slug (keep meaningful nouns).
const SLUG_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'and', 'or', 'with', 'that', 'this',
  'my', 'our', 'app', 'application', 'project', 'called', 'named', 'about',
  'which', 'is', 'will', 'can', 'lets', "let's", 'me', 'i', 'want', 'wanna',
  'would', 'like', 'please', 'new'
])

export interface ParsedIntent {
  isCreate: boolean
  description: string
  slug: string
}

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

export function parseIntent(raw: string): ParsedIntent {
  const text = raw.trim()
  const isCreate = CREATE_RE.test(text) && PROJECT_RE.test(text)

  if (!isCreate) {
    return { isCreate: false, description: text, slug: '' }
  }

  // Drop the leading verb, then the "a new project for" filler.
  let description = text.replace(CREATE_RE, '').trim()
  description = description.replace(LEADING_FILLER_RE, '').trim()
  // Tidy trailing punctuation.
  description = description.replace(/[.!?]+$/, '').trim()

  if (!description) description = text

  return {
    isCreate: true,
    description,
    slug: slugify(description)
  }
}
