"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FieldHintModeProvider } from "@/components/forms/shared";

/**
 * The per-card settings popover, opened from the gear in a card header.
 *
 * Available outside edit mode as well: changing how a card displays is ordinary use, not a
 * layout operation, and making someone enter edit mode to set a row count would be busywork.
 */
export function CardSettingsPopover({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const close = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Scrolling or a resize moves the anchor, so the panel follows it rather than closing:
    // the dashboard's cards stream in above one another, and the scroll anchoring that keeps
    // the page still while they do fires scroll events nobody made.
    // The panel's own scrolling (a long one, capped to the screen) is not the page moving.
    const onScroll = (event: Event) => {
      if (event.type === "scroll" && panelRef.current?.contains(event.target as Node)) return;
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (anchor) setRect(anchor);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    if (next) setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen(next);
  };

  const panel =
    open && rect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`${title} settings`}
            className="fixed z-[75] w-[min(92vw,20rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl"
            style={{
              ...panelVerticalPlacement(rect, window.innerHeight),
              // Keep the panel on screen when the card sits near the right edge.
              left: Math.max(8, Math.min(rect.right - 320, window.innerWidth - 328)),
            }}
          >
            <p className="mb-2 text-sm font-semibold text-slate-100">{title} settings</p>
            {/*
              ExpenseForm wraps itself in mode="info", which folds every labelled field's
              hint behind a "?". Re-providing "inline" here keeps this panel's own labels
              readable regardless of where in the tree it ends up rendering.
            */}
            <FieldHintModeProvider mode="inline">
              <div className="flex flex-col gap-3">{children}</div>
            </FieldHintModeProvider>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={`${title} settings`}
        title={`${title} settings`}
        className="rounded-lg border border-slate-700/80 bg-slate-900/90 p-1.5 text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M10 6.5A3.5 3.5 0 1 0 10 13.5 3.5 3.5 0 0 0 10 6.5Zm0 5.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
          <path d="m17.3 11.4-.7-.4a6.8 6.8 0 0 0 0-2l.7-.4a1.3 1.3 0 0 0 .5-1.7l-.6-1a1.3 1.3 0 0 0-1.7-.5l-.7.4a6.8 6.8 0 0 0-1.7-1V3.9c0-.7-.6-1.3-1.3-1.3h-1.2c-.7 0-1.3.6-1.3 1.3v.8a6.8 6.8 0 0 0-1.7 1l-.7-.4a1.3 1.3 0 0 0-1.7.5l-.6 1a1.3 1.3 0 0 0 .5 1.7l.7.4a6.8 6.8 0 0 0 0 2l-.7.4a1.3 1.3 0 0 0-.5 1.7l.6 1c.4.6 1.1.8 1.7.5l.7-.4c.5.4 1.1.8 1.7 1v.8c0 .7.6 1.3 1.3 1.3h1.2c.7 0 1.3-.6 1.3-1.3v-.8a6.8 6.8 0 0 0 1.7-1l.7.4c.6.3 1.3.1 1.7-.5l.6-1a1.3 1.3 0 0 0-.5-1.7Z" />
        </svg>
      </button>
      {panel}
    </>
  );
}

/** A labelled row of mutually exclusive choices — the shape most card settings take. */
export function SettingChoiceRow<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-200">{label}</span>
      {hint ? <span className="text-xs leading-snug text-slate-500">{hint}</span> : null}
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              value === option.value
                ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40"
                : "border border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A single on/off card setting. */
export function SettingToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-800 text-blue-500"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-200">{label}</span>
        {hint ? <span className="block text-xs leading-snug text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Below the trigger when there is room, otherwise above it, and never taller than the space it
 * has: a trigger near the bottom of the screen used to open a panel that hung off it.
 */
export function panelVerticalPlacement(rect: { top: number; bottom: number }, viewportHeight: number) {
  const below = viewportHeight - rect.bottom - 16;
  const above = rect.top - 16;
  if (below >= 240 || below >= above) return { top: rect.bottom + 8, maxHeight: Math.max(below, 120) };
  return { bottom: viewportHeight - rect.top + 8, maxHeight: above };
}
