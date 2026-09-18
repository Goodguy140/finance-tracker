"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inputClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import type { AuditLogFilters } from "@/lib/admin-audit-query";

/**
 * Writes the filter into the URL so a review is linkable and the back button works.
 * `null` clears a param; a default value is dropped rather than written, keeping URLs short.
 */
function buildQuery(current: URLSearchParams, updates: Record<string, string | null>): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

export function AdminAuditFilters({
  filters,
  actions,
  exportHref,
}: {
  filters: AuditLogFilters;
  actions: string[];
  exportHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function apply(updates: Record<string, string | null>) {
    // Any filter change invalidates the current page number.
    const query = buildQuery(searchParams, { ...updates, page: null });
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Action
        <select
          value={filters.action ?? ""}
          onChange={(e) => apply({ action: e.target.value || null })}
          className={selectClass}
        >
          <option value="">All actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Actor email contains
        <input
          type="search"
          defaultValue={filters.actor ?? ""}
          onBlur={(e) => apply({ actor: e.target.value.trim() || null })}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({ actor: e.currentTarget.value.trim() || null });
          }}
          placeholder="example.com"
          className={`${inputClass} w-48`}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        From
        <input
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => apply({ from: e.target.value || null })}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        To
        <input
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => apply({ to: e.target.value || null })}
          className={inputClass}
        />
      </label>

      <button type="button" onClick={() => router.push(pathname)} className={secondaryBtnClass}>
        Clear
      </button>

      {/* A plain link, not a fetch: the browser handles the download and the cookie goes with it. */}
      <a href={exportHref} className={secondaryBtnClass}>
        Export CSV
      </a>
    </div>
  );
}
