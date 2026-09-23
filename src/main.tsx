import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './ui/pages/router.tsx'
import { LanguageProvider } from './i18n/LanguageContext.tsx'
import { ToastProvider } from './ui/components/Toast.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </LanguageProvider>
  </StrictMode>,
)
