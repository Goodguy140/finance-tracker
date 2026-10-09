"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ServerActionForm } from "@/components/server-action-form";
import { inputClass, primaryBtnClass, secondaryBtnClass, LabeledField } from "@/components/forms/shared";
import { removePasskeyAction, renamePasskeyAction, unlinkSsoProviderAction } from "@/app/actions";
import { beginSsoLinkAction, regenerateRecoveryCodesAction } from "@/app/actions/mfa";
import { registerPasskey, usePasskeyStepUp } from "@/components/mfa/passkey-client";
import { useConfirm } from "@/components/settings/dialog";

export type PasskeyRow = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

export type SecurityPanelProps = {
  hasPassword: boolean;
  passkeys: PasskeyRow[];
  recoveryCodesRemaining: number;
  /** Epoch ms until which the current login counts as freshly verified, or null. */
  freshUntil: number | null;
  linkedProviders: string[];
  availableProviders: string[];
  /** Provider that was linked by the OAuth round-trip that just brought us back here. */
  linkedJustNow: string | null;
};

const PROVIDER_LABELS: Record<string, string> = { google: "Google", authentik: "SSO (Authentik)" };

function providerLabel(id: string) {
  return PROVIDER_LABELS[id] ?? id;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={secondaryBtnClass}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — user can still select the text manually */
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** Show-once modal: recovery codes are never retrievable after this closes. */
function RecoveryCodesReveal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-950/80 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-codes-title"
        className="w-full max-w-md space-y-4 rounded-2xl border border-emerald-500/40 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 id="recovery-codes-title" className="text-base font-semibold text-emerald-200">
          Save your recovery codes
        </h2>
        <p className="text-sm text-slate-300">
          Each code signs you in once if you lose every passkey. Store them somewhere safe — they will not be shown
          again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl border border-slate-700/80 bg-slate-950/70 p-3 font-mono text-sm text-emerald-100">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <CopyButton value={codes.join("\n")} label="Copy all" />
          <button type="button" className={primaryBtnClass} onClick={onClose}>
            I saved them
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Card({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
      <div>
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <p className="mt-0.5 max-w-prose text-sm text-slate-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Notice({ tone, children }: { tone: "error" | "info" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-500/40 bg-red-950/40 text-red-100"
      : tone === "success"
        ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-100"
        : "border-slate-700/80 bg-slate-950/40 text-slate-300";
  return (
    <p role={tone === "error" ? "alert" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}

export function SecurityPanel({
  hasPassword,
  passkeys,
  recoveryCodesRemaining,
  freshUntil,
  linkedProviders,
  availableProviders,
  linkedJustNow,
}: SecurityPanelProps) {
  const confirm = useConfirm();
  const router = useRouter();
  const enrolled = passkeys.length > 0;
  const stepUp = usePasskeyStepUp(freshUntil, enrolled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealCodes, setRevealCodes] = useState<string[] | null>(null);
  const [newName, setNewName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const gate = async () => {
    const outcome = await stepUp.ensureFresh();
    if (!outcome.ok && !outcome.cancelled) setError(outcome.error);
    return outcome.ok;
  };

  const addPasskey = () => {
    setError(null);
    startTransition(async () => {
      if (enrolled && !(await gate())) return;
      const outcome = await registerPasskey({
        name: newName,
        currentPassword: !enrolled && hasPassword ? currentPassword : undefined,
      });
      if (!outcome.ok) {
        if (!outcome.cancelled) setError(outcome.error);
        return;
      }
      setNewName("");
      setCurrentPassword("");
      if (outcome.recoveryCodes) setRevealCodes(outcome.recoveryCodes);
      // Server state changed (passkey list, verified cookie); re-render from the server.
      router.refresh();
    });
  };

  const regenerateCodes = () => {
    setError(null);
    startTransition(async () => {
      if (!(await gate())) return;
      const outcome = await regenerateRecoveryCodesAction();
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setRevealCodes(outcome.codes);
    });
  };

  const linkProvider = (provider: string) => {
    setError(null);
    startTransition(async () => {
      if (!(await gate())) return;
      const outcome = await beginSsoLinkAction({ provider });
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      // Hand off to NextAuth's provider sign-in exactly like the login page does; the
      // callback finds the link intent minted above and attaches instead of signing in.
      let csrfToken = "";
      try {
        const res = await fetch("/api/auth/csrf", { cache: "no-store" });
        csrfToken = ((await res.json()) as { csrfToken?: string }).csrfToken ?? "";
      } catch {
        setError("Could not reach the sign-in service. Try again.");
        return;
      }
      const form = document.createElement("form");
      form.method = "post";
      form.action = `/api/auth/signin/${provider}`;
      for (const [name, value] of [
        ["csrfToken", csrfToken],
        ["callbackUrl", `${window.location.origin}/settings/security`],
      ]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.requestSubmit();
    });
  };

  const unlinkedAvailable = availableProviders.filter((p) => !linkedProviders.includes(p));

  return (
    <div id="security" className="space-y-6">
      {confirm.dialog}
      {revealCodes ? (
        <RecoveryCodesReveal
          codes={revealCodes}
          onClose={() => {
            setRevealCodes(null);
            router.refresh();
          }}
        />
      ) : null}

      <Card
        title="Passkeys"
        description={
          enrolled
            ? "Every sign-in — password or SSO — must be confirmed with one of these passkeys. Passkeys cannot be phished: they only work on this site."
            : "Add a passkey (Touch ID, Windows Hello, Android, or a security key) to require it at every sign-in. Linking external accounts requires one."
        }
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {enrolled ? (
          <Notice tone="success">
            Passkey sign-in is on.{" "}
            {passkeys.length === 1 ? "Add a second passkey on another device so losing one does not lock you out." : null}
          </Notice>
        ) : null}

        <ul className="divide-y divide-slate-800/80 overflow-hidden rounded-2xl border border-slate-800/80">
          {passkeys.length === 0 ? (
            <li className="bg-slate-950/40 p-4 text-sm text-slate-500">No passkeys yet.</li>
          ) : (
            passkeys.map((pk) => (
              <li key={pk.id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-4">
                <div className="min-w-0 space-y-1">
                  {renaming === pk.id ? (
                    <ServerActionForm action={renamePasskeyAction} className="flex flex-wrap gap-2" onSuccess={() => setRenaming(null)}>
                      <input type="hidden" name="passkeyId" value={pk.id} />
                      <input name="name" defaultValue={pk.name} maxLength={40} required className={inputClass} aria-label="Passkey name" />
                      <button type="submit" className={primaryBtnClass}>
                        Save
                      </button>
                      <button type="button" className={secondaryBtnClass} onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </ServerActionForm>
                  ) : (
                    <p className="truncate text-sm font-medium text-slate-100">{pk.name}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    added {fmtDate(pk.createdAt)} · {pk.lastUsedAt ? `last used ${fmtDate(pk.lastUsedAt)}` : "never used"} ·{" "}
                    {pk.backedUp ? "synced" : "this device only"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {renaming !== pk.id ? (
                    <button type="button" className={secondaryBtnClass} onClick={() => setRenaming(pk.id)}>
                      Rename
                    </button>
                  ) : null}
                  <ServerActionForm
                    action={removePasskeyAction}
                    beforeSubmit={async () => {
                      if (
                        !(await confirm.ask({
                          title: `Remove passkey “${pk.name}”?`,
                          body: "You will no longer be able to sign in with it.",
                          confirmLabel: "Remove passkey",
                          danger: true,
                        }))
                      )
                        return false;
                      return gate();
                    }}
                  >
                    <input type="hidden" name="passkeyId" value={pk.id} />
                    <button type="submit" className={secondaryBtnClass}>
                      Remove
                    </button>
                  </ServerActionForm>
                </div>
              </li>
            ))
          )}
        </ul>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addPasskey();
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <LabeledField label="Passkey name" hint="Where it lives, e.g. “MacBook Touch ID”." className="flex-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={inputClass}
                maxLength={40}
                required
                autoComplete="off"
                placeholder="MacBook Touch ID"
              />
            </LabeledField>
            {!enrolled && hasPassword ? (
              <LabeledField label="Current password" hint="Required to turn passkeys on." className="flex-1">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputClass}
                  autoComplete="current-password"
                  required
                />
              </LabeledField>
            ) : null}
            <button type="submit" className={primaryBtnClass} disabled={pending || stepUp.busy}>
              {pending ? "Waiting…" : "Add passkey"}
            </button>
          </div>
        </form>
      </Card>

      {enrolled ? (
        <Card
          title="Recovery codes"
          description="One-time codes that get you in if every passkey is lost. Generating a new set invalidates the old one."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-slate-100">{recoveryCodesRemaining}</span> unused code
              {recoveryCodesRemaining === 1 ? "" : "s"} remaining.
            </p>
            <button type="button" className={secondaryBtnClass} onClick={regenerateCodes} disabled={pending || stepUp.busy}>
              Generate new codes
            </button>
          </div>
        </Card>
      ) : null}

      <Card
        title="Connected sign-in"
        description="External identity providers that can sign in to this account. Linking one requires a passkey confirmation."
      >
        {linkedJustNow ? <Notice tone="success">{providerLabel(linkedJustNow)} is now linked to your account.</Notice> : null}
        {!enrolled ? <Notice tone="info">Add a passkey above before linking an external sign-in.</Notice> : null}
        <ul className="divide-y divide-slate-800/80 overflow-hidden rounded-2xl border border-slate-800/80">
          {linkedProviders.length === 0 ? (
            <li className="bg-slate-950/40 p-4 text-sm text-slate-500">No external sign-ins linked.</li>
          ) : (
            linkedProviders.map((provider) => (
              <li key={provider} className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-4">
                <p className="text-sm font-medium text-slate-100">{providerLabel(provider)}</p>
                <ServerActionForm action={unlinkSsoProviderAction} beforeSubmit={gate}>
                  <input type="hidden" name="provider" value={provider} />
                  <button type="submit" className={secondaryBtnClass}>
                    Unlink
                  </button>
                </ServerActionForm>
              </li>
            ))
          )}
        </ul>
        {unlinkedAvailable.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {unlinkedAvailable.map((provider) => (
              <button
                key={provider}
                type="button"
                className={secondaryBtnClass}
                disabled={!enrolled || pending || stepUp.busy}
                onClick={() => linkProvider(provider)}
              >
                Link {providerLabel(provider)}
              </button>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
