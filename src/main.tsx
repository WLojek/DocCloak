import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './i18n/LanguageContext.tsx'
import { ToastProvider } from './ui/components/Toast.tsx'
import { ServiceWorkerUpdateNotice } from './ui/components/ServiceWorkerUpdateNotice.tsx'
import { registerServiceWorker } from './sw-register.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ToastProvider>
        <App />
        <ServiceWorkerUpdateNotice />
      </ToastProvider>
    </LanguageProvider>
  </StrictMode>,
)

// Production only, after load (see src/sw-register.ts).
registerServiceWorker()
