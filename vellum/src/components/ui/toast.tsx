"use client";

/**
 * Toasts — the replacement for window.alert and for confirm-on-delete.
 * Info/success auto-dismiss and announce politely; errors persist until
 * dismissed and announce assertively. An `action` (Undo/Retry) extends the
 * lifetime, per the snackbar convention.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icon";
import { cx } from "./primitives";

export type ToastTone = "info" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Action button — its presence extends the visible duration. */
  action?: { label: string; onClick: () => void };
  /** Override the auto-dismiss (ms). 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
  tone: ToastTone;
}

const ToastContext = createContext<(options: ToastOptions) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const TONE_ICON: Record<ToastTone, IconName> = {
  info: "info",
  success: "success",
  error: "error",
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const schedule = useCallback(
    (toast: ToastRecord) => {
      if (toast.tone === "error" && toast.duration === undefined) return;
      const ms =
        toast.duration ?? (toast.action ? 6000 : toast.description ? 4500 : 3000);
      if (ms <= 0) return;
      timers.current.set(
        toast.id,
        setTimeout(() => dismiss(toast.id), ms),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (options: ToastOptions) => {
      const toast: ToastRecord = {
        ...options,
        tone: options.tone ?? "info",
        id: nextId.current++,
      };
      setToasts((list) => [...list, toast].slice(-MAX_VISIBLE));
      schedule(toast);
    },
    [schedule],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      style={{ zIndex: 80 }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          className="popover anim-in pointer-events-auto flex items-start gap-3 p-3"
        >
          <Icon
            name={TONE_ICON[toast.tone]}
            size={16}
            className={cx(
              "mt-px shrink-0",
              toast.tone === "error" && "text-danger",
              toast.tone === "success" && "text-success",
              toast.tone === "info" && "text-ink-3",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="t-body font-medium">{toast.title}</p>
            {toast.description && (
              <p className="t-caption mt-0.5 text-ink-2">{toast.description}</p>
            )}
            {toast.action && (
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="btn btn-icon btn-ghost btn-sm shrink-0"
            onClick={() => onDismiss(toast.id)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
