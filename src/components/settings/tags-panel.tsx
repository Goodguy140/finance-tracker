"use client";

import { useState } from "react";
import { deleteTagAction, renameTagAction } from "@/app/actions";
import { inputClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { useConfirm } from "@/components/settings/dialog";
import { MAX_TAG_NAME_LENGTH, type TagOption } from "@/lib/tags";

export type TagRow = TagOption & { transactionCount: number };

const smallBtnClass =
  "touch-manipulation rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

export function TagsPanel({ tags }: { tags: TagRow[] }) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const confirm = useConfirm();
  return (
    <div className="space-y-4" data-testid="tag-list">
      {confirm.dialog}
      <p className="max-w-prose text-sm text-slate-400">
        Labels that cut across categories, like a trip or “reimbursable”. Type one on any entry to create it; filter the
        dashboard by one from the expense log. Renaming a tag to the name of another merges the two.
      </p>
      {tags.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
          No tags yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              {renamingId === tag.id ? (
                <ServerActionForm
                  action={renameTagAction}
                  onSuccess={() => setRenamingId(null)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                >
                  <input type="hidden" name="tagId" value={tag.id} />
                  <input
                    name="name"
                    aria-label={`New name for ${tag.name}`}
                    className={`${inputClass} min-w-0 flex-1`}
                    defaultValue={tag.name}
                    maxLength={MAX_TAG_NAME_LENGTH}
                    required
                    autoFocus
                  />
                  <button type="submit" className={smallBtnClass}>
                    Save
                  </button>
                  <button type="button" className={smallBtnClass} onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </ServerActionForm>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-100">{tag.name}</p>
                    <p className="text-xs text-slate-400">
                      {tag.transactionCount} transaction{tag.transactionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className={smallBtnClass}
                      onClick={() => setRenamingId(tag.id)}
                      aria-label={`Rename ${tag.name}`}
                    >
                      Rename
                    </button>
                    <ServerActionForm
                      action={deleteTagAction}
                      beforeSubmit={() =>
                        confirm.ask({
                          title: `Delete the tag “${tag.name}”?`,
                          body: "It comes off every transaction and rule that has it. The transactions themselves are kept.",
                          confirmLabel: "Delete tag",
                          danger: true,
                        })
                      }
                    >
                      <input type="hidden" name="tagId" value={tag.id} />
                      <button type="submit" className={`${smallBtnClass} text-red-200`} aria-label={`Delete ${tag.name}`}>
                        Delete
                      </button>
                    </ServerActionForm>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
