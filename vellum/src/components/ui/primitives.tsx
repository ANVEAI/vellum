"use client";

/**
 * Chrome control vocabulary. Every screen composes these instead of
 * hand-rolling Tailwind, so spacing, height, focus and disabled states stay
 * identical everywhere. Styling lives in src/styles/controls.css.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icon";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** useLayoutEffect that doesn't warn during server rendering. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ------------------------------ Button ------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconEnd,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
}) {
  return (
    <button
      type="button"
      className={cx(
        "btn",
        `btn-${variant}`,
        size !== "md" && `btn-${size}`,
        !children && "btn-icon",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={size === "sm" ? 14 : 16} />}
    </button>
  );
}

/** Icon-only button. `label` is required — it becomes the accessible name. */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  className,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("btn btn-icon", `btn-${variant}`, size !== "md" && `btn-${size}`, className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
}

/* ------------------------- SegmentedControl ------------------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Radio-group semantics + arrow-key navigation (replaces click-to-cycle). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(options[(i + 1) % options.length].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(options[(i - 1 + options.length) % options.length].value);
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("segmented", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="segmented-item"
            onClick={() => onChange(option.value)}
          >
            {option.icon && <Icon name={option.icon} size={14} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ Switch ------------------------------ */

export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

/* ------------------------------- Field ------------------------------ */

/** Label + control + optional description/error, always properly bound. */
export function Field({
  label,
  description,
  error,
  children,
  className,
}: {
  label: string;
  description?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const descId = description || error ? `${id}-desc` : undefined;
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="t-label mb-1.5 block text-ink-2">
        {label}
      </label>
      {children({ id, "aria-describedby": descId })}
      {(description || error) && (
        <p
          id={descId}
          className={cx("t-caption mt-1.5", error ? "text-danger" : "text-ink-3")}
        >
          {error || description}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ Popover ----------------------------- */

/**
 * Anchored popover: outside-click + Escape close, focus restore.
 *
 * The menu is portalled to <body> and positioned as `fixed`. Rendering it
 * inside the trigger meant any ancestor with `overflow: hidden` clipped it —
 * on the dashboard, cards clip their thumbnail corners, so the card menu was
 * cut to its first item and Delete/Rename/Export were unreachable. Fixed
 * positioning also lets the menu flip above the trigger near the viewport
 * bottom instead of running off-screen.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  width = 260,
  label,
}: {
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    ref: React.Ref<HTMLButtonElement>;
  }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  width?: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const margin = 8;
    const gap = 6;
    const menuHeight = menuRef.current?.scrollHeight ?? 0;
    const roomBelow = window.innerHeight - anchor.bottom - gap - margin;
    const roomAbove = anchor.top - gap - margin;
    // Flip up only when it genuinely helps.
    const flip = menuHeight > roomBelow && roomAbove > roomBelow;
    const maxHeight = Math.max(120, Math.min(460, flip ? roomAbove : roomBelow));
    const height = Math.min(menuHeight || maxHeight, maxHeight);
    const top = flip ? anchor.top - gap - height : anchor.bottom + gap;
    const rawLeft = align === "end" ? anchor.right - width : anchor.left;
    const left = Math.min(
      Math.max(margin, rawLeft),
      Math.max(margin, window.innerWidth - width - margin),
    );
    setPlacement({ left, top, maxHeight });
  }, [align, width]);

  // Measure after the menu exists so its real height drives the flip.
  useIsomorphicLayoutEffect(() => {
    if (open) place();
    else setPlacement(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    // A fixed menu cannot follow a scrolling anchor, so close instead of drift.
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  return (
    <>
      {trigger({
        onClick: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-haspopup": "menu",
        ref: triggerRef,
      })}
      {mounted &&
        open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="popover anim-pop scroll-thin fixed overflow-y-auto"
            style={{
              width,
              left: placement?.left ?? -9999,
              top: placement?.top ?? -9999,
              maxHeight: placement?.maxHeight ?? 460,
              visibility: placement ? "visible" : "hidden",
              zIndex: "var(--z-popover)" as unknown as number,
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  danger,
  checked,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      // A checkable item must advertise a checkable role, or the state is
      // dropped by assistive tech.
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={cx("menu-item", danger && "menu-item-danger")}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} className="shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="kbd">{shortcut}</span>}
      {checked && <Icon name="check" size={14} className="shrink-0" />}
    </button>
  );
}

/* --------------------------- Dialog / Drawer ------------------------ */

function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusables = ref.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    // Focus the first control so keyboard users land inside the overlay.
    requestAnimationFrame(() => {
      ref.current
        ?.querySelector<HTMLElement>(
          'input:not(:disabled), textarea, button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);
  return ref;
}

function OverlayPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div style={{ position: "relative", zIndex: 60 }}>{children}</div>,
    document.body,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const ref = useOverlay(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <OverlayPortal>
      <div className="scrim grid place-items-center p-6" onMouseDown={onClose}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="dialog w-full p-5"
          style={{ maxWidth: width }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h2 id={titleId} className="t-emph font-semibold">
            {title}
          </h2>
          {description && <p className="t-body mt-1.5 text-ink-2">{description}</p>}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </div>
      </div>
    </OverlayPortal>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const ref = useOverlay(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <OverlayPortal>
      <div className="scrim flex justify-end" onMouseDown={onClose}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="drawer flex h-full w-full max-w-full flex-col"
          style={{ width }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="hairline-b flex items-center justify-between px-5 py-3">
            <div className="min-w-0">
              <h2 id={titleId} className="t-emph font-semibold">
                {title}
              </h2>
              {subtitle && <p className="t-caption mt-0.5 text-ink-3">{subtitle}</p>}
            </div>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>
          <div className="scroll-thin flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <footer className="hairline-t flex gap-2 px-5 py-3">{footer}</footer>}
        </div>
      </div>
    </OverlayPortal>
  );
}

/* ---------------------------- Confirm hook -------------------------- */

interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<
  (opts: Omit<ConfirmRequest, "resolve">) => Promise<boolean>
>(async () => false);

/** Replaces window.confirm for irreversible, destructive actions. */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback(
    (opts: Omit<ConfirmRequest, "resolve">) =>
      new Promise<boolean>((resolve) => setRequest({ ...opts, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => settle(false)}
        title={request?.title ?? ""}
        description={request?.description}
        footer={
          <>
            <Button onClick={() => settle(false)}>Cancel</Button>
            <Button
              variant={request?.danger ? "danger" : "primary"}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

/* ----------------------------- Feedback ----------------------------- */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cx("skeleton", className)} style={style} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-sm py-16 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-[10px] bg-accent-soft text-ink-2">
        <Icon name={icon} size={20} />
      </div>
      <h2 className="t-emph mt-4 font-semibold">{title}</h2>
      {description && <p className="t-body mt-1.5 text-ink-2">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px] opacity-60"
      style={{ width: size, height: size }}
    />
  );
}
