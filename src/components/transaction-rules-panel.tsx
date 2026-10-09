"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  applyTransactionRuleAction,
  createTransactionRuleAction,
  deleteTransactionRuleAction,
  hideLearnedTitleAction,
  moveTransactionRuleAction,
  previewTransactionRuleAction,
  setTransactionRuleEnabledAction,
  unhideLearnedTitleAction,
  updateTransactionRuleAction,
  type RulePreviewResult,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { useConfirm } from "@/components/settings/dialog";
import { MetaChip } from "@/components/meta-chip";
import { inputClass, primaryBtnClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import { formatCurrency } from "@/lib/money";
import {
  describeRuleActions,
  describeRuleCondition,
  resolveRuleOutcome,
  type RuleTransactionType,
  type TransactionRuleInput,
} from "@/lib/transaction-rules";
import { MAX_TAG_NAME_LENGTH, type TagOption } from "@/lib/tags";

export type TransactionRulesPanelProps = {
  rules: TransactionRuleInput[];
  /** Every learned Title → Category combo, newest first, flagged if the user hid it. */
  learned: { title: string; categoryId: string; hidden: boolean }[];
  /** Hidden titles that no longer appear in recent history, so they can still be unhidden. */
  orphanHiddenTitles: string[];
  categories: { id: string; name: string; kind: RuleTransactionType }[];
  accounts: { id: string; name: string; archived: boolean }[];
  /** With how many transactions carry each, for the Tags list. */
  tags: (TagOption & { transactionCount: number })[];
};

const sectionClass = "space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5";
const smallBtnClass =
  "touch-manipulation rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";
const labelTextClass = "text-sm font-medium text-slate-200";
const LEARNED_PAGE = 30;

type Draft = Partial<TransactionRuleInput> & { id?: string };

function centsToInput(cents: number | null | undefined) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

export function TransactionRulesPanel({
  rules,
  learned,
  orphanHiddenTitles,
  categories,
  accounts,
  tags,
}: TransactionRulesPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const confirm = useConfirm();
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement>(null);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "Deleted category";
  }, [categories]);
  const accountName = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? "Deleted account";
  }, [accounts]);
  const tagName = useMemo(() => {
    const map = new Map(tags.map((t) => [t.id, t.name]));
    return (id: string) => map.get(id) ?? "Deleted tag";
  }, [tags]);
  const categoryKinds = useMemo(
    () => new Map(categories.map((c) => [c.id, c.kind] as const)),
    [categories],
  );
  const labels = { category: categoryName, account: accountName, amount: formatCurrency, tag: tagName };

  function openEditor(next: Draft) {
    setDraft(next);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const visibleLearned = learned.filter((l) => !l.hidden);
  const hiddenTitles = [...learned.filter((l) => l.hidden).map((l) => l.title), ...orphanHiddenTitles];

  return (
    <div className="space-y-5">
      {confirm.dialog}
      <section className={sectionClass} aria-labelledby="rules-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 id="rules-list-heading" className="text-base font-semibold text-slate-100">
              Your rules
            </h3>
            <MetaChip label="Rules">{String(rules.length)}</MetaChip>
          </div>
          <button type="button" className={secondaryBtnClass} onClick={() => openEditor({})}>
            New rule
          </button>
        </div>
        <p className="max-w-prose text-xs leading-relaxed text-slate-400">
          Rules run top to bottom. Each field is filled by the first matching rule that sets it, so a broad rule and a
          narrower one can work together, except tags: every matching rule adds its tag. A rule always beats a learned combo below it. Rules never change an amount
          your bank or statement reports — they only suggest one when you add an entry by hand. Bank rows waiting in
          “From your bank” follow your rules as they stand, including rules added or changed after the sync.
        </p>

        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
            No rules yet. Create one, or turn a learned combo below into a rule.
          </p>
        ) : (
          <ol className="space-y-2">
            {rules.map((rule, index) => (
              <li
                key={rule.id}
                data-testid="transaction-rule"
                className={`space-y-2 rounded-xl border p-3 ${
                  rule.enabled ? "border-slate-800 bg-slate-950/50" : "border-slate-800/60 bg-slate-950/30 opacity-70"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm text-slate-100">
                      <span className="mr-1.5 text-xs tabular-nums text-slate-500">{index + 1}.</span>
                      {describeRuleCondition(rule, labels)}
                    </p>
                    <p className="text-xs text-slate-400">{describeRuleActions(rule, labels)}</p>
                  </div>
                  {!rule.enabled ? <MetaChip label="Status">Off</MetaChip> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <RuleButtonForm action={moveTransactionRuleAction} ruleId={rule.id} fields={{ direction: "up" }}>
                    <button type="submit" className={smallBtnClass} disabled={index === 0} aria-label="Move rule up">
                      ↑
                    </button>
                  </RuleButtonForm>
                  <RuleButtonForm action={moveTransactionRuleAction} ruleId={rule.id} fields={{ direction: "down" }}>
                    <button
                      type="submit"
                      className={smallBtnClass}
                      disabled={index === rules.length - 1}
                      aria-label="Move rule down"
                    >
                      ↓
                    </button>
                  </RuleButtonForm>
                  <RuleButtonForm
                    action={setTransactionRuleEnabledAction}
                    ruleId={rule.id}
                    fields={{ enabled: rule.enabled ? "false" : "true" }}
                  >
                    <button type="submit" className={smallBtnClass}>
                      {rule.enabled ? "Turn off" : "Turn on"}
                    </button>
                  </RuleButtonForm>
                  <button type="button" className={smallBtnClass} onClick={() => openEditor(rule)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={smallBtnClass}
                    aria-expanded={previewRuleId === rule.id}
                    onClick={() => setPreviewRuleId((id) => (id === rule.id ? null : rule.id))}
                  >
                    Apply to past…
                  </button>
                  <RuleButtonForm
                    action={deleteTransactionRuleAction}
                    ruleId={rule.id}
                    beforeSubmit={() =>
                      confirm.ask({
                        title: "Delete this rule?",
                        body: "Past transactions are not changed.",
                        confirmLabel: "Delete rule",
                        danger: true,
                      })
                    }
                  >
                    <button type="submit" className={`${smallBtnClass} text-red-200`}>
                      Delete
                    </button>
                  </RuleButtonForm>
                </div>
                {previewRuleId === rule.id ? (
                  <RulePreview
                    key={`${rule.id}:${describeRuleCondition(rule, labels)}:${describeRuleActions(rule, labels)}`}
                    ruleId={rule.id}
                    categoryName={categoryName}
                    accountName={accountName}
                    tagName={tagName}
                    onDone={() => setPreviewRuleId(null)}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {draft ? (
        <section ref={editorRef} className={`${sectionClass} scroll-mt-24`} aria-labelledby="rule-editor-heading">
          <RuleEditor
            key={draft.id ?? JSON.stringify(draft)}
            draft={draft}
            categories={categories}
            accounts={accounts}
            tags={tags}
            onDone={() => setDraft(null)}
          />
        </section>
      ) : null}

      <RuleTester
        rules={rules}
        learned={visibleLearned}
        categoryKinds={categoryKinds}
        categoryName={categoryName}
        tagName={tagName}
      />

      <details className={`group ${sectionClass}`} aria-labelledby="learned-heading">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-slate-500 transition group-open:rotate-90">
            ›
          </span>
          <h3 id="learned-heading" className="text-base font-semibold text-slate-100">
            Learned from history
          </h3>
          <MetaChip label="Learned">{String(visibleLearned.length)}</MetaChip>
        </summary>
        <p className="max-w-prose text-xs leading-relaxed text-slate-400">
          When an expense title matches one you have used before, its category is filled in from the most recent entry
          with that title. These combos come from your last few hundred expenses and update as you log more. Hide one
          to stop it filling in, or turn it into a rule to add more to it.
        </p>
        <LearnedList
          learned={visibleLearned}
          rules={rules}
          categoryKinds={categoryKinds}
          categoryName={categoryName}
          onMakeRule={(entry) =>
            openEditor({
              titleOperator: "EQUALS",
              titlePattern: entry.title,
              transactionType: "EXPENSE",
              setCategoryId: entry.categoryId,
            })
          }
        />
        {hiddenTitles.length > 0 ? (
          <details className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <summary className="cursor-pointer text-sm text-slate-300">Hidden ({hiddenTitles.length})</summary>
            <ul className="mt-2 space-y-1.5">
              {hiddenTitles.map((title) => (
                <li key={title} className="flex items-center justify-between gap-2 text-sm text-slate-400">
                  <span className="truncate">{title}</span>
                  <ServerActionForm action={unhideLearnedTitleAction}>
                    <input type="hidden" name="title" value={title} />
                    <button type="submit" className={smallBtnClass} aria-label={`Unhide ${title}`}>
                      Unhide
                    </button>
                  </ServerActionForm>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </details>
    </div>
  );
}

function RuleButtonForm({
  action,
  ruleId,
  fields = {},
  beforeSubmit,
  children,
}: {
  action: (formData: FormData) => Promise<unknown>;
  ruleId: string;
  fields?: Record<string, string>;
  beforeSubmit?: () => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <ServerActionForm action={action} beforeSubmit={beforeSubmit}>
      <input type="hidden" name="ruleId" value={ruleId} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </ServerActionForm>
  );
}

function RuleEditor({
  draft,
  categories,
  accounts,
  tags,
  onDone,
}: {
  draft: Draft;
  categories: TransactionRulesPanelProps["categories"];
  accounts: TransactionRulesPanelProps["accounts"];
  tags: TagOption[];
  onDone: () => void;
}) {
  const ids = useId();
  const editing = Boolean(draft.id);
  const [type, setType] = useState<"" | RuleTransactionType>(draft.transactionType ?? "");
  const categoryOptions = categories.filter((c) => !type || c.kind === type);
  const activeAccounts = accounts.filter((a) => !a.archived || a.id === draft.setAccountId);

  const field = (name: string, label: string, control: ReactNode, hint?: string) => (
    <label className="flex flex-col gap-1.5" htmlFor={`${ids}-${name}`}>
      <span className={labelTextClass}>{label}</span>
      {control}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );

  return (
    <ServerActionForm
      action={editing ? updateTransactionRuleAction : createTransactionRuleAction}
      onSuccess={onDone}
      className="space-y-4"
    >
      <h3 id="rule-editor-heading" className="text-base font-semibold text-slate-100">
        {editing ? "Edit rule" : "New rule"}
      </h3>
      {draft.id ? <input type="hidden" name="ruleId" value={draft.id} /> : null}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">When</legend>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {field(
            "titleOperator",
            "Title",
            <select
              id={`${ids}-titleOperator`}
              name="titleOperator"
              className={selectClass}
              defaultValue={draft.titleOperator ?? "CONTAINS"}
            >
              <option value="CONTAINS">contains</option>
              <option value="STARTS_WITH">starts with</option>
              <option value="EQUALS">is exactly</option>
            </select>,
          )}
          {field(
            "titlePattern",
            "Text to match",
            <input
              id={`${ids}-titlePattern`}
              name="titlePattern"
              className={inputClass}
              defaultValue={draft.titlePattern ?? ""}
              placeholder="e.g. NETFLIX"
              maxLength={200}
              required
            />,
            "Not case-sensitive. Bank rows are matched on both the bank's description and the merchant name.",
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            "transactionType",
            "Type",
            <select
              id={`${ids}-transactionType`}
              name="transactionType"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as "" | RuleTransactionType)}
            >
              <option value="">Expenses and income</option>
              <option value="EXPENSE">Expenses only</option>
              <option value="INCOME">Income only</option>
            </select>,
          )}
          {field(
            "matchAccountId",
            "On account",
            <select
              id={`${ids}-matchAccountId`}
              name="matchAccountId"
              className={selectClass}
              defaultValue={draft.matchAccountId ?? ""}
            >
              <option value="">Any account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>,
          )}
          {field(
            "minAmount",
            "Amount from",
            <input
              id={`${ids}-minAmount`}
              name="minAmount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={inputClass}
              defaultValue={centsToInput(draft.minAmountCents)}
              placeholder="Any"
            />,
          )}
          {field(
            "maxAmount",
            "Amount up to",
            <input
              id={`${ids}-maxAmount`}
              name="maxAmount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={inputClass}
              defaultValue={centsToInput(draft.maxAmountCents)}
              placeholder="Any"
            />,
            "Refunds match by their size, so they land in the same category as the charge.",
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Then set</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            "setCategoryId",
            "Category",
            <select
              id={`${ids}-setCategoryId`}
              name="setCategoryId"
              className={selectClass}
              defaultValue={draft.setCategoryId ?? ""}
            >
              <option value="">Leave as is</option>
              {(["EXPENSE", "INCOME"] as const).map((kind) => {
                const options = categoryOptions.filter((c) => c.kind === kind);
                if (options.length === 0) return null;
                return (
                  <optgroup key={kind} label={kind === "EXPENSE" ? "Expense categories" : "Income categories"}>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>,
            "Choosing a category limits the rule to that category's type.",
          )}
          {field(
            "setTitle",
            "Rename to",
            <input
              id={`${ids}-setTitle`}
              name="setTitle"
              className={inputClass}
              defaultValue={draft.setTitle ?? ""}
              placeholder="Leave as is"
              maxLength={120}
            />,
          )}
          {field(
            "setAmount",
            "Amount",
            <input
              id={`${ids}-setAmount`}
              name="setAmount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              className={inputClass}
              defaultValue={centsToInput(draft.setAmountCents)}
              placeholder="Leave as is"
            />,
            "Only pre-fills an empty amount when you add an entry by hand.",
          )}
          {field(
            "setAccountId",
            "Account",
            <select
              id={`${ids}-setAccountId`}
              name="setAccountId"
              className={selectClass}
              defaultValue={draft.setAccountId ?? ""}
            >
              <option value="">Leave as is</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>,
            "Not applied to bank rows — their account is the bank's.",
          )}
          {field(
            "appendNote",
            "Add note",
            <input
              id={`${ids}-appendNote`}
              name="appendNote"
              className={inputClass}
              defaultValue={draft.appendNote ?? ""}
              placeholder="Leave as is"
              maxLength={250}
            />,
          )}
          {field(
            "addTag",
            "Add tag",
            <>
              <input
                id={`${ids}-addTag`}
                name="addTag"
                className={inputClass}
                defaultValue={tags.find((t) => t.id === draft.addTagId)?.name ?? ""}
                placeholder="None"
                maxLength={MAX_TAG_NAME_LENGTH}
                list={`${ids}-tag-options`}
                autoComplete="off"
              />
              <datalist id={`${ids}-tag-options`}>
                {tags.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
            </>,
            "Kept alongside the tags a transaction already has. A new name creates the tag.",
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryBtnClass}>
          {editing ? "Save rule" : "Create rule"}
        </button>
        <button type="button" className={secondaryBtnClass} onClick={onDone}>
          Cancel
        </button>
      </div>
    </ServerActionForm>
  );
}

function RulePreview({
  ruleId,
  categoryName,
  accountName,
  tagName,
  onDone,
}: {
  ruleId: string;
  categoryName: (id: string) => string;
  accountName: (id: string) => string;
  tagName: (id: string) => string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<RulePreviewResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    previewTransactionRuleAction(ruleId).then((result) => {
      if (live) setPreview(result);
    });
    return () => {
      live = false;
    };
  }, [ruleId]);

  function apply() {
    startTransition(async () => {
      const result = await applyTransactionRuleAction(ruleId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(`Updated ${result.updated} transaction${result.updated === 1 ? "" : "s"}.`);
      setPreview(null);
      router.refresh();
    });
  }

  const describe = (field: "title" | "categoryId" | "accountId" | "note", value: string | null) => {
    if (!value) return "—";
    if (field === "categoryId") return categoryName(value);
    if (field === "accountId") return accountName(value);
    return value;
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm" data-testid="rule-preview">
      {message ? <p className="text-emerald-200">{message}</p> : null}
      {!preview && !message ? <p className="text-slate-400">Checking your transactions…</p> : null}
      {preview && !preview.ok ? <p className="text-red-200">{preview.error}</p> : null}
      {preview?.ok ? (
        preview.total === 0 ? (
          <p className="text-slate-400">No past transactions would change.</p>
        ) : (
          <>
            <p className="text-slate-200">
              {preview.total} past transaction{preview.total === 1 ? "" : "s"} would change
              {preview.total > preview.sample.length ? ` (first ${preview.sample.length} shown)` : ""}. Amounts are never
              changed; split transactions are skipped.
            </p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {preview.sample.map((change) => (
                <li key={change.id} className="rounded-md bg-slate-950/60 px-2 py-1.5 text-xs text-slate-300">
                  <p className="font-medium text-slate-100">{change.before.title ?? "Untitled"}</p>
                  {(["title", "categoryId", "accountId", "note"] as const)
                    .filter((f) => change.before[f] !== change.after[f])
                    .map((f) => (
                      <p key={f}>
                        {f === "categoryId" ? "Category" : f === "accountId" ? "Account" : f === "title" ? "Title" : "Note"}:{" "}
                        <span className="text-slate-500 line-through">{describe(f, change.before[f])}</span> →{" "}
                        <span className="text-slate-100">{describe(f, change.after[f])}</span>
                      </p>
                    ))}
                  {change.addTagId ? (
                    <p>
                      Tag: <span className="text-slate-100">+ {tagName(change.addTagId)}</span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryBtnClass} disabled={pending} onClick={apply}>
                Update {preview.total} transaction{preview.total === 1 ? "" : "s"}
              </button>
              <button type="button" className={secondaryBtnClass} onClick={onDone}>
                Cancel
              </button>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function RuleTester({
  rules,
  learned,
  categoryKinds,
  categoryName,
  tagName,
}: {
  rules: TransactionRuleInput[];
  learned: { title: string; categoryId: string }[];
  categoryKinds: ReadonlyMap<string, RuleTransactionType>;
  categoryName: (id: string) => string;
  tagName: (id: string) => string;
}) {
  const ids = useId();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<RuleTransactionType>("EXPENSE");
  const amountNumber = Number(amount);
  const outcome = title.trim()
    ? resolveRuleOutcome(
        rules,
        {
          texts: [title],
          amountCents: amount.trim() && Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) : null,
          accountId: null,
          type,
        },
        categoryKinds,
        { learned, hiddenTitleKeys: [] },
      )
    : null;
  const ruleNumbers = outcome?.ruleIds.map((id) => rules.findIndex((r) => r.id === id) + 1) ?? [];

  return (
    <section className={sectionClass} aria-labelledby="rule-tester-heading">
      <h3 id="rule-tester-heading" className="text-base font-semibold text-slate-100">
        Try a title
      </h3>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]">
        <label className="flex flex-col gap-1.5" htmlFor={`${ids}-title`}>
          <span className={labelTextClass}>Title</span>
          <input id={`${ids}-title`} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. NETFLIX.COM 866-579" />
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${ids}-amount`}>
          <span className={labelTextClass}>Amount</span>
          <input id={`${ids}-amount`} className={inputClass} type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Optional" />
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${ids}-type`}>
          <span className={labelTextClass}>Type</span>
          <select id={`${ids}-type`} className={selectClass} value={type} onChange={(e) => setType(e.target.value as RuleTransactionType)}>
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </select>
        </label>
      </div>
      {outcome ? (
        <div className="text-sm text-slate-300" role="status" data-testid="rule-tester-result">
          {outcome.ruleIds.length === 0 && !outcome.categoryId ? (
            <p>Nothing would be filled in.</p>
          ) : (
            <ul className="space-y-0.5">
              {outcome.categoryId ? (
                <li>
                  Category: <span className="text-slate-100">{categoryName(outcome.categoryId)}</span>{" "}
                  <span className="text-slate-500">({outcome.categoryFrom === "learned" ? "learned" : "rule"})</span>
                </li>
              ) : null}
              {outcome.title ? <li>Title: <span className="text-slate-100">{outcome.title}</span></li> : null}
              {outcome.amountCents !== undefined ? (
                <li>Amount: <span className="text-slate-100">{formatCurrency(outcome.amountCents)}</span></li>
              ) : null}
              {outcome.appendNote ? <li>Note: <span className="text-slate-100">{outcome.appendNote}</span></li> : null}
              {outcome.tagIds.length > 0 ? (
                <li>
                  Tags: <span className="text-slate-100">{outcome.tagIds.map(tagName).join(", ")}</span>
                </li>
              ) : null}
              {ruleNumbers.length > 0 ? (
                <li className="text-xs text-slate-500">From rule{ruleNumbers.length === 1 ? "" : "s"} {ruleNumbers.join(", ")}</li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LearnedList({
  learned,
  rules,
  categoryKinds,
  categoryName,
  onMakeRule,
}: {
  learned: { title: string; categoryId: string }[];
  rules: TransactionRuleInput[];
  categoryKinds: ReadonlyMap<string, RuleTransactionType>;
  categoryName: (id: string) => string;
  onMakeRule: (entry: { title: string; categoryId: string }) => void;
}) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(LEARNED_PAGE);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? learned.filter((l) => l.title.toLowerCase().includes(q) || categoryName(l.categoryId).toLowerCase().includes(q))
    : learned;

  if (learned.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
        Nothing learned yet — titled expenses you log will show up here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1.5" htmlFor={`${ids}-search`}>
        <span className="sr-only">Search learned combos</span>
        <input
          id={`${ids}-search`}
          type="search"
          className={inputClass}
          placeholder="Search titles or categories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/40">
        {filtered.slice(0, limit).map((entry) => {
          const overriddenBy = resolveRuleOutcome(
            rules,
            { texts: [entry.title], amountCents: null, accountId: null, type: "EXPENSE" },
            categoryKinds,
          );
          const overridden = overriddenBy.categoryFrom === "rule" && overriddenBy.categoryId !== entry.categoryId;
          const covered = overriddenBy.categoryFrom === "rule" && !overridden;
          return (
            <li
              key={entry.title}
              data-testid="learned-combo"
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-100">{entry.title}</p>
                <p className="text-xs text-slate-400">
                  → {categoryName(entry.categoryId)}
                  {overridden ? (
                    <span className="text-amber-200/90"> · a rule sets {categoryName(overriddenBy.categoryId!)} instead</span>
                  ) : covered ? (
                    <span className="text-slate-500"> · also set by a rule</span>
                  ) : null}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className={smallBtnClass}
                  onClick={() => onMakeRule(entry)}
                  aria-label={`Make a rule from ${entry.title}`}
                >
                  Make rule
                </button>
                <ServerActionForm action={hideLearnedTitleAction}>
                  <input type="hidden" name="title" value={entry.title} />
                  <button type="submit" className={smallBtnClass} aria-label={`Hide ${entry.title}`}>
                    Hide
                  </button>
                </ServerActionForm>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 ? <li className="px-3 py-2 text-sm text-slate-400">No matches.</li> : null}
      </ul>
      {filtered.length > limit ? (
        <button type="button" className={secondaryBtnClass} onClick={() => setLimit((n) => n + LEARNED_PAGE * 3)}>
          Show more ({filtered.length - limit} left)
        </button>
      ) : null}
    </div>
  );
}

