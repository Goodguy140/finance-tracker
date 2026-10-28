"use client";

import { useEffect, useState, useTransition } from "react";
import {
  removePushDeviceAction,
  savePushDeviceAction,
  sendTestPushAction,
  updatePushDeviceAction,
} from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";
import { PUSH_ALERT_KINDS, PUSH_ALERT_LABELS, type PushAlertKind } from "@/lib/push-notifications-shared";
import { isIos, isStandalone } from "@/lib/pwa-platform";

export type PushDeviceRow = { id: string; label: string; endpoint: string; createdAt: string } & Record<PushAlertKind, boolean>;

type Support =
  | { state: "checking" }
  | { state: "unsupported"; reason: string }
  | { state: "ready"; registration: ServiceWorkerRegistration; endpoint: string | null };

const checkboxClass = "h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-2 focus:ring-blue-500/40";
const buttonClass =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-50";

async function detectSupport(): Promise<Support> {
  if (isIos() && !isStandalone()) {
    return {
      state: "unsupported",
      reason:
        "On iPhone and iPad, add this app to your Home Screen (Share → Add to Home Screen), open it from there, and turn this on in its Settings. Needs iOS 16.4 or later.",
    };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { state: "unsupported", reason: "This browser cannot receive push notifications." };
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    return { state: "unsupported", reason: "The app's service worker is not running here, so it cannot receive notifications. Reload the page and try again." };
  }
  const subscription = await registration.pushManager.getSubscription();
  return { state: "ready", registration, endpoint: subscription?.endpoint ?? null };
}

/**
 * Settings → Notifications: phone notifications (Web Push) for bill reminders, charge alerts
 * and budget alerts, chosen per device. The email settings above still decide when each alert
 * is due; this decides which phones also get it.
 */
export function PushNotificationPreferences({ vapidPublicKey, devices }: { vapidPublicKey: string; devices: PushDeviceRow[] }) {
  const [support, setSupport] = useState<Support>({ state: "checking" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    detectSupport()
      .then((next) => live && setSupport(next))
      .catch(() => live && setSupport({ state: "unsupported", reason: "This browser cannot receive push notifications." }));
    return () => {
      live = false;
    };
  }, []);

  const thisDevice = support.state === "ready" && support.endpoint ? devices.find((d) => d.endpoint === support.endpoint) : undefined;
  const otherDevices = devices.filter((d) => d !== thisDevice);

  const run = (work: () => Promise<string | null>) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const done = await work();
        if (done) setMessage({ ok: true, text: done });
      } catch (err) {
        setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
      }
    });
  };

  const turnOn = () =>
    run(async () => {
      if (support.state !== "ready") return null;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notifications are blocked for this app. Allow them in the browser or phone settings, then try again.");
      }
      const subscription = await support.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
      });
      const json = subscription.toJSON();
      const form = new FormData();
      form.set("endpoint", subscription.endpoint);
      form.set("p256dh", json.keys?.p256dh ?? "");
      form.set("auth", json.keys?.auth ?? "");
      const result = await savePushDeviceAction(form);
      if (isActionFailure(result)) {
        await subscription.unsubscribe().catch(() => {});
        throw new Error(result.error);
      }
      setSupport({ ...support, endpoint: subscription.endpoint });
      return "Notifications are on for this device.";
    });

  const turnOff = (device: PushDeviceRow) =>
    run(async () => {
      if (support.state === "ready") {
        const subscription = await support.registration.pushManager.getSubscription();
        await subscription?.unsubscribe().catch(() => {});
        setSupport({ ...support, endpoint: null });
      }
      const form = new FormData();
      form.set("deviceId", device.id);
      const result = await removePushDeviceAction(form);
      if (isActionFailure(result)) throw new Error(result.error);
      return "Notifications are off for this device.";
    });

  const remove = (device: PushDeviceRow) =>
    run(async () => {
      const form = new FormData();
      form.set("deviceId", device.id);
      const result = await removePushDeviceAction(form);
      if (isActionFailure(result)) throw new Error(result.error);
      return `Removed ${device.label}.`;
    });

  const toggle = (device: PushDeviceRow, kind: PushAlertKind, on: boolean) =>
    run(async () => {
      const form = new FormData();
      form.set("deviceId", device.id);
      for (const k of PUSH_ALERT_KINDS) form.set(k, String(k === kind ? on : device[k]));
      const result = await updatePushDeviceAction(form);
      if (isActionFailure(result)) throw new Error(result.error);
      return null;
    });

  const test = (device: PushDeviceRow) =>
    run(async () => {
      const form = new FormData();
      form.set("deviceId", device.id);
      const result = await sendTestPushAction(form);
      if (isActionFailure(result)) throw new Error(result.error);
      return "Sent. It should arrive in a few seconds.";
    });

  return (
    <section aria-label="Phone notifications" className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Phone notifications</h3>
        <p className="text-sm text-slate-400">
          Bill reminders, large or unusual charges and budget alerts as notifications on your phone or computer, even
          when the app is closed. They arrive alongside any emails, and you choose which alerts each device gets.
        </p>
      </div>

      {support.state === "checking" ? <p className="text-xs text-slate-500">Checking this device…</p> : null}
      {support.state === "unsupported" ? <p className="text-xs text-amber-200">{support.reason}</p> : null}
      {support.state === "ready" && !thisDevice ? (
        <button type="button" onClick={turnOn} disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          Turn on for this device
        </button>
      ) : null}

      {thisDevice ? (
        <DeviceCard device={thisDevice} current pending={pending} onToggle={toggle}>
          <button type="button" onClick={() => test(thisDevice)} disabled={pending} className={buttonClass}>
            Send a test
          </button>
          <button type="button" onClick={() => turnOff(thisDevice)} disabled={pending} className={buttonClass}>
            Turn off on this device
          </button>
        </DeviceCard>
      ) : null}

      {otherDevices.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Other devices</p>
          {otherDevices.map((device) => (
            <DeviceCard key={device.id} device={device} pending={pending} onToggle={toggle}>
              <button type="button" onClick={() => remove(device)} disabled={pending} className={buttonClass}>
                Remove
              </button>
            </DeviceCard>
          ))}
        </div>
      ) : null}

      {message ? (
        <p role="status" className={`text-xs ${message.ok ? "text-emerald-300" : "text-red-300"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

function DeviceCard({
  device,
  current = false,
  pending,
  onToggle,
  children,
}: {
  device: PushDeviceRow;
  current?: boolean;
  pending: boolean;
  onToggle: (device: PushDeviceRow, kind: PushAlertKind, on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3" data-testid="push-device">
      <p className="text-sm font-medium text-slate-200">
        {device.label}
        {current ? <span className="ml-2 text-xs font-normal text-emerald-300">This device</span> : null}
      </p>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2" disabled={pending}>
        <legend className="sr-only">Alerts sent to {device.label}</legend>
        {PUSH_ALERT_KINDS.map((kind) => (
          <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={device[kind]}
              onChange={(e) => onToggle(device, kind, e.target.checked)}
            />
            {PUSH_ALERT_LABELS[kind]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
