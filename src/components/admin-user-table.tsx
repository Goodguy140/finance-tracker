"use client";

import { useMemo, useState } from "react";
import {
  deleteUserAction,
  forceSignOutUserAction,
  setUserDisabledAction,
  setUserRoleAction,
} from "@/app/actions";
import { useConfirmIdentity } from "@/components/mfa/confirm-identity";
import { ServerActionForm } from "@/components/server-action-form";
import type { AdminUserRow } from "@/lib/admin-users";
import { inputClass, secondaryBtnClass } from "@/components/forms/shared";

export type AdminUserTableRow = AdminUserRow & { lastSignInAt: string | null };

function formatDate(iso: string) {
  return iso.replace("T", " ").slice(0, 10);
}

/** Counts only: an admin reviewing access has no business seeing anyone's balances. */
function activitySummary(user: AdminUserTableRow): string {
  const parts = [`${user.transactionCount.toLocaleString()} txn`];
  if (user.bankCount > 0) parts.push(`${user.bankCount} bank${user.bankCount === 1 ? "" : "s"}`);
  if (user.reviewBacklog > 0) parts.push(`${user.reviewBacklog} to review`);
  return parts.join(" · ");
}

type RoleFilter = "all" | "SERVER_ADMIN" | "USER";
type StatusFilter = "all" | "active" | "suspended";

function matches(user: AdminUserTableRow, query: string, role: RoleFilter, status: StatusFilter): boolean {
  if (role !== "all" && user.role !== role) return false;
  if (status === "active" && user.disabledAt !== null) return false;
  if (status === "suspended" && user.disabledAt === null) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return user.email.toLowerCase().includes(q) || user.displayName.toLowerCase().includes(q);
}

/** How this account can sign in, at a glance — the first thing an access review looks at. */
function signInMethods(user: AdminUserRow): string {
  const methods: string[] = [];
  if (user.hasPassword) methods.push("password");
  if (user.passkeyCount > 0) methods.push(`${user.passkeyCount} passkey${user.passkeyCount === 1 ? "" : "s"}`);
  if (user.hasAuthenticatorApp) methods.push("authenticator app");
  methods.push(...user.ssoProviders);
  return methods.length > 0 ? methods.join(", ") : "none";
}

function StatusLabel({ user }: { user: AdminUserRow }) {
  return user.disabledAt !== null ? (
    <span className="text-amber-300/90">suspended {formatDate(user.disabledAt)}</span>
  ) : (
    <span className="text-emerald-300/90">active</span>
  );
}

function RoleControl({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  const confirmIdentity = useConfirmIdentity();
  if (isSelf) {
    return <span className="font-mono text-[11px] text-slate-400">{user.role} (you)</span>;
  }
  return (
    <ServerActionForm action={setUserRoleAction} beforeSubmit={confirmIdentity} className="flex items-center gap-1">
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="role" value={user.role === "SERVER_ADMIN" ? "USER" : "SERVER_ADMIN"} />
      <span className="font-mono text-[11px] text-slate-400">{user.role}</span>
      <button type="submit" className="text-blue-300 underline hover:text-blue-200">
        {user.role === "SERVER_ADMIN" ? "demote" : "promote"}
      </button>
    </ServerActionForm>
  );
}

function DeleteUserForm({ user }: { user: AdminUserRow }) {
  const [open, setOpen] = useState(false);
  const confirmIdentity = useConfirmIdentity();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryBtnClass}>
        Delete…
      </button>
    );
  }

  return (
    <ServerActionForm action={deleteUserAction} beforeSubmit={confirmIdentity} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={user.id} />
      <input
        name="confirmEmail"
        required
        autoFocus
        placeholder={user.email}
        aria-label={`Type ${user.email} to confirm deletion`}
        className={`${inputClass} w-56`}
      />
      <button
        type="submit"
        className="rounded-lg border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-900/60"
      >
        Delete permanently
      </button>
      <button type="button" onClick={() => setOpen(false)} className={secondaryBtnClass}>
        Cancel
      </button>
    </ServerActionForm>
  );
}

function UserActions({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  const confirmIdentity = useConfirmIdentity();
  if (isSelf) return <span className="text-slate-500">—</span>;
  const suspended = user.disabledAt !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ServerActionForm action={setUserDisabledAction} beforeSubmit={confirmIdentity}>
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
  );
}

/**
 * Two layouts, one data set. Six columns do not fit a phone, and a horizontally scrolling
 * table puts the destructive controls off-screen behind the columns that merely describe the
 * account — so on small screens each account becomes a card with its actions always reachable.
 */
export function AdminUserTable({ users: allUsers, currentUserId }: { users: AdminUserTableRow[]; currentUserId: string }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const users = useMemo(
    () => allUsers.filter((user) => matches(user, query.trim(), role, status)),
    [allUsers, query, role, status],
  );
  const filterSelectClass =
    "rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search users"
          className={`${inputClass} max-w-xs`}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as RoleFilter)}
          aria-label="Filter by role"
          className={filterSelectClass}
        >
          <option value="all">All roles</option>
          <option value="SERVER_ADMIN">Server admins</option>
          <option value="USER">Users</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className={filterSelectClass}
        >
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <span className="text-xs text-slate-500">
          {users.length === allUsers.length ? `${users.length} shown` : `${users.length} of ${allUsers.length} shown`}
        </span>
      </div>

      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-500">
          No accounts match these filters.
        </p>
      ) : null}

      <ul className="space-y-3 sm:hidden">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          return (
            <li key={user.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs">
              <div>
                <p className="font-medium text-slate-100">{user.displayName}</p>
                <p className="break-all font-mono text-[11px] text-slate-400">{user.email}</p>
              </div>
              <p className="text-slate-500">
                <StatusLabel user={user} /> · joined {formatDate(user.createdAt)}
              </p>
              <p className="text-slate-400">
                sign-in: {signInMethods(user)} · {user.activeTokenCount} token
                {user.activeTokenCount === 1 ? "" : "s"}
              </p>
              <p className="text-slate-400">
                {activitySummary(user)} · last sign-in {user.lastSignInAt ? formatDate(user.lastSignInAt) : "unknown"}
              </p>
              <RoleControl user={user} isSelf={isSelf} />
              <UserActions user={user} isSelf={isSelf} />
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-slate-800 sm:block">
        <table className="min-w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">Account</th>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="px-2 py-2 font-medium">Sign-in</th>
              <th className="px-2 py-2 font-medium">Tokens</th>
              <th className="px-2 py-2 font-medium">Activity</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <tr key={user.id} className="border-t border-slate-800/80 align-top">
                  <td className="px-2 py-2">
                    <p className="font-medium text-slate-100">{user.displayName}</p>
                    <p className="font-mono text-[11px] text-slate-400">{user.email}</p>
                    <p className="text-[11px] text-slate-500">joined {formatDate(user.createdAt)}</p>
                  </td>
                  <td className="px-2 py-2">
                    <RoleControl user={user} isSelf={isSelf} />
                  </td>
                  <td className="px-2 py-2 text-slate-400">{signInMethods(user)}</td>
                  <td className="px-2 py-2 text-slate-400">{user.activeTokenCount}</td>
                  <td className="px-2 py-2 text-slate-400">
                    <p>{activitySummary(user)}</p>
                    <p className="text-[11px] text-slate-500">
                      last sign-in {user.lastSignInAt ? formatDate(user.lastSignInAt) : "unknown"}
                    </p>
                  </td>
                  <td className="px-2 py-2">
                    <StatusLabel user={user} />
                  </td>
                  <td className="px-2 py-2">
                    <UserActions user={user} isSelf={isSelf} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
