import { useEffect } from 'react';
import { useToast } from './Toast.tsx';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { onServiceWorkerUpdate } from '../../sw-register.ts';

/**
 * Renders nothing. Bridges the Service Worker update event bus
 * (src/sw-register.ts) to the toast system: when a new build takes control
 * of the page, show a non-blocking "new version available" toast whose
 * action reloads the page.
 */
export function ServiceWorkerUpdateNotice() {
  const { showToast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    return onServiceWorkerUpdate(() => {
      showToast(t.toast.newVersion, {
        label: t.toast.reload,
        onClick: () => window.location.reload(),
      });
    });
  }, [showToast, t]);

  return null;
}
