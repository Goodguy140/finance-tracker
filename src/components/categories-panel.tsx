"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  setCategoryBudgetAction,
  setPlaidCategoryMappingAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { inputClass, primaryBtnClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import { formatCurrency } from "@/lib/money";

type Kind = "EXPENSE" | "INCOME";

export type CategoryRow = {
  id: string;
  name: string;
  kind: Kind;
  transactionCount: number;
  /** Split lines and recurring rules filed under it; with transactions, what blocks a plain delete. */
  splitCount: number;
  recurringCount: number;
  /** The budget in force this month, if any. */
  budgetLimitCents: number | null;
};

export type PlaidMappingRow = {
  code: string;
  label: string;
  /** The user's own choice, or null when the default applies. */
  mappedCategoryId: string | null;
  /** What applies when there is no choice: the built-in map's pick, or "Same as …". */
  defaultLabel: string;
};

export type PlaidMappingGroup = PlaidMappingRow & {
  kind: Kind;
  detailed: PlaidMappingRow[];
};

export type CategoriesPanelProps = {
  categories: CategoryRow[];
  plaidGroups: PlaidMappingGroup[];
  /** Whether any bank is linked; the mapping still saves without one. */
  hasLinkedBank: boolean;
};

const sectionClass =
  "space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-4 shadow-lg sm:p-5";
const smallBtnClass =
  "touch-manipulation rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

const dangerBtnClass =
  "touch-manipulation rounded-xl border border-red-500/50 bg-red-900/60 px-4 py-2 text-sm font-medium text-red-50 transition hover:bg-red-900/85";

const KIND_HEADINGS: Record<Kind, string> = { EXPENSE: "Expense categories", INCOME: "Income categories" };

export function CategoriesPanel({ categories, plaidGroups, hasLinkedBank }: CategoriesPanelProps) {
  return (
    <div className="space-y-4">
      <AddCategorySection />
      {(["EXPENSE", "INCOME"] as const).map((kind) => (
        <CategoryListSection
          key={kind}
          kind={kind}
          categories={categories.filter((c) => c.kind === kind)}
          sameKind={categories.filter((c) => c.kind === kind)}
        />
      ))}
      <PlaidMappingSection groups={plaidGroups} categories={categories} hasLinkedBank={hasLinkedBank} />
    </div>
  );
}

function AddCategorySection() {
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [formKey, setFormKey] = useState(0);
  return (
    <section className={sectionClass} aria-labelledby="add-category-heading">
      <div className="space-y-1">
        <h3 id="add-category-heading" className="text-base font-semibold text-slate-100">
          Add a category
        </h3>
        <p className="text-sm text-slate-400">
          Give an expense category a monthly limit here to budget it from this month on, or leave it blank.
        </p>
      </div>
      <ServerActionForm
        key={formKey}
        action={createCategoryAction}
        onSuccess={() => setFormKey((k) => k + 1)}
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto] sm:items-end"
      >
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-400">Name</span>
          <input name="name" className={inputClass} placeholder="e.g. Pets" maxLength={80} required />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-400">Type</span>
          <select
            name="kind"
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-400">Monthly budget</span>
          <input
            name="limit"
            inputMode="decimal"
            className={inputClass}
            placeholder={kind === "EXPENSE" ? "Optional" : "Expenses only"}
            disabled={kind !== "EXPENSE"}
          />
        </label>
        <button type="submit" className={`${primaryBtnClass} px-4 py-2.5`}>
          Add
        </button>
      </ServerActionForm>
    </section>
  );
}

function CategoryListSection({
  kind,
  categories,
  sameKind,
}: {
  kind: Kind;
  categories: CategoryRow[];
  sameKind: CategoryRow[];
}) {
  return (
    <section className={sectionClass} aria-label={KIND_HEADINGS[kind]}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">{KIND_HEADINGS[kind]}</h3>
        <p className="text-sm text-slate-400">
          Renaming one to the name of another merges them: every transaction, budget, rule and bank mapping moves
          across.
        </p>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">None yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/40">
          {categories.map((category) => (
            <CategoryItem key={category.id} category={category} others={sameKind.filter((c) => c.id !== category.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** What still points at a category, in words, e.g. "3 transactions and 1 recurring rule". */
function describeUsage(category: CategoryRow): string {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };
  add(category.transactionCount, "transaction", "transactions");
  add(category.splitCount, "split line", "split lines");
  add(category.recurringCount, "recurring rule", "recurring rules");
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function CategoryItem({ category, others }: { category: CategoryRow; others: CategoryRow[] }) {
  // Everything that would block deleting it (Restrict relations), not only transactions:
  // a category used only by a recurring rule must still offer somewhere to move it.
  const inUse = category.transactionCount + category.splitCount + category.recurringCount > 0;
  const [dialog, setDialog] = useState<null | "delete" | "removeBudget" | { mergeInto: string }>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const removeBudgetButton = useRef<HTMLButtonElement>(null);

  return (
    <li data-testid="category-row">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 transition hover:bg-slate-900/50 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-100">{category.name}</span>
            <span className="block text-xs text-slate-500">
              {category.transactionCount} transaction{category.transactionCount === 1 ? "" : "s"}
            </span>
          </span>
          {category.kind === "EXPENSE" ? (
            <span
              className={`shrink-0 text-xs font-medium tabular-nums ${
                category.budgetLimitCents === null ? "text-slate-500" : "text-emerald-300"
              }`}
            >
              {category.budgetLimitCents === null ? "No budget" : `${formatCurrency(category.budgetLimitCents)}/mo`}
            </span>
          ) : null}
          <span aria-hidden className="shrink-0 text-slate-500 transition group-open:rotate-90">
            ›
          </span>
        </summary>

        <div className="space-y-3 border-t border-slate-800/80 px-3 pb-3 pt-3">
          <ServerActionForm action={renameCategoryAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="categoryId" value={category.id} />
            <label className="min-w-0 flex-1 space-y-1">
              <span className="text-xs font-medium text-slate-400">Name</span>
              <input
                name="name"
                aria-label={`New name for ${category.name}`}
                className={inputClass}
                defaultValue={category.name}
                maxLength={80}
                required
              />
            </label>
            <button
              ref={renameButton}
              type="submit"
              className={smallBtnClass}
              onClick={(e) => {
                const input = e.currentTarget.form?.elements.namedItem("name") as HTMLInputElement | null;
                const next = input?.value.trim().toLowerCase();
                const target = others.find((o) => o.name.toLowerCase() === next);
                if (target) {
                  e.preventDefault();
                  setDialog({ mergeInto: target.name });
                }
              }}
            >
              Rename
            </button>
          </ServerActionForm>

          {category.kind === "EXPENSE" ? (
            <ServerActionForm
              key={category.budgetLimitCents ?? "none"}
              action={setCategoryBudgetAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="categoryId" value={category.id} />
              <input type="hidden" name="intent" value="set" />
              <label className="min-w-0 flex-1 space-y-1">
                <span className="text-xs font-medium text-slate-400">Monthly budget</span>
                <input
                  name="limit"
                  inputMode="decimal"
                  aria-label={`Monthly budget for ${category.name}`}
                  className={inputClass}
                  defaultValue={category.budgetLimitCents === null ? "" : (category.budgetLimitCents / 100).toFixed(2)}
                  placeholder="No budget"
                  required
                />
              </label>
              <button
                type="submit"
                className={smallBtnClass}
                onClick={(e) => {
                  const intent = e.currentTarget.form?.elements.namedItem("intent") as HTMLInputElement | null;
                  if (intent) intent.value = "set";
                }}
              >
                Save budget
              </button>
              {category.budgetLimitCents !== null ? (
                <button
                  ref={removeBudgetButton}
                  type="button"
                  className={smallBtnClass}
                  onClick={() => setDialog("removeBudget")}
                >
                  Remove budget
                </button>
              ) : null}
            </ServerActionForm>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3">
            <p className="min-w-0 flex-1 text-xs text-slate-500">
              {inUse ? `Used by ${describeUsage(category)}.` : "Nothing uses this category."}
            </p>
            <button
              type="button"
              className={`${smallBtnClass} text-red-200`}
              disabled={others.length === 0}
              title={others.length === 0 ? "Keep at least one category of each type." : undefined}
              aria-label={`Delete ${category.name}`}
              onClick={() => setDialog("delete")}
            >
              Delete
            </button>
          </div>
        </div>
      </details>

      {dialog === "delete" ? (
        <DeleteCategoryDialog
          category={category}
          others={others}
          inUse={inUse}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === "removeBudget" ? (
        <ConfirmDialog
          title={`Remove the budget for “${category.name}”?`}
          body="Its monthly limit is removed for every month, past months included. Transactions are not affected."
          confirmLabel="Remove budget"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            const form = removeBudgetButton.current?.form;
            if (!form) return;
            const intent = form.elements.namedItem("intent") as HTMLInputElement | null;
            const limit = form.elements.namedItem("limit") as HTMLInputElement | null;
            if (intent) intent.value = "remove";
            // A removal does not need the limit the field otherwise requires.
            if (limit) limit.required = false;
            form.requestSubmit();
          }}
        />
      ) : null}

      {dialog !== null && typeof dialog === "object" ? (
        <ConfirmDialog
          title={`Merge “${category.name}” into “${dialog.mergeInto}”?`}
          body={`Everything filed under “${category.name}” moves to “${dialog.mergeInto}”: transactions, budgets, rules and bank mappings. “${category.name}” is then removed. This can't be undone.`}
          confirmLabel="Merge"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            // requestSubmit does not fire the button's click, so this does not ask again.
            renameButton.current?.form?.requestSubmit();
          }}
        />
      ) : null}
    </li>
  );
}

/** A modal in the page itself, so it looks like the app rather than the browser. */
function ModalShell({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-slate-950/80 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <h2 id={titleId} className="text-base font-semibold text-slate-100">
        {title}
      </h2>
      <p className="text-sm text-slate-300">{body}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryBtnClass} onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className={danger ? dangerBtnClass : primaryBtnClass} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function DeleteCategoryDialog({
  category,
  others,
  inUse,
  onClose,
}: {
  category: CategoryRow;
  others: CategoryRow[];
  inUse: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <h2 id={titleId} className="text-base font-semibold text-slate-100">
        Delete “{category.name}”?
      </h2>
      <ServerActionForm action={deleteCategoryAction} onSuccess={onClose} className="space-y-4">
        <input type="hidden" name="categoryId" value={category.id} />
        {inUse ? (
          <>
            <p className="text-sm text-slate-300">
              It is used by {describeUsage(category)}. Choose where they go; its budgets, rules and bank mappings move
              with them.
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-400">Move them to</span>
              <select
                name="targetCategoryId"
                className={selectClass}
                aria-label={`Move ${category.name}'s transactions to`}
                required
                defaultValue=""
                autoFocus
              >
                <option value="" disabled>
                  Choose a category
                </option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <p className="text-sm text-slate-300">
            Nothing uses it. Its budget, if it has one, is removed with it, and rules that set it stop setting a
            category.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={dangerBtnClass}>
            {inUse ? "Move and delete" : "Delete"}
          </button>
        </div>
      </ServerActionForm>
    </ModalShell>
  );
}

function PlaidMappingSection({
  groups,
  categories,
  hasLinkedBank,
}: {
  groups: PlaidMappingGroup[];
  categories: CategoryRow[];
  hasLinkedBank: boolean;
}) {
  return (
    <section className={sectionClass} aria-labelledby="plaid-mapping-heading">
      <div className="space-y-1">
        <h3 id="plaid-mapping-heading" className="text-base font-semibold text-slate-100">
          Bank categories
        </h3>
        <p className="text-sm text-slate-400">
          Which of your categories a linked bank&apos;s transactions are suggested under in the review queue. Each starts
          on the built-in default; pick one of yours to change it. Open a row to set more specific ones, like groceries
          apart from restaurants.
          {hasLinkedBank ? " Rows waiting for review update straight away." : ""}
        </p>
      </div>
      <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/40">
        {groups.map((group) => {
          const options = categories.filter((c) => c.kind === group.kind);
          const customised = group.detailed.filter((d) => d.mappedCategoryId).length;
          return (
            <li key={group.code} data-testid="plaid-mapping-row">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm text-slate-100">{group.label}</span>
                <MappingSelect row={group} options={options} />
              </div>
              <details className="group px-3 pb-2">
                <summary className="cursor-pointer list-none text-xs text-slate-500 hover:text-slate-300 [&::-webkit-details-marker]:hidden">
                  <span className="inline-block transition group-open:rotate-90">›</span> More specific
                  {customised > 0 ? ` (${customised} set)` : ""}
                </summary>
                <ul className="mt-2 space-y-1.5 border-l border-slate-800 pl-3">
                  {group.detailed.map((row) => (
                    <li key={row.code} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-xs text-slate-300">{row.label}</span>
                      <MappingSelect row={row} options={options} compact />
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MappingSelect({ row, options, compact }: { row: PlaidMappingRow; options: CategoryRow[]; compact?: boolean }) {
  return (
    <ServerActionForm action={setPlaidCategoryMappingAction} className={compact ? "w-full sm:w-56" : "w-full sm:w-64"}>
      <input type="hidden" name="plaidCategory" value={row.code} />
      <select
        // Re-mounted when the saved value changes, so a refresh after saving shows the server's answer.
        key={row.mappedCategoryId ?? ""}
        name="categoryId"
        aria-label={`Category for ${row.label}`}
        className={`${selectClass} ${compact ? "py-1.5 text-xs" : ""}`}
        defaultValue={row.mappedCategoryId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">{row.defaultLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </ServerActionForm>
  );
}
