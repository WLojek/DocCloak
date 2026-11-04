/**
 * Settings: how many pages of a scanned PDF the OCR reads at a time (T253, Core issue #4).
 * Automatic (the number for this device, ocrWorkerCount) or a number up to one per core.
 * The choice applies to the next PDF.
 */
import { useState } from 'react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { getOcrWorkerSetting, ocrWorkerChoices, ocrWorkerCount, setOcrWorkerSetting } from '../../ocr.web.ts';

export function OcrWorkersSetting() {
  const { t } = useTranslation();
  const [setting, setSetting] = useState(getOcrWorkerSetting);
  const choices = ocrWorkerChoices();
  // A number stored on a device with more cores is shown as the most this one offers.
  const value = setting === 'auto' ? 'auto' : String(Math.min(setting, choices[choices.length - 1]));

  const change = (raw: string) => {
    const next = raw === 'auto' ? 'auto' : Number(raw);
    setOcrWorkerSetting(next);
    setSetting(next);
  };

  return (
    <div className="border-t border-[#E5E5E0] pt-3" data-testid="ocr-workers">
      <label htmlFor="ocr-workers" className="text-xs font-medium text-[#111111]">{t.settings.ocrWorkersTitle}</label>
      <select
        id="ocr-workers"
        value={value}
        onChange={(e) => change(e.target.value)}
        className="mt-1.5 block w-full border border-[#E5E5E0] bg-transparent px-2 py-1.5 text-xs text-[#111111] cursor-pointer hover:border-[#111111]"
      >
        <option value="auto">{t.settings.ocrWorkersAuto(ocrWorkerCount())}</option>
        {choices.map((n) => <option key={n} value={String(n)}>{n}</option>)}
      </select>
      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{t.settings.ocrWorkersHint}</p>
    </div>
  );
}
