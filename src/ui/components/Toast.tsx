import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastData {
  id: number;
  message: string;
  action?: ToastAction;
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: string, action?: ToastAction) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, action }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 bg-[#111111] text-[#F9F9F7] px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] animate-toast-in"
          >
            <span className="text-xs font-sans font-medium uppercase tracking-wider">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className="text-xs font-sans font-bold uppercase tracking-wider text-[#CC0000] hover:text-[#FF3333] transition-colors cursor-pointer ml-2"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="text-[#F9F9F7]/50 hover:text-[#F9F9F7] transition-colors cursor-pointer ml-1"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
