import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastData {
  id: number;
  message: string;
  action?: ToastAction;
  exiting?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/** Height of the strip at the bottom of the window that a stack of toasts can cover. */
const TOAST_BAND = 260;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const idRef = useRef(0);

  // Where the last press was (pointer, or the focused control for the keyboard), to keep clear of it.
  const [atTop, setAtTop] = useState(false);
  const lastPressY = useRef<number | null>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => { lastPressY.current = event.clientY; };
    const onKey = () => {
      const focused = document.activeElement;
      lastPressY.current = focused && focused !== document.body ? focused.getBoundingClientRect().top : null;
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const showToast = useCallback((message: string, action?: ToastAction) => {
    const id = ++idRef.current;
    setAtTop(lastPressY.current !== null && lastPressY.current > window.innerHeight - TOAST_BAND);
    // The same message again replaces the one on screen instead of stacking under it.
    setToasts((prev) => [...prev.filter((toast) => toast.message !== message), { id, message, action }]);
    // Action-bearing toasts (Undo) stay long enough to actually be used.
    // Timed exits leave the same way they entered: fade + slide toward the bottom edge.
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 200);
      // A full sentence needs longer than a two-word confirmation: about 65 ms a character.
    }, Math.max(action ? 10000 : 3000, message.length * 65));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* bottom-32 clears the sticky Redact bar so Undo is never hidden behind it. When the control
          that was just pressed sits in that band, the toast goes to the top instead: it used to lie
          over the pressed button and the one that takes its place (measured on a phone). */}
      <div role="status" aria-live="polite" data-testid="toasts" className={`fixed ${atTop ? 'top-20' : 'bottom-32'} inset-x-0 px-4 z-[100] flex flex-col items-center gap-2 pointer-events-none`}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto max-w-full md:max-w-xl flex flex-wrap md:flex-nowrap items-center justify-end gap-x-3 bg-[#111111] text-[#F9F9F7] px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] animate-toast-in transition-[opacity,transform] duration-200 ease-out ${
              toast.exiting ? 'opacity-0 translate-y-3' : ''
            }`}
          >
            {/* Sentence case: a toast can be a full sentence about what stays readable, and
                capitals with wide tracking made those hard to read on a phone. */}
            {/* On a narrow screen a long button goes under the text instead of squeezing it into a
                column one word wide. */}
            <span className="text-xs font-sans font-medium leading-snug min-w-[60%] md:min-w-0 flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className="shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 md:min-h-6 md:min-w-0 text-xs font-sans font-bold uppercase tracking-wider text-[#FF3333] hover:text-[#FF6666] transition-colors cursor-pointer ml-2"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 inline-flex items-center justify-center w-11 h-11 -my-2 -mr-3 md:w-6 md:h-6 md:m-0 md:ml-1 text-[#F9F9F7]/70 hover:text-[#F9F9F7] transition-colors cursor-pointer"
              aria-label={t.toast.dismiss}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
