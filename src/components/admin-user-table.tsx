"use client";

import { useState } from "react";
import {
  deleteUserAction,
  forceSignOutUserAction,
  setUserDisabledAction,
  setUserRoleAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import type { AdminUserRow } from "@/lib/admin-users";
import { inputClass, secondaryBtnClass } from "@/components/forms/shared";

function formatDate(iso: string) {
  return iso.replace("T", " ").slice(0, 10);
}

/** How this account can sign in, at a glance — the first thing an access review looks at. */
function signInMethods(user: AdminUserRow): string {
  const methods: string[] = [];
  if (user.hasPassword) methods.push("password");
  if (user.passkeyCount > 0) methods.push(`${user.passkeyCount} passkey${user.passkeyCount === 1 ? "" : "s"}`);
  methods.push(...user.ssoProviders);
  return methods.length > 0 ? methods.join(", ") : "none";
}

function DeleteUserForm({ user }: { user: AdminUserRow }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryBtnClass}>
        Delete…
      </button>
    );
  }

  return (
    <ServerActionForm action={deleteUserAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={user.id} />
      <input
        name="confirmEmail"
        required
        autoFocus
        placeholder={user.email}
        aria-label={`Type ${user.email} to confirm deletion`}
        className={`${inputClass} w-56`}
      />
      <button type="submit" className="rounded-lg border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-900/60">
        Delete permanently
      </button>
      <button type="button" onClick={() => setOpen(false)} className={secondaryBtnClass}>
        Cancel
      </button>
    </ServerActionForm>
  );
}

export function AdminUserTable({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="min-w-full text-left text-xs text-slate-300">
        <thead className="bg-slate-950/80 text-slate-400">
          <tr>
            <th className="px-2 py-2 font-medium">Account</th>
            <th className="px-2 py-2 font-medium">Role</th>
            <th className="px-2 py-2 font-medium">Sign-in</th>
            <th className="px-2 py-2 font-medium">Tokens</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const suspended = user.disabledAt !== null;
            return (
              <tr key={user.id} className="border-t border-slate-800/80 align-top">
                <td className="px-2 py-2">
                  <p className="font-medium text-slate-100">{user.displayName}</p>
                  <p className="font-mono text-[11px] text-slate-400">{user.email}</p>
                  <p className="text-[11px] text-slate-500">joined {formatDate(user.createdAt)}</p>
                </td>
                <td className="px-2 py-2">
                  {isSelf ? (
                    <span className="font-mono text-[11px] text-slate-400">{user.role} (you)</span>
                  ) : (
                    <ServerActionForm action={setUserRoleAction} className="flex items-center gap-1">
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="hidden"
                        name="role"
                        value={user.role === "SERVER_ADMIN" ? "USER" : "SERVER_ADMIN"}
                      />
                      <span className="font-mono text-[11px] text-slate-400">{user.role}</span>
                      <button type="submit" className="text-blue-300 underline hover:text-blue-200">
                        {user.role === "SERVER_ADMIN" ? "demote" : "promote"}
                      </button>
                    </ServerActionForm>
                  )}
                </td>
                <td className="px-2 py-2 text-slate-400">{signInMethods(user)}</td>
                <td className="px-2 py-2 text-slate-400">{user.activeTokenCount}</td>
                <td className="px-2 py-2">
                  {suspended ? (
                    <span className="text-amber-300/90">suspended {formatDate(user.disabledAt!)}</span>
                  ) : (
                    <span className="text-emerald-300/90">active</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {isSelf ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <ServerActionForm action={setUserDisabledAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="disabled" value={suspended ? "false" : "true"} />
                        <button type="submit" className={secondaryBtnClass}>
                          {suspended ? "Restore" : "Suspend"}
                        </button>
                      </ServerActionForm>
                      <ServerActionForm action={forceSignOutUserAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <button type="submit" className={secondaryBtnClass}>
                          Sign out
                        </button>
                      </ServerActionForm>
                      <DeleteUserForm user={user} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
