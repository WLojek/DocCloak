import { useState } from 'react';
import { Scale, Briefcase, Stethoscope, Users, Lock, ShieldCheck, Eye, ChevronDown, ArrowDown } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { RotatingWord } from './RotatingWord.tsx';

export function Hero({ onScrollToTool }: { onScrollToTool: () => void }) {
  const { t } = useTranslation();
  const h = t.landing.hero;
  return (
    <section className="bg-[#F9F9F7] px-6 pt-16 pb-20">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl leading-[1.15] tracking-tight text-[#111111] font-medium max-w-5xl mx-auto">
          {h.titleBefore} <br className="hidden md:block" />
          {/* The rotating PII noun sits inside a censor bar: the product's own
              device. On wide screens the clause is one unbreakable unit so the
              bar's width animation can never re-wrap the headline. On narrow
              screens the longest words (Polish, French) cannot share a line
              with the prefix, so the bar gets a line of its own instead - the
              width animation still never moves a break point, and RotatingWord
              scales itself down if even a full line is too narrow. */}
          <span className="lg:whitespace-nowrap">
            {h.titleEm}{' '}
            {h.titleAfterPrefix}
            <br className="lg:hidden" />
            <RotatingWord
              words={h.titleRotating}
              className="text-[#F9F9F7] px-3 pb-1"
            />
            {h.titleAfter}
          </span>
        </h1>
        <p className="mt-7 text-lg md:text-xl text-[#525252] leading-relaxed max-w-3xl mx-auto">
          {h.subtitle}
          <span className="block mt-1 text-[#111111] font-medium">{h.subtitleEmphasis}</span>
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={onScrollToTool}
            className="pressable group inline-flex items-center gap-2 px-8 py-4 bg-[#111111] text-[#F9F9F7] text-sm font-semibold hover:bg-[#222222] transition-colors cursor-pointer"
          >
            {h.ctaTry}
            <ArrowDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
          </button>
          <a
            href="#how-it-works"
            className="pressable inline-flex items-center gap-1.5 px-8 py-4 border border-[#111111] text-[#111111] text-sm font-semibold hover:bg-[#111111] hover:text-[#F9F9F7] transition-colors cursor-pointer"
          >
            {h.ctaSeeHow}
          </a>
        </div>
      </div>
    </section>
  );
}

export function TrustBand() {
  const { t } = useTranslation();
  const h = t.landing.hero;
  return (
    <section className="bg-[#F9F9F7] border-t border-[#E5E5E0] px-6 py-5">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-xs text-[#525252]">
        <span className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />
          {h.trustBrowser}
        </span>
        <a
          href="https://github.com/WLojek/DocCloak"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 hover:text-[#111111] hover:underline underline-offset-4 transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          {h.trustOpenSource}
        </a>
        <span className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5" />
          {h.trustNoTracking}
        </span>
      </div>
    </section>
  );
}

export function Audience() {
  const { t } = useTranslation();
  const a = t.landing.audience;
  const cards = [
    { icon: Scale, title: a.lawyersTitle, body: a.lawyersBody },
    { icon: Briefcase, title: a.consultantsTitle, body: a.consultantsBody },
    { icon: Stethoscope, title: a.healthcareTitle, body: a.healthcareBody },
    { icon: Users, title: a.hrTitle, body: a.hrBody },
  ];
  return (
    <section className="bg-[#F4F3EE] px-6 py-20 border-y border-[#E5E5E0]">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-center font-serif text-3xl md:text-4xl text-[#111111] mb-12 font-medium tracking-tight">
          {a.heading}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {cards.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-[#F9F9F7] border border-[#E5E5E0] p-6 hover:border-[#111111] transition-colors duration-150"
            >
              <div className="flex items-center gap-3 mb-3">
                <Icon className="w-5 h-5 text-[#111111] shrink-0" strokeWidth={1.5} />
                <h3 className="font-serif text-xl text-[#111111] font-medium">{title}</h3>
              </div>
              <p className="text-sm text-[#525252] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { t } = useTranslation();
  const h = t.landing.howItWorks;
  const steps = [
    { n: '01', title: h.step1Title, body: h.step1Body },
    { n: '02', title: h.step2Title, body: h.step2Body },
    { n: '03', title: h.step3Title, body: h.step3Body },
    { n: '04', title: h.step4Title, body: h.step4Body },
  ];
  return (
    <section id="how-it-works" className="bg-[#F9F9F7] px-6 py-20">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-center font-serif text-3xl md:text-4xl text-[#111111] mb-14 font-medium tracking-tight">
          {h.heading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
          {steps.map(({ n, title, body }) => (
            <div key={n} className="flex gap-4">
              <span className="font-mono text-sm text-[#525252] leading-none shrink-0 mt-1.5 tabular-nums">{n}</span>
              <div>
                <h3 className="font-serif text-xl text-[#111111] mb-2 font-medium">{title}</h3>
                <p className="text-sm text-[#525252] leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FAQ() {
  const { t } = useTranslation();
  const f = t.landing.faq;
  const items = [
    { q: f.q1, a: f.a1 },
    { q: f.q2, a: f.a2 },
    { q: f.q3, a: f.a3 },
    { q: f.q4, a: f.a4 },
    { q: f.q5, a: f.a5 },
    { q: f.q6, a: f.a6 },
  ];
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <section className="bg-[#F4F3EE] px-6 py-20 border-t border-[#E5E5E0]">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-center font-serif text-3xl md:text-4xl text-[#111111] mb-12 font-medium tracking-tight">
          {f.heading}
        </h2>
        <div className="divide-y divide-[#E5E5E0] border-y border-[#E5E5E0]">
          {items.map((item, i) => {
            const open = openIdx === i;
            return (
              <div key={i}>
                <button
                  onClick={() => setOpenIdx(open ? null : i)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer group"
                >
                  <span className="font-serif text-lg text-[#111111] font-medium group-hover:underline decoration-[#CC0000] decoration-2 underline-offset-4">{item.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#525252] shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                <div
                  className="grid transition-all duration-300 ease-in-out"
                  style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <p className="pb-5 pr-8 text-sm text-[#525252] leading-relaxed">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
