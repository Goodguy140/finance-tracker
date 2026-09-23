"use client";

/**
 * Chromium's install prompt. `beforeinstallprompt` fires once, early — usually on the
 * dashboard, long before anyone opens Settings — so it is captured here, from a module
 * the root layout loads on every page, and held until the install button asks for it.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's own mini-infobar; the app offers installation in Settings instead.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** Shows the browser's install dialog. The event is single-use either way. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  await event.prompt();
  await event.userChoice.catch(() => undefined);
}
