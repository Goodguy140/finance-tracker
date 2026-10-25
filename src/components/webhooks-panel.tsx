"use client";

import { useActionState, useState } from "react";
import { createWebhookAction, deleteWebhookAction, sendTestWebhookAction, setWebhookEnabledAction, type CreateWebhookState } from "@/app/actions/webhooks";
import { ServerActionForm } from "@/components/server-action-form";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS } from "@/lib/webhook-events";

export type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastDeliveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
};

const initialState: CreateWebhookState = { ok: null };

function WebhookItem({ hook }: { hook: WebhookRow }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  return (
    <li className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm" data-testid="webhook-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs text-slate-100">{hook.url}</p>
          <p className="mt-1 text-xs text-slate-400">{hook.events.join(", ")}</p>
          <p className="mt-1 text-xs text-slate-500">
            {!hook.enabled
              ? "Paused"
              : hook.lastError
                ? `Last attempt failed: ${hook.lastError}`
                : hook.lastDeliveredAt
                  ? `Last delivered ${new Date(hook.lastDeliveredAt).toLocaleString()}`
                  : "Nothing sent yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ServerActionForm
            action={sendTestWebhookAction}
            onSuccess={(result) => setTestResult(result.delivered ? "Test delivered." : `Test failed: ${result.error}`)}
          >
            <input type="hidden" name="endpointId" value={hook.id} />
            <button type="submit" className={secondaryBtnClass} disabled={!hook.enabled}>
              Send test
            </button>
          </ServerActionForm>
          <ServerActionForm action={setWebhookEnabledAction}>
            <input type="hidden" name="endpointId" value={hook.id} />
            <input type="hidden" name="enabled" value={hook.enabled ? "false" : "true"} />
            <button type="submit" className={secondaryBtnClass}>
              {hook.enabled ? "Pause" : "Resume"}
            </button>
          </ServerActionForm>
          <button type="button" className={secondaryBtnClass} onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      </div>
      {testResult ? (
        <p role="status" className="text-xs text-slate-300">
          {testResult}
        </p>
      ) : null}
      {confirmingDelete ? (
        <div
          role="group"
          aria-label="Delete this webhook?"
          className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2"
        >
          <span className="mr-auto text-xs text-red-100">Delete this webhook? Nothing more is sent to it.</span>
          <button type="button" className={secondaryBtnClass} onClick={() => setConfirmingDelete(false)}>
            Keep
          </button>
          <ServerActionForm action={deleteWebhookAction}>
            <input type="hidden" name="endpointId" value={hook.id} />
            <button type="submit" className="touch-manipulation rounded-xl bg-red-500/80 px-3 py-2 text-sm font-medium text-white hover:bg-red-500">
              Delete webhook
            </button>
          </ServerActionForm>
        </div>
      ) : null}
    </li>
  );
}

export function WebhooksPanel({ hooks }: { hooks: WebhookRow[] }) {
  const [state, formAction, pending] = useActionState(createWebhookAction, initialState);
  return (
    <section aria-labelledby="webhooks-heading" className="space-y-4">
      <header className="space-y-2">
        <h3 id="webhooks-heading" className="text-base font-semibold text-slate-100 lg:text-lg">
          Webhooks
        </h3>
        <p className="max-w-prose text-sm leading-relaxed text-slate-400">
          Send events to Home Assistant, n8n, ntfy or your own script as signed JSON POSTs. Each request carries{" "}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">X-Webhook-Signature: t=…,v1=…</code>, an HMAC-SHA256 of{" "}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">t.body</code> with the secret. Failed deliveries are retried for
          about a day.
        </p>
      </header>

      {state.ok === true ? (
        <div className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-3.5" data-testid="webhook-secret">
          <p className="text-sm font-medium text-emerald-200">Signing secret for {state.url}. Copy it now; it is not shown again.</p>
          <code className="block break-all rounded-lg border border-emerald-500/30 bg-slate-950/70 px-3 py-2 font-mono text-xs text-emerald-100">
            {state.secret}
          </code>
        </div>
      ) : null}
      {state.ok === false ? (
        <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-100">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">URL</span>
          <input name="url" type="url" required placeholder="https://homeassistant.local:8123/api/webhook/…" className={inputClass} autoComplete="off" />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-300">Events</legend>
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-start gap-2 text-sm text-slate-200">
              <input type="checkbox" name="events" value={event} defaultChecked={event !== "transaction.created"} className="mt-1" />
              <span>
                <code className="text-xs text-slate-300">{event}</code> · {WEBHOOK_EVENT_LABELS[event]}
              </span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className={primaryBtnClass} disabled={pending}>
          {pending ? "Adding…" : "Add webhook"}
        </button>
      </form>

      {hooks.length > 0 ? (
        <ul className="space-y-2">
          {hooks.map((hook) => (
            <WebhookItem key={hook.id} hook={hook} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">No webhooks yet.</p>
      )}
    </section>
  );
}
