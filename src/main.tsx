import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/animations.css'
import './styles/butterfly-animations.css'
import './styles/canvas.css'
import App from './App.tsx'

// Set dark mode as default
if (!document.documentElement.classList.contains('dark') && !localStorage.getItem('theme')) {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
