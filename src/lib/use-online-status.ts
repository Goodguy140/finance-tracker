"use client";

import { useSyncExternalStore } from "react";

/** Injected by the service worker (`public/sw.js`, `markAsSavedCopy`) into a page it serves from cache. */
export const SAVED_COPY_META = "ft-saved-copy";

/**
 * This document is the service worker's saved copy, not a live render. Fixed for the
 * life of the page: reloading is what gets a live one.
 */
export function isSavedCopy(): boolean {
  return typeof document !== "undefined" && document.querySelector(`meta[name="${SAVED_COPY_META}"]`) !== null;
}

/**
 * Whether a write can reach the server from this page. False when the browser reports
 * no network, and false on a saved copy even when it reports one — the copy is only
 * served when the server could not be reached, and `navigator.onLine` stays true on a
 * connection that goes nowhere.
 */
export function canReachServer(): boolean {
  return navigator.onLine && !isSavedCopy();
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** `canReachServer()`, kept current. Assumes online during SSR so markup never starts disabled. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, canReachServer, () => true);
}
