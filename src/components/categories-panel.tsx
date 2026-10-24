"use client";

import { useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  setCategoryBudgetAction,
  setCategoryGroupAction,
  setCategoryRolloverAction,
  setPlaidCategoryMappingAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { ConfirmDialog, dangerBtnClass, FormDialog, ModalShell } from "@/components/settings/dialog";
import { inputClass, primaryBtnClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import { MAX_GROUP_NAME_LENGTH, hasGroups, sectionByGroup } from "@/lib/category-groups";
import { formatCurrency } from "@/lib/money";

type Kind = "EXPENSE" | "INCOME";

export type CategoryRow = {
  id: string;
  name: string;
  kind: Kind;
  /** The group it is filed under, or null. */
  groupName: string | null;
  transactionCount: number;
  /** Split lines and recurring rules filed under it; with transactions, what blocks a plain delete. */
  splitCount: number;
  recurringCount: number;
  /** The budget in force this month, if any. */
  budgetLimitCents: number | null;
  /** Spent this month, for budgeted expense categories; null when there is no budget. */
  spentCents: number | null;
  /** Whether unspent (or overspent) budget carries into the next month. */
  rolloverOn: boolean;
  /** Carried into this month by rollover; 0 when none. */
  carryCents: number;
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

const smallBtnClass =
  "touch-manipulation rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

const KIND_HEADINGS: Record<Kind, string> = { EXPENSE: "Expense categories", INCOME: "Income categories" };
const KIND_TABS: Record<Kind, string> = { EXPENSE: "Expenses", INCOME: "Income" };

export function CategoriesPanel({ categories, plaidGroups, hasLinkedBank }: CategoriesPanelProps) {
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [adding, setAdding] = useState(false);
  const mappedCount = plaidGroups.reduce(
    (n, g) => n + (g.mappedCategoryId ? 1 : 0) + g.detailed.filter((d) => d.mappedCategoryId).length,
    0,
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Category type" className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {(["EXPENSE", "INCOME"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-sm transition ${
                kind === k ? "bg-slate-800 text-slate-50" : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {KIND_TABS[k]} <span className="text-xs text-slate-500">{categories.filter((c) => c.kind === k).length}</span>
            </button>
          ))}
        </div>
        <button type="button" className={primaryBtnClass} onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          New category
        </button>
      </div>
      <CategoryListSection
        key={kind}
        kind={kind}
        categories={categories.filter((c) => c.kind === kind)}
        sameKind={categories.filter((c) => c.kind === kind)}
      />
      <details className="group rounded-xl border border-slate-800 bg-slate-900/30">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm transition hover:bg-slate-900/60 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-slate-500 transition group-open:rotate-90">
            ›
          </span>
          <span className="font-medium text-slate-200">Bank category mapping</span>
          <span className="text-xs text-slate-500">
            {mappedCount > 0 ? `${mappedCount} changed from the default` : "All on the default"}
          </span>
        </summary>
        <div className="border-t border-slate-800 p-4">
          <PlaidMappingSection groups={plaidGroups} categories={categories} hasLinkedBank={hasLinkedBank} />
        </div>
      </details>
      {adding ? <AddCategoryDialog initialKind={kind} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function AddCategoryDialog({ initialKind, onClose }: { initialKind: Kind; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  return (
    <FormDialog title="New category" onClose={onClose}>
      <ServerActionForm action={createCategoryAction} onSuccess={onClose} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Name</span>
          <input name="name" className={inputClass} placeholder="e.g. Pets" maxLength={80} required autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Type</span>
            <select name="kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="EXPENSE">Expense</option>
              <option value="INCOME">Income</option>
            </select>
          </label>
          {kind === "EXPENSE" ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-300">Monthly budget</span>
              <input name="limit" inputMode="decimal" className={inputClass} placeholder="Optional" />
            </label>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtnClass}>
            Add category
          </button>
        </div>
      </ServerActionForm>
    </FormDialog>
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
  const groupNames = [...new Set(sameKind.map((c) => c.groupName).filter((g): g is string => Boolean(g)))].sort();
  const item = (category: CategoryRow) => (
    <CategoryItem
      key={category.id}
      category={category}
      others={sameKind.filter((c) => c.id !== category.id)}
      groupNames={groupNames}
    />
  );
  const listClass = "divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50";
  return (
    <section aria-label={KIND_HEADINGS[kind]}>
      {categories.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">None yet.</p>
      ) : !hasGroups(categories, (c) => c.groupName) ? (
        <ul className={listClass}>{categories.map(item)}</ul>
      ) : (
        <div className="space-y-3">
          {sectionByGroup(categories, (c) => c.groupName).map((section) => (
            <div key={section.groupName ?? ""} data-testid="category-group" className="space-y-1.5">
              <GroupHeading kind={kind} groupName={section.groupName} members={section.items} />
              <ul className={listClass}>{section.items.map(item)}</ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A group's name over its categories, with its budgets and this month's spend added up. */
function GroupHeading({ kind, groupName, members }: { kind: Kind; groupName: string | null; members: CategoryRow[] }) {
  const budgeted = members.filter((c) => c.budgetLimitCents !== null);
  const limit = budgeted.reduce((sum, c) => sum + (c.budgetLimitCents ?? 0) + c.carryCents, 0);
  const spent = budgeted.reduce((sum, c) => sum + (c.spentCents ?? 0), 0);
  return (
    <div className="flex items-center gap-3 px-1">
      <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
        {groupName ?? "Not grouped"}
      </h3>
      {kind === "EXPENSE" && groupName && budgeted.length > 0 ? (
        <span data-testid="category-group-total" className="shrink-0 text-xs tabular-nums text-slate-400">
          {formatCurrency(spent)} of {formatCurrency(limit)} this month
        </span>
      ) : null}
    </div>
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

function CategoryItem({
  category,
  others,
  groupNames,
}: {
  category: CategoryRow;
  others: CategoryRow[];
  groupNames: string[];
}) {
  const groupListId = useId();
  // Everything that would block deleting it (Restrict relations), not only transactions:
  // a category used only by a recurring rule must still offer somewhere to move it.
  const inUse = category.transactionCount + category.splitCount + category.recurringCount > 0;
  const [dialog, setDialog] = useState<null | "delete" | "removeBudget" | { mergeInto: string }>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const removeBudgetButton = useRef<HTMLButtonElement>(null);

  return (
    <li data-testid="category-row">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-slate-900 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-100">{category.name}</span>
            <span className="block text-xs text-slate-500">
              {category.transactionCount} transaction{category.transactionCount === 1 ? "" : "s"}
            </span>
          </span>
          {category.kind === "EXPENSE" && category.budgetLimitCents !== null ? (
            <BudgetMeter
              spentCents={category.spentCents ?? 0}
              limitCents={category.budgetLimitCents + category.carryCents}
            />
          ) : null}
          {category.kind === "EXPENSE" ? (
            <span
              className={`w-24 shrink-0 text-right text-xs font-medium tabular-nums ${
                category.budgetLimitCents === null ? "text-slate-500" : "text-slate-200"
              }`}
            >
              {category.budgetLimitCents === null ? "No budget" : `${formatCurrency(category.budgetLimitCents)}/mo`}
            </span>
          ) : null}
          <span aria-hidden className="shrink-0 text-slate-500 transition group-open:rotate-90">
            ›
          </span>
        </summary>

        <div className="space-y-3 border-t border-slate-800/80 px-4 pb-4 pt-3">
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
            <p className="w-full text-xs text-slate-500">Renaming it to another category&apos;s name merges the two.</p>
          </ServerActionForm>

          <ServerActionForm
            key={category.groupName ?? "none"}
            action={setCategoryGroupAction}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="categoryId" value={category.id} />
            <label className="min-w-0 flex-1 space-y-1">
              <span className="text-xs font-medium text-slate-400">Group</span>
              <input
                name="groupName"
                list={groupListId}
                aria-label={`Group for ${category.name}`}
                className={inputClass}
                defaultValue={category.groupName ?? ""}
                placeholder="Not grouped"
                maxLength={MAX_GROUP_NAME_LENGTH}
              />
              <datalist id={groupListId}>
                {groupNames.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <button type="submit" className={smallBtnClass}>
              Save group
            </button>
            <p className="w-full text-xs text-slate-500">
              Categories in the same group are added up on the Budgets card, the spending pie and Reports. Leave it empty
              to take it out of a group.
            </p>
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

          {category.kind === "EXPENSE" && category.budgetLimitCents !== null ? (
            <RolloverToggle category={category} />
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

/** The budget rollover switch, saved as soon as it changes. */
function RolloverToggle({ category }: { category: CategoryRow }) {
  return (
    <ServerActionForm action={setCategoryRolloverAction} className="space-y-1">
      <input type="hidden" name="categoryId" value={category.id} />
      <input type="hidden" name="enabled" value={category.rolloverOn ? "false" : "true"} />
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          // Re-mounted when the saved value changes, so a refresh after saving shows the server's answer.
          key={String(category.rolloverOn)}
          type="checkbox"
          aria-label={`Roll over ${category.name}'s budget`}
          className="h-4 w-4 rounded border-slate-600 bg-slate-900"
          defaultChecked={category.rolloverOn}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        Roll over to next month
      </label>
      <p className="text-xs text-slate-500">
        {category.rolloverOn
          ? category.carryCents > 0
            ? `${formatCurrency(category.carryCents)} left over from earlier months is added to this month's budget.`
            : category.carryCents < 0
              ? `${formatCurrency(-category.carryCents)} overspent in earlier months comes off this month's budget.`
              : "What's left of this month's budget carries into next month; going over takes it off next month's."
          : "What's left at the end of a month is added to the next one, and going over takes it off. It starts from this month."}
      </p>
    </ServerActionForm>
  );
}

/** This month's spend against the budget, as a bar; amber from 80%, red past the limit. */
function BudgetMeter({ spentCents, limitCents }: { spentCents: number; limitCents: number }) {
  const ratio = limitCents > 0 ? spentCents / limitCents : 0;
  const tone = ratio > 1 ? "bg-red-400" : ratio >= 0.8 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <span className="hidden w-36 shrink-0 items-center gap-2 sm:flex" title={`${formatCurrency(spentCents)} spent this month`}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800" aria-hidden>
        <span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
      </span>
      <span className="w-14 text-right text-xs tabular-nums text-slate-400">{formatCurrency(spentCents)}</span>
    </span>
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
    <section className="space-y-3" aria-label="Bank categories">
      <p className="text-sm text-slate-400">
        Which of your categories a linked bank&apos;s transactions are suggested under in the review queue. Open a row
        to set more specific ones, like groceries apart from restaurants.
        {hasLinkedBank ? " Rows waiting for review update straight away." : ""}
      </p>
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
