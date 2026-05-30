/**
 * ProjectScaffolder — turns a parsed request into a real project on disk:
 *   mkdir → git init → seed files (incl. CLAUDE.md) → first commit →
 *   create a GitHub repo via the API + push (when a token is configured).
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { createRepo, storeGitCredential, tokenPush } from './github'

const exec = promisify(execFile)

export interface CreateProjectInput {
  slug: string
  description: string
  /** Absolute paths to screenshots the user dropped before creating. */
  images?: string[]
}

export interface ScaffoldOptions {
  token: string
  login: string
  visibility: 'public' | 'private'
  projectsRoot: string
}

export interface CreateProjectResult {
  projectDir: string
  slug: string
  repoUrl: string | null
  steps: string[]
  seedPrompt: string
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Pick a non-colliding directory under the projects root. */
async function resolveDir(root: string, slug: string): Promise<{ dir: string; finalSlug: string }> {
  await fs.mkdir(root, { recursive: true })
  let candidate = slug
  let n = 2
  while (existsSync(path.join(root, candidate))) {
    candidate = `${slug}-${n++}`
  }
  return { dir: path.join(root, candidate), finalSlug: candidate }
}

function claudeMd(name: string, description: string, repoUrl: string | null): string {
  const remote = repoUrl ? repoUrl : '(local only — add a GitHub remote later)'
  return `# ${name}

## About
${description}

## Workflow (required for every change)
This project uses **GitHub** (remote: ${remote}). Follow this branch-based flow for
**every** change — never commit directly to \`main\`:

1. **Create a branch** for the change and push it to GitHub.
2. **Ask the user to verify** the change works. Pause and wait for their explicit
   confirmation — do not merge or release until they approve.
3. **Only after the user confirms**, in this order:
   - Bump the version (semver: patch for fixes, minor for features) and rebuild /
     produce the release artifact, if this project ships one.
   - Merge the branch into \`main\`.
   - Delete the now-merged branch.
   - Publish a **new GitHub release** with the new version tag (attach the build
     artifact if applicable).

\`main\` must always reflect verified, working code. Keep this file up to date as the
project's source of truth.
`
}

function gitignore(): string {
  return `node_modules/
dist/
out/
.env
.env.local
*.log
.DS_Store
.assets/
`
}

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec(cmd, args, { cwd, windowsHide: true })
  return stdout.trim()
}

export async function createProject(
  input: CreateProjectInput,
  opts: ScaffoldOptions
): Promise<CreateProjectResult> {
  const steps: string[] = []
  const { dir, finalSlug } = await resolveDir(opts.projectsRoot, input.slug)
  const name = titleCase(finalSlug)

  await fs.mkdir(dir, { recursive: true })
  steps.push(`Created folder ${dir}`)

  await run('git', ['init', '-b', 'main'], dir)
  steps.push('Initialized git repository')

  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n\n${input.description}\n`)
  await fs.writeFile(path.join(dir, '.gitignore'), gitignore())
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), claudeMd(name, input.description, null))

  // Copy any dropped screenshots into .assets so they travel with the project.
  const copiedImages: string[] = []
  if (input.images?.length) {
    const assetsDir = path.join(dir, '.assets')
    await fs.mkdir(assetsDir, { recursive: true })
    for (const src of input.images) {
      try {
        const dest = path.join(assetsDir, path.basename(src))
        await fs.copyFile(src, dest)
        copiedImages.push(dest)
      } catch {
        /* ignore unreadable drops */
      }
    }
    if (copiedImages.length) steps.push(`Saved ${copiedImages.length} screenshot(s) to .assets`)
  }

  await run('git', ['add', '-A'], dir)
  await run('git', ['commit', '-m', 'Initial commit'], dir)
  steps.push('Committed initial files')

  let repoUrl: string | null = null
  if (opts.token) {
    try {
      const repo = await createRepo(opts.token, finalSlug, {
        private: opts.visibility === 'private',
        description: input.description
      })
      repoUrl = repo.html_url

      await run('git', ['remote', 'add', 'origin', repo.clone_url], dir)
      // Make `git push` track origin/main without needing a network round-trip.
      await run('git', ['config', 'branch.main.remote', 'origin'], dir)
      await run('git', ['config', 'branch.main.merge', 'refs/heads/main'], dir)

      // Refresh CLAUDE.md now that we know the URL, then push everything.
      await fs.writeFile(path.join(dir, 'CLAUDE.md'), claudeMd(name, input.description, repoUrl))
      await run('git', ['add', 'CLAUDE.md'], dir)
      await run('git', ['commit', '-m', 'Add repo URL to CLAUDE.md'], dir)

      await tokenPush(dir, repo.owner, opts.token)
      // Best-effort: register the token so later pushes need no header.
      await storeGitCredential(repo.owner, opts.token)

      steps.push(`Created ${opts.visibility} GitHub repo: ${repoUrl}`)
      steps.push('Pushed to origin/main')
    } catch (err: any) {
      steps.push(`GitHub step skipped: ${err?.message ?? 'failed'}`)
    }
  } else {
    steps.push('No GitHub token set — local git only. Add one in ⚙ Settings to auto-create repos.')
  }

  const imageLine = copiedImages.length
    ? ` I dropped these screenshots for reference: ${copiedImages.join(', ')}.`
    : ''
  const seedPrompt =
    `I'm starting a new project: ${input.description}. ` +
    `Git${repoUrl ? ' and a public GitHub remote are' : ' is'} already set up. ` +
    `Read CLAUDE.md, then propose the initial structure and a short plan.${imageLine}`

  return { projectDir: dir, slug: finalSlug, repoUrl, steps, seedPrompt }
}
