"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import type { QuickAddKind } from "@/lib/search/commands";

/**
 * How the master search asks the dashboard to do something: open a transaction or recurring
 * rule (`?open=<id>`), or start adding one (`?add=<kind>`). From another page it navigates to
 * `/` with the parameter; on the dashboard itself an add is an event, so nothing reloads.
 *
 * Each card that can answer takes the request when it holds what is asked for (the expense
 * log opens an expense, the income log an income). The parameter is then dropped from the
 * address, so a reload or a later month change does not open it again.
 */

const QUICK_ADD_EVENT = "finance:quick-add";
const QUICK_ADD_KINDS: readonly QuickAddKind[] = ["expense", "income", "transfer", "recurring"];

function isQuickAddKind(value: string | null): value is QuickAddKind {
  return QUICK_ADD_KINDS.includes(value as QuickAddKind);
}

/** Drops `name` from the address bar without a navigation; Next keeps `useSearchParams` in step. */
function dropParam(name: string) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}

function useParamRequest(name: string, handle: (value: string) => void) {
  const value = useSearchParams()?.get(name) ?? null;
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });
  useEffect(() => {
    if (!value) return;
    handleRef.current(value);
    // After every card has had its turn in this commit, whichever took it.
    const timer = window.setTimeout(() => dropParam(name), 0);
    return () => window.clearTimeout(timer);
  }, [name, value]);
}

/** Calls `handle` with the id in `?open=`; the card checks whether the id is one of its own. */
export function useOpenRequest(handle: (id: string) => void) {
  useParamRequest("open", handle);
}

/** Calls `handle` for `?add=<kind>` and for {@link requestQuickAdd} on the same page. */
export function useQuickAddRequest(handle: (kind: QuickAddKind) => void) {
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });
  useParamRequest("add", (value) => {
    if (isQuickAddKind(value)) handleRef.current(value);
  });
  useEffect(() => {
    const onRequest = (e: Event) => {
      const kind = (e as CustomEvent<unknown>).detail;
      if (typeof kind === "string" && isQuickAddKind(kind)) handleRef.current(kind);
    };
    window.addEventListener(QUICK_ADD_EVENT, onRequest);
    return () => window.removeEventListener(QUICK_ADD_EVENT, onRequest);
  }, []);
}

/** For the search palette while already on the dashboard. */
export function requestQuickAdd(kind: QuickAddKind) {
  window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT, { detail: kind }));
}

/** Wide screens, where the dashboard shows the Add card rather than the phone's quick-add bar. */
export function isDesktopViewport(): boolean {
  return window.matchMedia("(min-width: 1024px)").matches;
}

/** Whether the desktop Add card is on the page; without it the quick-add sheet stands in. */
export function hasAddCard(): boolean {
  return document.querySelector('[data-card-id="add-expense"]') !== null;
}

/** Brings a just-opened element into view and marks it briefly, for a request without a dialog. */
export function flashElement(id: string) {
  // Two frames: the element may only render on the state change that asked for it.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.dataset.searchFlash = "true";
    window.setTimeout(() => {
      delete el.dataset.searchFlash;
    }, 2500);
  }));
}
