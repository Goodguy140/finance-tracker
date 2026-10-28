"use client";

import { useState, useTransition } from "react";
import { createCalendarFeedAction, deleteCalendarFeedAction } from "@/app/actions/calendar-feed";
import { primaryBtnClass, secondaryBtnClass, inputClass } from "@/components/forms/shared";
import { useConfirmIdentity } from "@/components/mfa/confirm-identity";
import { ConfirmDialog } from "@/components/settings/dialog";
import { isActionFailure } from "@/lib/action-result";

const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" });

/**
 * Settings → Notifications: a private calendar link for Google, Apple or Outlook calendars,
 * listing recurring bills, pay, transfers and decide-by dates (`src/lib/calendar-feed.ts`).
 * Only a hash of the link is kept, so it is shown once, right after it is made.
 */
export function CalendarFeedPreferences({
  feed,
}: {
  feed: { createdAt: string; lastFetchedAt: string | null } | null;
}) {
  const confirmIdentity = useConfirmIdentity();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"replace" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setConfirming(null);
    setError(null);
    startTransition(async () => {
      if (!(await confirmIdentity())) return;
      const result = await createCalendarFeedAction(new FormData());
      if (isActionFailure(result)) setError(result.error);
      else {
        setUrl(`${window.location.origin}${result.path}`);
        setCopied(false);
      }
    });
  };

  const remove = () => {
    setConfirming(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteCalendarFeedAction(new FormData());
      if (isActionFailure(result)) setError(result.error);
      else setUrl(null);
    });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      aria-label="Calendar feed"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Calendar feed</h3>
        <p className="text-sm text-slate-400">
          A private link your calendar app subscribes to: each recurring bill, payday and transfer for the next year, and
          subscription decide-by dates, as all-day events with the amount. It updates as you change your recurring rules.
        </p>
      </div>

      {url ? (
        <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-950/30 p-3">
          <p className="text-sm font-medium text-slate-100">Your calendar link</p>
          <p className="text-xs text-slate-400">
            Copy it now: it is shown only once. Anyone with it can see your bills and pay, so keep it to your own calendar.
          </p>
          <input readOnly value={url} aria-label="Calendar link" className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryBtnClass} onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <a className={secondaryBtnClass} href={url.replace(/^https?:/, "webcal:")}>
              Open in calendar app
            </a>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-400">
            <li>Google Calendar: Other calendars, +, From URL, then paste it.</li>
            <li>Apple Calendar: File, New Calendar Subscription, then paste it.</li>
            <li>Outlook: Add calendar, Subscribe from web, then paste it.</li>
          </ul>
        </div>
      ) : null}

      {feed && !url ? (
        <p className="text-sm text-slate-300">
          A calendar link is on, made {dateFormat.format(new Date(feed.createdAt))}.{" "}
          {feed.lastFetchedAt
            ? `A calendar last checked it ${dateFormat.format(new Date(feed.lastFetchedAt))}.`
            : "No calendar has checked it yet."}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {feed || url ? (
          <>
            <button type="button" className={secondaryBtnClass} disabled={pending} onClick={() => setConfirming("replace")}>
              Make a new link
            </button>
            <button type="button" className={secondaryBtnClass} disabled={pending} onClick={() => setConfirming("remove")}>
              Turn off
            </button>
          </>
        ) : (
          <button type="button" className={primaryBtnClass} disabled={pending} onClick={create}>
            Create calendar link
          </button>
        )}
      </div>

      {error ? (
        <p role="status" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {confirming === "replace" ? (
        <ConfirmDialog
          title="Make a new calendar link?"
          body="The current link stops working, so calendars subscribed to it stop updating. Add the new link to them instead."
          confirmLabel="Make a new link"
          onConfirm={create}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "remove" ? (
        <ConfirmDialog
          title="Turn off the calendar feed?"
          body="The link stops working. Calendars keep what they already fetched until you remove the subscription there."
          confirmLabel="Turn off"
          danger
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </section>
  );
}
