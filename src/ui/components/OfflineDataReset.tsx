/**
 * Settings: clear the files the service worker keeps (the app shell and the AI, OCR and PDF
 * runtimes), then reload (T251, WLojek/DocCloak#2). Downloaded models stay. It asks first, since
 * the reload drops what is on the page, and needs the network, since the page then loads from it.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

export function OfflineDataReset({ onClear }: { onClear: () => Promise<void> }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => { setOnline(false); setConfirming(false); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const clear = async () => {
    setBusy(true);
    try {
      await onClear();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="border-t border-[#E5E5E0] pt-3" data-testid="offline-data">
      <span className="label-meta text-muted-foreground">{t.settings.offlineDataTitle}</span>
      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{t.settings.offlineDataDescription}</p>
      {confirming ? (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-[#111111] leading-snug">{t.settings.offlineDataConfirm}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy || !online}
              className="px-3 py-1.5 text-[10px] font-medium border border-[#111111] bg-[#111111] text-[#F9F9F7] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.settings.offlineDataConfirmYes}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="px-3 py-1.5 text-[10px] border border-[#E5E5E0] text-[#525252] hover:border-[#111111] cursor-pointer"
            >
              {t.settings.offlineDataCancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!online}
          className="mt-2 px-3 py-1.5 text-[10px] font-medium border border-[#E5E5E0] text-[#111111] hover:border-[#111111] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t.settings.offlineDataClear}
        </button>
      )}
      {!online && <p className="text-[10px] text-muted-foreground mt-1">{t.settings.offlineDataNeedsNetwork}</p>}
    </div>
  );
}
