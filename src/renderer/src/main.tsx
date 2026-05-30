import React from 'react'
import { createRoot } from 'react-dom/client'
// Bundled handwritten UI font (offline, no CDN — respects the app CSP).
import '@fontsource/shantell-sans/400.css'
import '@fontsource/shantell-sans/500.css'
import '@fontsource/shantell-sans/600.css'
import '@fontsource/shantell-sans/700.css'
import './styles/theme.css'
import './styles/app.css'
import '@xterm/xterm/css/xterm.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
