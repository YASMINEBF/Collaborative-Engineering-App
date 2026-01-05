import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CollabProvider } from './collabs/provider/CollabProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CollabProvider>
      <App />
    </CollabProvider>
  </StrictMode>,
)
