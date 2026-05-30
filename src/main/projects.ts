/**
 * Project discovery + typo-tolerant fuzzy matching for the "open …" command.
 * Folder names are kebab-case slugs; queries are free text ("tets", "my recipe
 * app"), so we normalise both and score with Damerau-Levenshtein (handles
 * transpositions, the most common typo).
 */
import { promises as fs } from 'fs'
import path from 'path'

export interface ProjectMatch {
  name: string
  dir: string
  score: number
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Damerau-Levenshtein (optimal string alignment) distance. */
function dlDistance(a: string, b: string): number {
  const al = a.length
  const bl = b.length
  if (al === 0) return bl
  if (bl === 0) return al
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0))
  for (let i = 0; i <= al; i++) d[i][0] = i
  for (let j = 0; j <= bl; j++) d[0][j] = j
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1) // transposition
      }
    }
  }
  return d[al][bl]
}

/** 0..1 similarity, with a boost for exact / substring hits. */
function similarity(query: string, candidate: string): number {
  const q = normalize(query)
  const c = normalize(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  if (c.includes(q) || q.includes(c)) return 0.9
  // Whole-string similarity.
  const full = 1 - dlDistance(q, c) / Math.max(q.length, c.length)
  // Prefix-aware similarity: compare the query to the candidate's leading
  // window of the same length, so a typo'd short name still finds a longer
  // project (e.g. "tets" -> "test1234"). Slightly discounted so exact/whole
  // matches still rank above prefix matches.
  const w = Math.min(q.length, c.length)
  const prefix = (1 - dlDistance(q.slice(0, w), c.slice(0, w)) / w) * 0.92
  return Math.max(0, Math.max(full, prefix))
}

export async function listProjects(root: string): Promise<{ name: string; dir: string }[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, dir: path.join(root, e.name) }))
  } catch {
    return []
  }
}

export async function findProjects(root: string, query: string): Promise<ProjectMatch[]> {
  const projects = await listProjects(root)
  return projects
    .map((p) => ({ ...p, score: similarity(query, p.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
