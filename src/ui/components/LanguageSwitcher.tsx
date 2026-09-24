import { Languages, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { languages } from '../../i18n/translations/index.ts';

/**
 * The one language control used by the app header and the static content
 * pages (GDPR, use cases), so switching languages looks the same everywhere.
 */
export function LanguageSwitcher({ ariaLabel }: { ariaLabel: string }) {
  const { language, setLanguage } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label={ariaLabel}>
          <Languages className="w-4 h-4" />
          <span className="text-[10px] font-mono uppercase text-[#525252]">{language}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1 max-h-[70vh] overflow-auto">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-[#E5E5E0] transition-colors duration-200 flex items-center justify-between cursor-pointer"
          >
            <span className="text-[#111111]/80">{lang.nativeName}</span>
            {language === lang.code && <Check className="w-3.5 h-3.5 text-[#111111]" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
