"use client";

import { Share, Smartphone } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { secondaryBtnClass, primaryBtnClass } from "@/components/forms/shared";
import { canPromptInstall, promptInstall, subscribeInstallPrompt } from "@/lib/pwa-install";
import { isIos, isStandalone } from "@/lib/pwa-platform";

const IOS_HINT_DISMISSED_KEY = "finance-tracker:ios-install-hint-dismissed";

function readIosHintDismissed(): boolean {
  try {
    return localStorage.getItem(IOS_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};

/**
 * "Install the app" card for Settings. Chromium (Android, desktop) gets a real install
 * button from the captured `beforeinstallprompt`; iOS has no such API, so Safari gets the
 * Share → Add to Home Screen steps. Nothing is shown once running installed, or on a
 * browser that can do neither.
 */
export function InstallPrompt() {
  const canPrompt = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);
  // Platform checks read `navigator`, so they are client-only; the server pass renders nothing.
  const standalone = useSyncExternalStore(noopSubscribe, isStandalone, () => true);
  const ios = useSyncExternalStore(noopSubscribe, isIos, () => false);
  const [iosHintDismissed, setIosHintDismissed] = useState(readIosHintDismissed);

  if (standalone) return null;

  if (canPrompt) {
    return (
      <InstallCard>
        <p className="text-sm text-slate-400">
          Open Finance Tracker from your home screen or app list, full screen, without the browser around it.
        </p>
        <div>
          <button type="button" className={primaryBtnClass} onClick={() => void promptInstall()}>
            Install app
          </button>
        </div>
      </InstallCard>
    );
  }

  if (ios && !iosHintDismissed) {
    return (
      <InstallCard>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-400">
          <li>
            In Safari, tap <Share className="inline size-4 align-text-bottom text-slate-300" aria-label="Share" />{" "}
            <span className="text-slate-300">Share</span>.
          </li>
          <li>
            Choose <span className="text-slate-300">Add to Home Screen</span>.
          </li>
          <li>Open the app from your Home Screen and sign in once more — it keeps its own session.</li>
        </ol>
        <p className="text-xs text-slate-500">Installing is also what enables budget notifications on iPhone and iPad.</p>
        <div>
          <button
            type="button"
            className={secondaryBtnClass}
            onClick={() => {
              setIosHintDismissed(true);
              try {
                localStorage.setItem(IOS_HINT_DISMISSED_KEY, "1");
              } catch {
                // Not persisted; it simply shows again next visit.
              }
            }}
          >
            Don&apos;t show again
          </button>
        </div>
      </InstallCard>
    );
  }

  return null;
}

function InstallCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      data-testid="install-app-card"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5"
    >
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
        <Smartphone className="size-4 text-blue-300" aria-hidden />
        Install the app
      </h3>
      {children}
    </section>
  );
}
