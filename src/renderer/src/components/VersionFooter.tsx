import { useEffect, useState } from 'react'
import type { UpdateInfo } from '../../../preload/index.d'

/**
 * Bottom-right version badge. On mount it asks the main process (which queries
 * GitHub) for the running version + whether a newer release exists. The current
 * version always shows; when an update is available an Update button appears that
 * downloads + launches the new installer (the app then quits to be replaced).
 */
export function VersionFooter(): JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    window.hub
      .checkUpdate()
      .then((u) => alive && setInfo(u))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [])

  const update = async (): Promise<void> => {
    if (!info?.downloadUrl) return
    setInstalling(true)
    setError('')
    try {
      // On success the app quits as the installer launches, so this never returns.
      await window.hub.installUpdate(info.downloadUrl)
    } catch {
      setError('Update failed — try again')
      setInstalling(false)
    }
  }

  // checkForUpdate always returns `current` (even offline), so this fills in fast.
  if (!info) return null

  return (
    <div className="version-footer">
      {info.hasUpdate ? (
        <>
          <span className="vf-new">✨ v{info.latest} available</span>
          {error && <span className="vf-error">{error}</span>}
          <button className="vf-update" onClick={update} disabled={installing}>
            {installing ? 'Updating…' : 'Update 🌸'}
          </button>
          <span className="vf-current">v{info.current}</span>
        </>
      ) : (
        <span className="vf-current">v{info.current}</span>
      )}
    </div>
  )
}
