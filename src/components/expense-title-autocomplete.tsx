"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";

type Option = { id: string; name: string };

type ListAnchor = { top: number; left: number; width: number };

const titleInputClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base leading-normal text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";

const listClass =
  "max-h-[min(14rem,40dvh)] overflow-y-auto overscroll-contain rounded-xl border border-slate-700/90 bg-slate-950/98 py-1 shadow-2xl shadow-black/40 ring-1 ring-slate-800/80 backdrop-blur-sm";

const optionClass =
  "flex w-full min-h-[2.75rem] flex-col justify-center gap-0.5 px-3 py-2.5 text-left transition touch-manipulation sm:min-h-0 sm:py-2";

const MAX_SUGGESTIONS = 8;

export function ExpenseTitleAutocomplete({
  inputId,
  name = "title",
  defaultValue = "",
  titleSuggestions,
  expenseCategories,
  onTitleChange,
  required,
}: {
  inputId: string;
  name?: string;
  defaultValue?: string;
  titleSuggestions: ExpenseTitleSuggestion[];
  expenseCategories: Option[];
  onTitleChange: (title: string) => void;
  required?: boolean;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchor, setAnchor] = useState<ListAnchor | null>(null);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of expenseCategories) map.set(c.id, c.name);
    return map;
  }, [expenseCategories]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q
      ? titleSuggestions.filter((s) => s.title.toLowerCase().includes(q))
      : titleSuggestions;
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [value, titleSuggestions]);

  const showList = open && filtered.length > 0;

  function syncAnchor() {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }

  useLayoutEffect(() => {
    if (!showList) return;
    syncAnchor();
    const onLayout = () => syncAnchor();
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [showList, filtered, value]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function applyTitle(next: string) {
    setValue(next);
    onTitleChange(next);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleInputChange(next: string) {
    setValue(next);
    onTitleChange(next);
    setOpen(true);
    setActiveIndex(-1);
  }

  function selectSuggestion(suggestion: ExpenseTitleSuggestion) {
    applyTitle(suggestion.title);
  }

  const suggestionList =
    showList && anchor ? (
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        className={listClass}
        style={{
          position: "fixed",
          top: anchor.top,
          left: anchor.left,
          width: anchor.width,
          zIndex: 70,
        }}
      >
        {filtered.map((suggestion, index) => {
          const categoryName = categoryNameById.get(suggestion.categoryId);
          const active = index === activeIndex;
          return (
            <li key={suggestion.title} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`${optionClass} ${
                  active
                    ? "bg-blue-500/15 text-slate-100"
                    : "text-slate-200 hover:bg-slate-800/90 active:bg-slate-800"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
              >
                <span className="truncate text-sm font-medium leading-snug">{suggestion.title}</span>
                {categoryName ? (
                  <span className="truncate text-xs text-slate-500">{categoryName}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="text"
        maxLength={120}
        required={required}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="sentences"
        spellCheck={false}
        enterKeyHint="done"
        value={value}
        className={titleInputClass}
        placeholder="e.g. Weekly groceries, Shell fuel"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        onFocus={() => {
          if (titleSuggestions.length > 0) {
            syncAnchor();
            setOpen(true);
          }
        }}
        onChange={(e) => {
          handleInputChange(e.target.value);
          if (titleSuggestions.length > 0) syncAnchor();
        }}
        onKeyDown={(e) => {
          if (!showList) {
            if (e.key === "ArrowDown" && titleSuggestions.length > 0) {
              setOpen(true);
              setActiveIndex(0);
              e.preventDefault();
            }
            return;
          }
          if (e.key === "Escape") {
            setOpen(false);
            setActiveIndex(-1);
            e.preventDefault();
            return;
          }
          if (e.key === "ArrowDown") {
            setActiveIndex((i) => (i + 1 >= filtered.length ? 0 : i + 1));
            e.preventDefault();
            return;
          }
          if (e.key === "ArrowUp") {
            setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
            e.preventDefault();
            return;
          }
          if (e.key === "Enter" && activeIndex >= 0) {
            const picked = filtered[activeIndex];
            if (picked) selectSuggestion(picked);
            e.preventDefault();
          }
        }}
      />
      {typeof document !== "undefined" && suggestionList
        ? createPortal(suggestionList, document.body)
        : null}
    </div>
  );
}
