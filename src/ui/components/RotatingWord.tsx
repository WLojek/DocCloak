import { useEffect, useRef, useState } from 'react';

const ROTATE_INTERVAL_MS = 2600;

/** Room left next to the bar for the clause's trailing punctuation, so the
 *  period never wraps onto a line of its own. */
const TRAILING_RESERVE_PX = 28;

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Nearest ancestor that establishes a line box width (skips inline spans,
 *  whose clientWidth is 0). */
function nearestBlockWidth(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node && getComputedStyle(node).display === 'inline') {
    node = node.parentElement;
  }
  return node?.clientWidth ?? 0;
}

/**
 * Cycles the PII noun in the hero headline. The censor bar hugs the active
 * word and animates its width between words; words swap with a short upward
 * slide + crossfade. Layout stability comes from the parent: the headline
 * keeps the bar clause on its own short line, so the bar's width change never
 * re-wraps the headline. On narrow screens the longest word can exceed the
 * viewport (Polish "numerow telefonow", French "numeros de telephone"), so
 * the component scales its own font-size down just enough for the widest
 * word to fit the containing block. Screen readers get the first word only -
 * the rotation is a visual explanation, not content.
 */
export function RotatingWord({
  words,
  className = '',
}: {
  words: string[];
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  // Word widths at scale 1, and the fit scale applied via font-size.
  const [rawWidths, setRawWidths] = useState<number[]>([]);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const outerRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Widths depend on the loaded display font and the responsive font size, so
  // measure after mount, after fonts resolve, and on resize. Measured widths
  // are read at the currently applied scale and normalized back to scale 1,
  // so measuring never has to touch the DOM font-size directly.
  useEffect(() => {
    setActive(0);
    wordRefs.current.length = words.length;
    let frame = 0;
    const measure = () => {
      const currentScale = scaleRef.current || 1;
      const raw = wordRefs.current.map(
        (el) => (el?.offsetWidth ?? 0) / currentScale,
      );
      setRawWidths(raw);
      const outer = outerRef.current;
      if (!outer) return;
      const style = getComputedStyle(outer);
      const padX =
        (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) /
        currentScale;
      const avail = nearestBlockWidth(outer) - TRAILING_RESERVE_PX;
      const needed = Math.max(...raw, 0) + padX;
      setScale(needed > 0 && avail > 0 ? Math.min(1, avail / needed) : 1);
    };
    measure();
    document.fonts.ready.then(measure).catch(() => {});
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, [words]);

  useEffect(() => {
    if (reduced || words.length < 2) return;
    const id = setInterval(
      () => setActive((i) => (i + 1) % words.length),
      ROTATE_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [reduced, words.length]);

  const fontSize = scale < 1 ? `${scale}em` : undefined;

  if (reduced || words.length < 2)
    return (
      <span
        ref={outerRef}
        className={`relative inline-block align-baseline max-w-full ${className}`}
        style={{ fontSize }}
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-[0.05em] bottom-0 bg-[#111111]" />
        <span
          ref={(el) => {
            wordRefs.current[0] = el;
          }}
          className="relative whitespace-nowrap"
        >
          {words[0]}
        </span>
      </span>
    );

  const prev = (active + words.length - 1) % words.length;
  const activeWidth = rawWidths[active] ? rawWidths[active] * scale : 0;

  return (
    <span
      ref={outerRef}
      className={`relative inline-block align-baseline max-w-full ${className}`}
      style={{ fontSize }}
    >
      {/* The bar is its own layer so its top can sit just above the letters
          instead of covering the full line box, which would crowd the line
          above. Words render in the positioned clip layer after it, so they
          paint on top. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-[0.05em] bottom-0 bg-[#111111]" />
      <span className="sr-only">{words[0]}</span>
      <span
        aria-hidden="true"
        className="relative inline-block whitespace-nowrap align-baseline select-none max-w-full"
        style={{
          width: activeWidth ? `${activeWidth}px` : undefined,
          transition: 'width 350ms cubic-bezier(0.77, 0, 0.175, 1)',
        }}
      >
        {/* Invisible in-flow copy keeps the container's height, baseline, and
            pre-measurement width. Overflow must stay visible here: an
            inline-block with hidden overflow baseline-aligns its bottom edge,
            which lifts the text. */}
        <span className="invisible">{words[active]}</span>
        {/* Clipping lives on an absolute layer instead - absolutes do not
            participate in baseline alignment. */}
        <span className="absolute inset-0 overflow-hidden">
          {words.map((word, i) => (
            <span
              key={word}
              ref={(el) => {
                wordRefs.current[i] = el;
              }}
              className="absolute left-0 top-0 whitespace-nowrap"
              style={{
                opacity: i === active ? 1 : 0,
                transform:
                  i === active
                    ? 'translateY(0)'
                    : i === prev
                      ? 'translateY(-0.55em)'
                      : 'translateY(0.55em)',
                transition:
                  'transform 300ms cubic-bezier(0.23, 1, 0.32, 1), opacity 300ms cubic-bezier(0.23, 1, 0.32, 1)',
              }}
            >
              {word}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
