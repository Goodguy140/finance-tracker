"use client";

import { signOutAppDeviceAction } from "@/app/actions/app-devices";
import { secondaryBtnClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";

export type SignedInAppRow = {
  id: string;
  name: string;
  platform: string;
  appVersion: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const PLATFORM_LABEL: Record<string, string> = { ios: "iPhone app", android: "Android app" };

/** Settings → Security: the phones signed in to the app, each with its own Sign out. */
export function SignedInApps({ devices, idleDays }: { devices: SignedInAppRow[]; idleDays: number }) {
  return (
    <div className="space-y-3">
      {devices.length === 0 ? (
        <p className="text-sm text-slate-500">No phones are signed in to the app.</p>
      ) : (
        <ul className="divide-y divide-slate-800/80 overflow-hidden rounded-2xl border border-slate-800/80">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-4">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-slate-100">{device.name}</p>
                <p className="text-xs text-slate-500">
                  {PLATFORM_LABEL[device.platform] ?? device.platform}
                  {device.appVersion ? ` ${device.appVersion}` : ""} · signed in {fmtDate(device.createdAt)} ·{" "}
                  {device.lastUsedAt ? `last used ${fmtDate(device.lastUsedAt)}` : "not used yet"}
                </p>
              </div>
              <ServerActionForm action={signOutAppDeviceAction}>
                <input type="hidden" name="deviceId" value={device.id} />
                <button type="submit" className={secondaryBtnClass} aria-label={`Sign out ${device.name}`}>
                  Sign out
                </button>
              </ServerActionForm>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        A phone not used for {idleDays} days is signed out on its own. Changing your password signs out every
        phone too.
      </p>
    </div>
  );
}
