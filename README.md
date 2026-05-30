# 🌸 Petal Hub

A cute pastel-pink command center for running **Claude Code** across many projects.

Type a request in plain words — *"create a new project for a cozy recipe app"* — and
Petal Hub will:

1. 📁 Create the folder under `D:\Projects\<name>`
2. 🔧 `git init` + a first commit
3. 🐙 Create a **public GitHub repo** and push it
4. 📝 Seed a `CLAUDE.md` describing the project + your GitHub workflow
5. 🐱 Open a **new tab** running a live `claude` session in that folder, pre-loaded
   with the project context

Drag & drop screenshots onto the home panel (attached to the new project) or onto any
open tab (typed into that live Claude session).

---

## One-time setup

| Need | Why | Fix |
| ---- | --- | --- |
| Git identity | commits | `git config --global user.name "You"` and `... user.email "you@example.com"` |
| GitHub CLI | auto-create repos | `winget install --id GitHub.cli` then `gh auth login` |
| VS C++ Build Tools | compile `node-pty` | install "Desktop development with C++" (only if the rebuild step fails) |

The app shows a friendly banner on launch telling you exactly what's missing — it runs
fine before setup is complete and just disables the parts that aren't ready yet.

## Run it

```powershell
cd D:\Desktop\ClaudeCode\petal-hub
npm install          # installs deps; postinstall rebuilds node-pty for Electron
npm run dev          # launches the hub with hot reload
```

If embedded terminals show a "rebuild needed" banner:

```powershell
npm run rebuild      # rebuilds node-pty against Electron's Node version
```

## Build a standalone app

```powershell
npm run package      # portable .exe in dist/
```

---

## How it's wired

```
src/main/        Electron main process (Node-privileged)
  index.ts        window + IPC handlers
  intent.ts       "create a project for X" -> { slug, description }
  scaffolder.ts   folder + git + gh repo create --public + CLAUDE.md
  terminal.ts     one node-pty per tab running `claude`
  doctor.ts       startup environment checks
src/preload/     contextBridge API (the only thing the UI can call)
src/renderer/    React + xterm.js UI (all the pastel lives in styles/theme.css)
```

Want a different look? Edit `src/renderer/src/styles/theme.css` — every color and shape
is a CSS variable in one place. 🎀
