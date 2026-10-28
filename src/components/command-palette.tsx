"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  CornerDownLeft,
  Download,
  FileSearch,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Shapes,
  Shield,
  Tag,
  Target,
  Wallet,
  Wand2,
} from "lucide-react";
import { refreshLinkedAccountsAction } from "@/app/actions/plaid";
import { quickAddExpenseAction, undoQuickAddAction } from "@/app/actions/quick-add";
import { isActionFailure } from "@/lib/action-result";
import { availableCommands, matchCommands, type Command, type CommandContext } from "@/lib/search/commands";
import { requestQuickAdd } from "@/lib/search/dashboard-requests";
import { formatHitAmount } from "@/lib/search/format";
import { formatCurrency } from "@/lib/money";
import type { QuickAddPreview } from "@/lib/search/quick-add-server";
import type { SearchHit, SearchHitGroup, SearchHitKind } from "@/lib/search/search-data";
import { searchPageHref, MIN_SEARCH_QUERY_LENGTH } from "@/lib/search/search-paths";
import { signOutOfDevice } from "@/lib/sign-out";
import { canReachServer } from "@/lib/use-online-status";

type SearchResponse = {
  groups: SearchHitGroup[];
  transactionTotal: number;
  /** The expense the query would add, when it reads as one ("12.50 tim hortons yesterday"). */
  quickAdd: QuickAddPreview | null;
  context: CommandContext;
};

/** One row of the list, whatever it came from; the list is navigated as one. */
type Item =
  | { key: string; source: "command"; command: Command }
  | { key: string; source: "hit"; hit: SearchHit }
  | { key: string; source: "all"; href: string; total: number; query: string }
  | { key: string; source: "quick-add"; preview: QuickAddPreview; text: string };

type Section = { label: string; items: Item[] };

const DEBOUNCE_MS = 150;

type IconName = SearchHitKind | "add" | "sync" | "sign-out" | "download" | "search" | "admin" | "settings" | "page";

function commandIconName(command: Command): IconName {
  switch (command.run.type) {
    case "add":
      return "add";
    case "sync-banks":
      return "sync";
    case "sign-out":
      return "sign-out";
    case "download":
      return "download";
    default:
      if (command.id === "search-transactions") return "search";
      if (command.section === "Admin") return "admin";
      if (command.section === "Settings") return "settings";
      return "page";
  }
}

function ItemIcon({ name, className }: { name: IconName; className: string }) {
  const props = { className, "aria-hidden": true } as const;
  switch (name) {
    case "transaction":
      return <Receipt {...props} />;
    case "transfer":
      return <ArrowLeftRight {...props} />;
    case "account":
      return <Wallet {...props} />;
    case "category":
      return <Shapes {...props} />;
    case "tag":
      return <Tag {...props} />;
    case "rule":
      return <Wand2 {...props} />;
    case "recurring":
      return <Repeat {...props} />;
    case "goal":
      return <Target {...props} />;
    case "add":
      return <Plus {...props} />;
    case "sync":
      return <RefreshCw {...props} />;
    case "sign-out":
      return <LogOut {...props} />;
    case "download":
      return <Download {...props} />;
    case "search":
      return <FileSearch {...props} />;
    case "admin":
      return <Shield {...props} />;
    case "settings":
      return <Settings {...props} />;
    case "page":
      return <LayoutDashboard {...props} />;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The master search: one box that finds any page, setting or action and the user's own data
 * (transactions from every month, transfers, accounts, categories, tags, rules, recurring rules,
 * goals). Opens from the button in the app nav, Ctrl/⌘ K, or "/" outside a text field. A full
 * screen on phones, a dialog on wide screens.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="open-search"
        className="touch-manipulation flex min-h-9 items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900 px-2.5 text-sm text-slate-400 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200 sm:w-40 sm:rounded-lg sm:px-3 xl:w-56"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 text-left sm:inline">Search…</span>
        <kbd className="hidden rounded border border-slate-700 px-1.5 py-0.5 font-sans text-[10px] text-slate-500 xl:inline">
          Ctrl K
        </kbd>
      </button>
      {open ? <PaletteDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  /** The query `response` answers, so a stale answer is never shown against a newer query. */
  const [answered, setAnswered] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [context, setContext] = useState<CommandContext>({ isAdmin: false, hasBanks: false });
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<{ tone: "neutral" | "error" | "success" | "warning"; message: string } | null>(null);
  /** Sync banks and type-to-add share it: one thing at a time from the box. */
  const [syncing, startSync] = useTransition();
  /** The expense just added from the box, while "Undo" can still take it back. */
  const [undoId, setUndoId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("");

  // Keep the page behind still, and give focus back to whatever had it.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  const trimmed = query.trim();
  const wantsData = trimmed.length >= MIN_SEARCH_QUERY_LENGTH;

  // Debounced, and aborted when the query moves on. An empty query still asks once, for the
  // context that decides which fixed entries are offered.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(wantsData ? trimmed : "")}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as SearchResponse;
          setResponse(body);
          setContext(body.context);
          setAnswered(wantsData ? trimmed : "");
          setFailed(false);
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error("[search] request failed", err);
          setFailed(true);
        }
      },
      wantsData ? DEBOUNCE_MS : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, wantsData]);

  const commands = useMemo(() => availableCommands(context), [context]);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    // First, so Enter adds it: the text only reads as an expense when it has an amount and a title.
    if (response?.quickAdd && answered === trimmed) {
      out.push({
        label: "Add",
        items: [{ key: "quick-add", source: "quick-add", preview: response.quickAdd, text: trimmed }],
      });
    }
    const matched = matchCommands(commands, query, trimmed ? 6 : 8);
    if (matched.length > 0) {
      out.push({
        label: trimmed ? "Pages, settings and actions" : "Suggested",
        items: matched.map((command) => ({ key: `c:${command.id}`, source: "command", command })),
      });
    }
    if (wantsData && response && answered === trimmed) {
      for (const group of response.groups) {
        const items: Item[] = group.hits.map((hit) => ({ key: `h:${hit.kind}:${hit.id}`, source: "hit", hit }));
        if (group.kind === "transaction" || group.kind === "transfer") {
          const shown = response.groups
            .filter((g) => g.kind === "transaction" || g.kind === "transfer")
            .reduce((n, g) => n + g.hits.length, 0);
          // Once, after the last of the two transaction groups.
          const isLast = !response.groups.some((g) => g.kind === "transfer") || group.kind === "transfer";
          if (isLast && response.transactionTotal > shown) {
            items.push({
              key: "all",
              source: "all",
              href: searchPageHref({ query: trimmed }),
              total: response.transactionTotal,
              query: trimmed,
            });
          }
        }
        out.push({ label: group.label, items });
      }
    }
    return out;
  }, [commands, query, trimmed, wantsData, response, answered]);

  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);
  const activeKey = activeIndex >= 0 ? items[activeIndex].key : null;
  const optionId = (key: string) => `${listId}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  useEffect(() => {
    if (!activeKey) return;
    document.getElementById(optionId(activeKey))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId only depends on listId
  }, [activeKey]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const syncBanks = useCallback(() => {
    setStatus(null);
    if (!canReachServer()) {
      setStatus({ tone: "error", message: "You're offline, so the banks can't be checked right now." });
      return;
    }
    setBusyLabel("Checking your banks…");
    startSync(async () => {
      try {
        const result = await refreshLinkedAccountsAction();
        if (isActionFailure(result)) {
          setStatus({ tone: "error", message: result.error });
          return;
        }
        setStatus({ tone: result.tone, message: result.message });
        router.refresh();
      } catch {
        setStatus({ tone: "error", message: "Could not refresh your banks. Please try again." });
      }
    });
  }, [router]);

  const quickAdd = useCallback(
    (text: string) => {
      setStatus(null);
      setUndoId(null);
      setBusyLabel("Adding…");
      startSync(async () => {
        const result = await quickAddExpenseAction(text);
        if (!result.ok) {
          setStatus({ tone: "error", message: result.error });
          return;
        }
        setQuery("");
        setStatus({ tone: "success", message: result.message });
        setUndoId(result.transactionId);
        router.refresh();
      });
    },
    [router],
  );

  const undoQuickAdd = useCallback(() => {
    if (!undoId) return;
    setStatus(null);
    setBusyLabel("Removing it…");
    startSync(async () => {
      const result = await undoQuickAddAction(undoId);
      setUndoId(null);
      setStatus(result.ok ? { tone: "neutral", message: "Removed it again." } : { tone: "error", message: result.error });
      router.refresh();
      inputRef.current?.focus();
    });
  }, [router, undoId]);

  const runItem = useCallback(
    (item: Item) => {
      if (item.source === "quick-add") return quickAdd(item.text);
      if (item.source === "hit") return go(item.hit.href);
      if (item.source === "all") return go(item.href);
      const run = item.command.run;
      switch (run.type) {
        case "link":
          return go(run.href);
        case "download": {
          // A plain link: the response is an attachment, so the page stays where it is.
          const a = document.createElement("a");
          a.href = run.href;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
          onClose();
          return;
        }
        case "add":
          onClose();
          if (pathname === "/") requestQuickAdd(run.kind);
          else router.push(`/?add=${run.kind}`);
          return;
        case "sync-banks":
          return syncBanks();
        case "sign-out":
          onClose();
          void signOutOfDevice();
          return;
      }
    },
    [go, onClose, pathname, quickAdd, router, syncBanks],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((activeIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((activeIndex - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (activeIndex >= 0) runItem(items[activeIndex]);
    } else if (e.key === "Tab") {
      // A modal dialog: focus stays in the box, and the list is reached with the arrows.
      e.preventDefault();
    }
  }

  const loading = wantsData && answered !== trimmed && !failed;
  const nothingFound = wantsData && !loading && !failed && items.length === 0;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/70 backdrop-blur-[2px] sm:items-start sm:p-4 sm:pt-[10vh]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="search-dialog"
        onKeyDown={onKeyDown}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-900 text-slate-100 shadow-2xl sm:h-auto sm:max-h-[min(80vh,40rem)] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-slate-700"
      >
        <h2 id={titleId} className="sr-only">
          Search
        </h2>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 sm:py-3">
          <Search className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
            aria-label="Search pages, settings, actions and your transactions"
            placeholder="Search transactions, settings, actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setStatus(null);
              setUndoId(null);
            }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-slate-100 placeholder:text-slate-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {loading || syncing ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-slate-500" aria-hidden /> : null}
          <button
            type="button"
            onClick={onClose}
            className="touch-manipulation shrink-0 rounded-lg px-2 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <span className="sm:hidden">Cancel</span>
            <kbd className="hidden font-sans text-xs sm:inline">Esc</kbd>
          </button>
        </div>

        <div className={status || syncing ? statusClass(status?.tone ?? "neutral") : "sr-only"}>
          <p role="status" aria-live="polite" className="min-w-0 flex-1">
            {syncing && !status ? busyLabel : (status?.message ?? "")}
          </p>
          {undoId && status ? (
            <button
              type="button"
              onClick={undoQuickAdd}
              disabled={syncing}
              className="touch-manipulation shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              Undo
            </button>
          ) : null}
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 [-webkit-overflow-scrolling:touch]"
        >
          {sections.map((section) => (
            <div key={section.label} role="group" aria-label={section.label} className="py-1">
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500" aria-hidden>
                {section.label}
              </p>
              {section.items.map((item) => {
                const index = items.indexOf(item);
                return (
                  <ResultRow
                    key={item.key}
                    id={optionId(item.key)}
                    item={item}
                    selected={index === activeIndex}
                    onHover={() => setActive(index)}
                    onRun={() => runItem(item)}
                  />
                );
              })}
            </div>
          ))}
          {failed ? (
            <p className="px-3 py-4 text-sm text-amber-300">Couldn&apos;t search your data just now. Pages and settings still work.</p>
          ) : null}
          {nothingFound ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches “{trimmed}”.</p>
          ) : null}
          {trimmed.length === 1 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Type another letter to search your transactions too.</p>
          ) : null}
        </div>

        <div className="hidden shrink-0 items-center gap-4 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500 sm:flex">
          <span>
            <kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> to move
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" aria-hidden /> to open
          </span>
          <span>Type “12.50 coffee yesterday” to add it</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function statusClass(tone: "neutral" | "error" | "success" | "warning"): string {
  const color =
    tone === "error" ? "text-red-300" : tone === "success" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-slate-300";
  return `flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-2 text-sm ${color}`;
}

/** "Oct 27", with the year only when it is not this one. */
function quickAddDate(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  const sameYear = ymd.slice(0, 4) === String(new Date().getFullYear());
  return date.toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function ResultRow({
  id,
  item,
  selected,
  onHover,
  onRun,
}: {
  id: string;
  item: Item;
  selected: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  let icon: IconName;
  let title: string;
  let detail: string;
  let trailing: string | null = null;
  if (item.source === "quick-add") {
    const { preview } = item;
    icon = "add";
    title = `Add expense ${formatCurrency(preview.amountCents)} ${preview.title}, ${quickAddDate(preview.dateYmd)}`;
    detail = preview.split
      ? `Split ${preview.split}${preview.accountName ? ` · ${preview.accountName}` : ""}`
      : [preview.categoryName, preview.accountName].filter(Boolean).join(" · ");
  } else if (item.source === "command") {
    icon = commandIconName(item.command);
    title = item.command.label;
    detail = item.command.hint;
  } else if (item.source === "hit") {
    icon = item.hit.kind;
    title = item.hit.title;
    detail = item.hit.detail;
    trailing = formatHitAmount(item.hit);
  } else {
    icon = "search";
    title = `See all ${item.total} transactions matching “${item.query}”`;
    detail = "Every month, on one page";
  }

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseMove={onHover}
      onClick={onRun}
      data-testid="search-result"
      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${
        selected ? "bg-slate-800 text-slate-50" : "text-slate-200"
      }`}
    >
      <ItemIcon name={icon} className={`h-4 w-4 shrink-0 ${selected ? "text-sky-300" : "text-slate-500"}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-slate-400">{detail}</p>
      </div>
      {trailing ? <span className="shrink-0 text-sm tabular-nums text-slate-300">{trailing}</span> : null}
    </div>
  );
}
