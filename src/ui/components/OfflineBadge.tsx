import { Badge } from '@/components/ui/badge';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

export function OfflineBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="gap-1.5 font-medium">
      <span className="w-2 h-2  bg-muted-foreground/40 inline-block animate-pulse" />
      {t.header.offline}
    </Badge>
  );
}
