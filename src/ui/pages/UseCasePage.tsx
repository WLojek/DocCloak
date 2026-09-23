import { ArrowRight, BarChart3, Check, Scale } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { getPagesTranslations } from '../../i18n/pages/index.ts';
import { PageShell } from './PageShell.tsx';

export type UseCaseId = 'lawyers' | 'accountants' | 'hr' | 'researchers';

export function UseCasePage({ useCase }: { useCase: UseCaseId }) {
  const { language } = useTranslation();
  const pt = getPagesTranslations(language);
  const c = pt.useCases[useCase];

  return (
    <PageShell title={`${c.title} · DocCloak`}>
      {/* Hero */}
      <section className="bg-[#F9F9F7] px-6 pt-16 pb-14">
        <div className="max-w-3xl mx-auto">
          <p className="label-meta text-[#CC0000] mb-4">{c.eyebrow}</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.15] tracking-tight text-[#111111] font-medium">
            {c.title}
          </h1>
          <p className="mt-6 text-lg text-[#525252] leading-relaxed">{c.intro}</p>
          <a
            href="#/"
            className="pressable mt-8 inline-flex items-center gap-2 px-8 py-4 bg-[#111111] text-[#F9F9F7] text-sm font-semibold hover:bg-[#222222] transition-colors"
          >
            {pt.nav.openApp}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* Workflow */}
      <section className="bg-[#F4F3EE] px-6 py-16 border-y border-[#E5E5E0]">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-10">{c.workflowHeading}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
            {c.steps.map((step, i) => (
              <div key={i} className="flex gap-4">
                <span className="font-mono text-sm text-[#525252] leading-none shrink-0 mt-1.5 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="font-serif text-xl text-[#111111] mb-2 font-medium">{step.title}</h3>
                  <p className="text-sm text-[#525252] leading-relaxed">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What it catches */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-4">{c.catchesHeading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-6">{c.catchesIntro}</p>
          <ul className="space-y-3">
            {c.catches.map((item, i) => (
              <li key={i} className="flex gap-3">
                <Check className="w-4 h-4 text-[#111111] shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-sm text-[#111111] leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Honest scope */}
      <section className="bg-[#F4F3EE] px-6 py-16 border-y border-[#E5E5E0]">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <Scale className="w-5 h-5 text-[#111111]" strokeWidth={1.5} />
            <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight">{c.scopeHeading}</h2>
          </div>
          <p className="text-sm text-[#525252] leading-relaxed mb-6">{c.scopeIntro}</p>
          <ul className="divide-y divide-[#E5E5E0] border-y border-[#E5E5E0]">
            {c.scope.map((item, i) => (
              <li key={i} className="py-4 text-sm text-[#525252] leading-relaxed">{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Proof */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto border border-[#111111] bg-[#FFFFFF] p-6 md:p-8">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="w-5 h-5 text-[#111111]" strokeWidth={1.5} />
            <h2 className="font-serif text-2xl text-[#111111] font-medium tracking-tight">{c.proofHeading}</h2>
          </div>
          <p className="text-sm text-[#111111] leading-relaxed">{c.proofBody}</p>
          <p className="mt-4 text-xs text-[#525252] leading-relaxed border-t border-[#E5E5E0] pt-4">{c.proofNote}</p>
          <a
            href="https://github.com/WLojek/DocCloak"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111] hover:underline decoration-[#CC0000] decoration-2 underline-offset-4"
          >
            GitHub · AGPL-3.0
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <a
            href="#/"
            className="pressable inline-flex items-center gap-2 px-8 py-4 bg-[#111111] text-[#F9F9F7] text-sm font-semibold hover:bg-[#222222] transition-colors"
          >
            {pt.nav.openApp}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>
    </PageShell>
  );
}
