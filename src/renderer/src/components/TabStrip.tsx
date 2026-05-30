export interface TabInfo {
  id: string
  title: string
  dead?: boolean
}

interface Props {
  tabs: TabInfo[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export function TabStrip({ tabs, activeId, onSelect, onClose }: Props): JSX.Element {
  return (
    <div className="tab-strip">
      <button
        className={`tab home ${activeId === 'home' ? 'active' : ''}`}
        onClick={() => onSelect('home')}
      >
        💮 Home
      </button>
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.dead ? 'dead' : ''} ${activeId === t.id ? 'active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          <span className="dot" />
          <span>{t.title}</span>
          <button
            className="close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
