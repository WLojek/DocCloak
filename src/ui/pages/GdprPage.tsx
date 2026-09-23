import { ArrowRight, BookOpen, Info, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { getPagesTranslations } from '../../i18n/pages/index.ts';
import { PageShell } from './PageShell.tsx';

export function GdprPage() {
  const { language } = useTranslation();
  const g = getPagesTranslations(language).gdpr;

  return (
    <PageShell title={`${g.title} · DocCloak`}>
      {/* Hero */}
      <section className="bg-[#F9F9F7] px-6 pt-16 pb-12">
        <div className="max-w-3xl mx-auto">
          <p className="label-meta text-[#CC0000] mb-4">{g.eyebrow}</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.15] tracking-tight text-[#111111] font-medium">
            {g.title}
          </h1>
          <p className="mt-6 text-lg text-[#525252] leading-relaxed">{g.intro}</p>
        </div>
      </section>

      {/* Not legal advice */}
      <section className="bg-[#F9F9F7] px-6 pb-12">
        <div className="max-w-3xl mx-auto border border-[#111111] bg-[#F4F3EE] p-5">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-[#111111] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#111111]">{g.disclaimerTitle}</p>
              <p className="text-sm text-[#525252] leading-relaxed mt-1.5">{g.disclaimerBody}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture + verify */}
      <section className="bg-[#F4F3EE] px-6 py-16 border-y border-[#E5E5E0]">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-4">{g.archHeading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed">{g.archBody}</p>
          <div className="mt-8 bg-[#F9F9F7] border border-[#E5E5E0] p-6">
            <div className="flex items-center gap-3 mb-4">
              <ShieldCheck className="w-5 h-5 text-[#111111]" strokeWidth={1.5} />
              <h3 className="font-serif text-xl text-[#111111] font-medium">{g.verifyHeading}</h3>
            </div>
            <ol className="space-y-3">
              {g.verifySteps.map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="font-mono text-sm text-[#525252] leading-none shrink-0 mt-0.5 tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-sm text-[#525252] leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Mapping */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-4">{g.mapHeading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-8">{g.mapIntro}</p>
          <div className="space-y-5">
            {g.mappings.map((m, i) => (
              <article key={i} className="border border-[#E5E5E0] bg-[#FFFFFF] hover:border-[#111111] transition-colors duration-150">
                <div className="px-5 py-4 border-b border-[#E5E5E0]">
                  <p className="label-meta text-[#CC0000]">{m.concept}</p>
                  <h3 className="font-serif text-lg text-[#111111] font-medium mt-1.5 leading-snug">{m.fact}</h3>
                </div>
                <p className="px-5 py-4 text-sm text-[#525252] leading-relaxed">{m.explanation}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* DPIA */}
      <section className="bg-[#F4F3EE] px-6 py-16 border-y border-[#E5E5E0]">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-4">{g.dpiaHeading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-6">{g.dpiaIntro}</p>
          <ul className="space-y-3">
            {g.dpiaPoints.map((p, i) => (
              <li key={i} className="flex gap-3 bg-[#F9F9F7] border border-[#E5E5E0] px-4 py-3">
                <span className="w-2 h-2 bg-[#111111] shrink-0 mt-1.5" aria-hidden="true" />
                <p className="text-sm text-[#111111] leading-relaxed">{p}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-[#525252] leading-relaxed">{g.dpiaOutro}</p>
        </div>
      </section>

      {/* Honest limits */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-4">{g.limitsHeading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-6">{g.limitsIntro}</p>
          <ul className="divide-y divide-[#E5E5E0] border-y border-[#E5E5E0]">
            {g.limits.map((l, i) => (
              <li key={i} className="py-4 text-sm text-[#525252] leading-relaxed">{l}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* References */}
      <section className="bg-[#F4F3EE] px-6 py-12 border-y border-[#E5E5E0]">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <BookOpen className="w-4 h-4 text-[#111111]" strokeWidth={1.5} />
            <h2 className="font-serif text-xl text-[#111111] font-medium">{g.refsHeading}</h2>
          </div>
          <p className="text-xs text-[#525252] leading-relaxed mb-3">{g.refsIntro}</p>
          <ul className="space-y-2">
            {g.refs.map((r, i) => (
              <li key={i} className="text-xs text-[#525252] leading-relaxed">{r}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-3">{g.ctaHeading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-8 max-w-xl mx-auto">{g.ctaBody}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#/"
              className="pressable inline-flex items-center gap-2 px-8 py-4 bg-[#111111] text-[#F9F9F7] text-sm font-semibold hover:bg-[#222222] transition-colors"
            >
              {g.ctaApp}
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#/for/lawyers"
              className="pressable inline-flex items-center px-8 py-4 border border-[#111111] text-[#111111] text-sm font-semibold hover:bg-[#111111] hover:text-[#F9F9F7] transition-colors"
            >
              {g.ctaUseCases}
            </a>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
