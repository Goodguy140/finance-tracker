"use client";

import { useMemo, useState } from "react";
import { changePasswordAction, updateDashboardReadabilityAction, updateProfileAction } from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { inputClass, primaryBtnClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import {
  DEFAULT_DASHBOARD_READABILITY,
  MAX_VISIBLE_PCT,
  MIN_BUDGET_NAME_VISIBLE_PCT,
  MIN_TEXT_VISIBLE_PCT,
  type DashboardReadability,
} from "@/lib/dashboard-readability";
import { signOutOfDevice } from "@/lib/sign-out";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Codes Intl names that are not places someone lives: groupings, test and unknown regions. */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "ZZ", "QO", "XA", "XB", "AA", "QM", "QN", "QP", "QQ", "QR", "QS", "QT", "QU", "QV", "QW", "QX", "QY", "QZ"]);

/**
 * Every ISO 3166 country Intl can name, sorted by name. Built from the runtime's own region
 * data rather than a hard-coded list: a code Intl does not know comes back unchanged.
 */
function countryOptions(current: string): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  const out: { code: string; name: string }[] = [];
  if (names) {
    for (const a of LETTERS) {
      for (const b of LETTERS) {
        const code = a + b;
        if (NOT_COUNTRIES.has(code)) continue;
        const name = names.of(code);
        if (name && name !== code) out.push({ code, name });
      }
    }
  }
  if (current && !out.some((c) => c.code === current)) out.push({ code: current, name: current });
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

function timezoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return zones.includes(current) || !current ? zones : [current, ...zones];
}

export function ProfileForm({
  defaults,
}: {
  defaults: { displayName: string; countryCode: string; timezone: string; birthYear: number | null };
}) {
  const countries = useMemo(() => countryOptions(defaults.countryCode), [defaults.countryCode]);
  const zones = useMemo(() => timezoneOptions(defaults.timezone), [defaults.timezone]);
  const [timezone, setTimezone] = useState(defaults.timezone);
  const [dirty, setDirty] = useState(false);
  const browserZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  return (
    <ServerActionForm
      action={updateProfileAction}
      onSuccess={() => setDirty(false)}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <div onChange={() => setDirty(true)} className="contents">
        <label className="space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-slate-300">Display name</span>
          <input name="displayName" autoComplete="name" defaultValue={defaults.displayName} className={inputClass} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Country</span>
          <select name="countryCode" aria-label="Country" defaultValue={defaults.countryCode} className={selectClass}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-slate-500">Sets the currency and account types for new accounts.</span>
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Timezone</span>
          <select
            name="timezone"
            aria-label="Timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={selectClass}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {browserZone && browserZone !== timezone && zones.includes(browserZone) ? (
            <button
              type="button"
              className="text-xs text-blue-300 underline-offset-4 hover:underline"
              onClick={() => {
                setTimezone(browserZone);
                setDirty(true);
              }}
            >
              Use this device&apos;s timezone ({browserZone.replace(/_/g, " ")})
            </button>
          ) : (
            <span className="block text-xs text-slate-500">Decides when a month starts and ends.</span>
          )}
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Year of birth (optional)</span>
          <input
            name="birthYear"
            inputMode="numeric"
            autoComplete="bday-year"
            placeholder="1990"
            maxLength={4}
            defaultValue={defaults.birthYear ?? ""}
            className={inputClass}
          />
          <span className="block text-xs text-slate-500">
            Lets the financial score compare your long-term savings with your age, and starts the Retirement page from it. It
            stays on this server.
          </span>
        </label>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={primaryBtnClass} disabled={!dirty}>
          Save changes
        </button>
        {!dirty ? <span className="text-xs text-slate-500">No unsaved changes</span> : null}
      </div>
    </ServerActionForm>
  );
}

/** Folded behind a button: most visits to Security are about passkeys, not the password. */
export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);

  if (!hasPassword) {
    return (
      <p className="text-sm text-slate-400">
        This account has no password; you sign in another way. To add one,{" "}
        <a href="/forgot-password" className="font-medium text-blue-300 underline-offset-4 hover:underline">
          request a reset link
        </a>
        .
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={secondaryBtnClass} onClick={() => setOpen(true)}>
          Change password
        </button>
        <span className="text-xs text-slate-500">Changing it signs you out everywhere.</span>
      </div>
    );
  }

  return (
    <ServerActionForm
      action={changePasswordAction}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      // The change revokes every session, this one included; a clean sign-out beats letting
      // the next navigation discover the dead cookie.
      onSuccess={() => void signOutOfDevice()}
    >
      <label className="space-y-1.5 sm:col-span-2">
        <span className="text-sm font-medium text-slate-300">Current password</span>
        <input type="password" name="currentPassword" autoComplete="current-password" className={inputClass} required autoFocus />
      </label>
      <label className="space-y-1.5">
        <span className="text-sm font-medium text-slate-300">New password</span>
        <input type="password" name="newPassword" autoComplete="new-password" className={inputClass} required minLength={8} />
      </label>
      <label className="space-y-1.5">
        <span className="text-sm font-medium text-slate-300">Confirm new password</span>
        <input type="password" name="confirmPassword" autoComplete="new-password" className={inputClass} required minLength={8} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className={primaryBtnClass}>
          Update password
        </button>
        <button type="button" className={secondaryBtnClass} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <a href="/forgot-password" className="text-sm text-blue-300 underline-offset-4 hover:underline">
          Forgot password?
        </a>
      </div>
    </ServerActionForm>
  );
}

function PctSlider({
  name,
  label,
  help,
  min,
  value,
  onChange,
}: {
  name: string;
  label: string;
  help: string;
  min: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-300">{label}</span>
        <span className="text-sm tabular-nums text-slate-100">{value}%</span>
      </span>
      <input
        type="range"
        name={name}
        aria-label={label}
        min={min}
        max={MAX_VISIBLE_PCT}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
      <span className="block text-xs text-slate-500">{help}</span>
    </label>
  );
}

export function ReadabilityForm({ initial }: { initial: DashboardReadability }) {
  const [text, setText] = useState(initial.textVisiblePct);
  const [budget, setBudget] = useState(initial.budgetNameVisiblePct);
  const [saved, setSaved] = useState(initial);
  const dirty = text !== saved.textVisiblePct || budget !== saved.budgetNameVisiblePct;
  const isDefault =
    text === DEFAULT_DASHBOARD_READABILITY.textVisiblePct && budget === DEFAULT_DASHBOARD_READABILITY.budgetNameVisiblePct;

  return (
    <ServerActionForm
      action={updateDashboardReadabilityAction}
      onSuccess={() => setSaved({ textVisiblePct: text, budgetNameVisiblePct: budget })}
      className="space-y-5"
    >
      <PctSlider
        name="textVisiblePct"
        label="Card text visible"
        help="Lower keeps more columns with more cut-off text; higher merges a column sooner."
        min={MIN_TEXT_VISIBLE_PCT}
        value={text}
        onChange={setText}
      />
      <PctSlider
        name="budgetNameVisiblePct"
        label="Budget names visible"
        help="How much of each budget's name must show before a column is merged away."
        min={MIN_BUDGET_NAME_VISIBLE_PCT}
        value={budget}
        onChange={setBudget}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryBtnClass} disabled={!dirty}>
          Save
        </button>
        <button
          type="button"
          className={secondaryBtnClass}
          disabled={isDefault}
          onClick={() => {
            setText(DEFAULT_DASHBOARD_READABILITY.textVisiblePct);
            setBudget(DEFAULT_DASHBOARD_READABILITY.budgetNameVisiblePct);
          }}
        >
          Reset to default
        </button>
      </div>
    </ServerActionForm>
  );
}
