import { ArrowRight, Check, Eye, FileText, Infinity as InfinityIcon, Lock, ShieldCheck } from 'lucide-react';
import { plLanding } from '../../i18n/pages/index.ts';
import { PageShell } from './PageShell.tsx';

const TRUST_ICONS = [Lock, ShieldCheck, Eye, InfinityIcon];

/**
 * Polish-language landing page (route #/pl). Native Polish copy for the
 * Polish market; the page body does not follow the UI language on purpose,
 * so the shell is pinned to pl as well.
 */
export function PolishLanding() {
  const c = plLanding;
  return (
    <PageShell title={c.metaTitle} forceLang="pl">
      {/* Hero */}
      <section className="bg-[#F9F9F7] px-6 pt-16 pb-16">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl leading-[1.15] tracking-tight text-[#111111] font-medium">
            {c.hero.title1}
            <br />
            <span className="bg-[#111111] text-[#F9F9F7] px-3 pb-1 box-decoration-clone">{c.hero.titleMark}</span>{' '}
            {c.hero.title2}
          </h1>
          <p className="mt-7 text-lg md:text-xl text-[#525252] leading-relaxed max-w-3xl mx-auto">
            {c.hero.subtitle}
            <span className="block mt-1 text-[#111111] font-medium">{c.hero.emphasis}</span>
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#/"
              className="pressable inline-flex items-center gap-2 px-8 py-4 bg-[#111111] text-[#F9F9F7] text-sm font-semibold hover:bg-[#222222] transition-colors"
            >
              {c.hero.ctaApp}
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#/gdpr"
              className="pressable inline-flex items-center px-8 py-4 border border-[#111111] text-[#111111] text-sm font-semibold hover:bg-[#111111] hover:text-[#F9F9F7] transition-colors"
            >
              {c.hero.ctaGdpr}
            </a>
          </div>
        </div>
      </section>

      {/* Trust band */}
      <section className="bg-[#F9F9F7] border-t border-[#E5E5E0] px-6 py-5">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-xs text-[#525252]">
          {c.trust.map((item, i) => {
            const Icon = TRUST_ICONS[i % TRUST_ICONS.length];
            return (
              <span key={i} className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5" />
                {item}
              </span>
            );
          })}
        </div>
      </section>

      {/* Before / after demo */}
      <section className="bg-[#F4F3EE] px-6 py-16 border-y border-[#E5E5E0]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-center font-serif text-3xl md:text-4xl text-[#111111] mb-10 font-medium tracking-tight">
            {c.demo.heading}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border border-[#C8C5BC] bg-[#FFFFFF]">
            <div className="md:border-r border-b md:border-b-0 border-[#C8C5BC] flex flex-col">
              <div className="px-4 py-2.5 border-b border-[#C8C5BC] bg-[#F4F3EE] flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-[#525252]" />
                <span className="label-meta text-[#525252]">{c.demo.beforeLabel}</span>
              </div>
              <p className="p-5 text-sm text-[#111111] leading-relaxed font-mono">{c.demo.before}</p>
            </div>
            <div className="flex flex-col">
              <div className="px-4 py-2.5 border-b border-[#C8C5BC] bg-[#F4F3EE] flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-[#525252]" />
                <span className="label-meta text-[#525252]">{c.demo.afterLabel}</span>
              </div>
              <p className="p-5 text-sm text-[#111111] leading-relaxed font-mono">{c.demo.after}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-[#525252] leading-relaxed text-center max-w-2xl mx-auto">{c.demo.caption}</p>
        </div>
      </section>

      {/* Polish document coverage */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl md:text-4xl text-[#111111] font-medium tracking-tight mb-4">
            {c.polish.heading}
          </h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-6">{c.polish.intro}</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {c.polish.items.map((item, i) => (
              <li key={i} className="flex gap-3">
                <Check className="w-4 h-4 text-[#111111] shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-sm text-[#111111] leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-[#525252] leading-relaxed">{c.polish.outro}</p>
        </div>
      </section>

      {/* Benchmark */}
      <section className="bg-[#111111] px-6 py-16">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-[auto_1fr] gap-x-12 gap-y-8 items-center">
          <div className="text-center md:text-left">
            <p className="font-serif text-6xl md:text-7xl text-[#F9F9F7] font-medium tracking-tight tabular-nums">
              {c.benchmark.stat}
            </p>
            <p className="label-meta text-[#F9F9F7]/70 mt-2 max-w-[16rem]">{c.benchmark.statLabel}</p>
          </div>
          <div>
            <h2 className="font-serif text-2xl text-[#F9F9F7] font-medium tracking-tight mb-3">
              {c.benchmark.heading}
            </h2>
            <p className="text-sm text-[#F9F9F7]/80 leading-relaxed">{c.benchmark.body}</p>
            <p className="mt-4 text-xs text-[#F9F9F7]/50 leading-relaxed">{c.benchmark.footnote}</p>
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="bg-[#F4F3EE] px-6 py-16 border-b border-[#E5E5E0]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-center font-serif text-3xl md:text-4xl text-[#111111] mb-12 font-medium tracking-tight">
            {c.audience.heading}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {c.audience.cards.map((card) => (
              <a
                key={card.href}
                href={card.href}
                className="block bg-[#F9F9F7] border border-[#E5E5E0] p-6 hover:border-[#111111] transition-colors duration-150 group"
              >
                <h3 className="font-serif text-xl text-[#111111] font-medium mb-3">{card.title}</h3>
                <p className="text-sm text-[#525252] leading-relaxed">{card.body}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111] group-hover:underline decoration-[#CC0000] decoration-2 underline-offset-4">
                  {card.linkLabel}
                  <ArrowRight className="w-3 h-3" />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* RODO */}
      <section className="bg-[#F9F9F7] px-6 py-16">
        <div className="max-w-3xl mx-auto border border-[#111111] bg-[#F4F3EE] p-6 md:p-8">
          <div className="flex items-center gap-3 mb-3">
            <ShieldCheck className="w-5 h-5 text-[#111111]" strokeWidth={1.5} />
            <h2 className="font-serif text-2xl text-[#111111] font-medium tracking-tight">{c.rodo.heading}</h2>
          </div>
          <p className="text-sm text-[#525252] leading-relaxed">{c.rodo.body}</p>
          <a
            href="#/gdpr"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111] hover:underline decoration-[#CC0000] decoration-2 underline-offset-4"
          >
            {c.rodo.linkLabel}
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#F9F9F7] px-6 pb-16">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-3xl text-[#111111] font-medium tracking-tight mb-3">{c.cta.heading}</h2>
          <p className="text-sm text-[#525252] leading-relaxed mb-8 max-w-xl mx-auto">{c.cta.body}</p>
          <a
            href="#/"
            className="pressable inline-flex items-center gap-2 px-8 py-4 bg-[#111111] text-[#F9F9F7] text-sm font-semibold hover:bg-[#222222] transition-colors"
          >
            {c.cta.app}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>
    </PageShell>
  );
}
