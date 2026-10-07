"use client";

import { useState } from "react";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  setCategoryBudgetAction,
  setPlaidCategoryMappingAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { inputClass, primaryBtnClass, selectClass } from "@/components/forms/shared";
import { formatCurrency } from "@/lib/money";

type Kind = "EXPENSE" | "INCOME";

export type CategoryRow = {
  id: string;
  name: string;
  kind: Kind;
  transactionCount: number;
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

function CategoryItem({ category, others }: { category: CategoryRow; others: CategoryRow[] }) {
  const inUse = category.transactionCount > 0;
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
              type="submit"
              className={smallBtnClass}
              onClick={(e) => {
                const input = e.currentTarget.form?.elements.namedItem("name") as HTMLInputElement | null;
                const next = input?.value.trim().toLowerCase();
                const target = others.find((o) => o.name.toLowerCase() === next);
                if (target && !window.confirm(`Merge “${category.name}” into “${target.name}”? This can't be undone.`)) {
                  e.preventDefault();
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
                  type="submit"
                  className={smallBtnClass}
                  onClick={(e) => {
                    const form = e.currentTarget.form;
                    if (!window.confirm(`Remove the budget for “${category.name}”, past months included?`)) {
                      e.preventDefault();
                      return;
                    }
                    const intent = form?.elements.namedItem("intent") as HTMLInputElement | null;
                    const limit = form?.elements.namedItem("limit") as HTMLInputElement | null;
                    if (intent) intent.value = "remove";
                    // The limit field is required for a save; a removal does not need it.
                    if (limit) limit.required = false;
                  }}
                >
                  Remove budget
                </button>
              ) : null}
            </ServerActionForm>
          ) : null}

          <ServerActionForm
            action={deleteCategoryAction}
            className="flex flex-wrap items-end gap-2 border-t border-slate-800/80 pt-3"
            beforeSubmit={async () =>
              window.confirm(
                inUse
                  ? `Delete “${category.name}” and move its transactions to the category you picked?`
                  : `Delete “${category.name}”?`,
              )
            }
          >
            <input type="hidden" name="categoryId" value={category.id} />
            {inUse ? (
              <label className="min-w-0 flex-1 space-y-1">
                <span className="text-xs font-medium text-slate-400">Move its transactions to</span>
                <select
                  name="targetCategoryId"
                  className={selectClass}
                  aria-label={`Move ${category.name}'s transactions to`}
                  required
                  defaultValue=""
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
            ) : (
              <p className="min-w-0 flex-1 text-xs text-slate-500">No transactions use this category.</p>
            )}
            <button
              type="submit"
              className={`${smallBtnClass} text-red-200`}
              disabled={others.length === 0}
              aria-label={`Delete ${category.name}`}
            >
              Delete
            </button>
          </ServerActionForm>
        </div>
      </details>
    </li>
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
