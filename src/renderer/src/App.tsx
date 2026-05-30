import { useCallback, useEffect, useState } from 'react'
import { DoctorBanner } from './components/DoctorBanner'
import { TabStrip, type TabInfo } from './components/TabStrip'
import { TerminalPane } from './components/TerminalPane'
import { CommandBar } from './components/CommandBar'
import { SettingsPanel } from './components/SettingsPanel'
import type { CreateProjectResult, DoctorReport, PublicSettings } from '../../preload/index.d'

export function App(): JSX.Element {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeId, setActiveId] = useState<string>('home')

  const refreshEnv = useCallback(() => {
    window.hub.runDoctor().then(setReport).catch(() => setReport(null))
    window.hub.getSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  // Run the environment doctor + load settings on launch.
  useEffect(refreshEnv, [refreshEnv])

  const handleProjectCreated = useCallback(async (result: CreateProjectResult) => {
    try {
      const { id } = await window.hub.spawnTab(result.projectDir, result.seedPrompt)
      setTabs((t) => [...t, { id, title: result.slug }])
      // Small delay so the success log is briefly visible before we switch.
      setTimeout(() => setActiveId(id), 600)
    } catch (err) {
      // If terminals can't spawn, at least let the user open the folder.
      window.hub.openPath(result.projectDir)
    }
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      window.hub.closeTab(id)
      setTabs((t) => t.filter((x) => x.id !== id))
      setActiveId((cur) => (cur === id ? 'home' : cur))
    },
    []
  )

  const markDead = useCallback((id: string) => {
    setTabs((t) => t.map((x) => (x.id === id ? { ...x, dead: true } : x)))
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <span className="logo">🌸 Petal Hub</span>
        <span className="tagline">your cozy Claude Code command center</span>
        <span className="header-spacer" />
        <button className="icon-btn" onClick={() => setShowSettings(true)}>
          ⚙ Settings
        </button>
      </header>

      <DoctorBanner report={report} />

      <TabStrip tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} />

      <div className="body">
        {/* Home is unmounted when hidden; terminals stay mounted to keep sessions alive. */}
        {activeId === 'home' && (
          <CommandBar
            canScaffold={report?.canScaffold ?? true}
            projectsRoot={settings?.projectsRoot ?? 'D:\\Projects'}
            onProjectCreated={handleProjectCreated}
          />
        )}
        {tabs.map((t) => (
          <TerminalPane key={t.id} id={t.id} active={activeId === t.id} onExit={markDead} />
        ))}
      </div>

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} onChanged={refreshEnv} />
      )}
    </div>
  )
}
