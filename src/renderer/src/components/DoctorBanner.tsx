import { useState } from 'react'
import type { DoctorReport } from '../../../preload/index.d'

export function DoctorBanner({ report }: { report: DoctorReport | null }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!report) return null

  const allOk = report.checks.every((c) => c.ok)
  const badCount = report.checks.filter((c) => !c.ok).length

  const copy = (text: string): void => {
    navigator.clipboard?.writeText(text)
  }

  return (
    <div className={`doctor ${allOk ? 'ok' : ''}`}>
      <button className="doctor-toggle" onClick={() => setOpen((o) => !o)}>
        {allOk
          ? '🌸 Everything is ready — git, GitHub & terminals all set.'
          : `⚠️ ${badCount} setup step${badCount > 1 ? 's' : ''} need attention — click to ${
              open ? 'hide' : 'view fixes'
            }`}
      </button>
      {(open || !allOk) &&
        report.checks.map((c) => (
          <div className="doctor-row" key={c.id}>
            <span className={`pill ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? 'OK' : 'FIX'}</span>
            <span className="label">{c.label}</span>
            <span className="detail">{c.detail}</span>
            {c.fix && (
              <span className="fix" title="Click to copy" onClick={() => copy(c.fix!)}>
                {c.fix}
              </span>
            )}
          </div>
        ))}
    </div>
  )
}
