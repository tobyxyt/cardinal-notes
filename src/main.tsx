import { Capacitor } from '@capacitor/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

if (Capacitor.getPlatform() === 'ios') {
  document.documentElement.dataset.nativeIos = ''
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewport && !viewport.content.includes('viewport-fit=')) viewport.content += ', viewport-fit=cover'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
