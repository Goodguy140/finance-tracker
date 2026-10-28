"use client";

import { useMemo, useState } from "react";
import type { RecurringCadence } from "@prisma/client";
import { applyScenario, SCENARIO_DAYS, type ScenarioChange } from "@/lib/forecast-scenarios";
import { formatCurrency } from "@/lib/money";
import type { AccountBalanceRow } from "@/lib/net-worth";
import { projectBalances, type ProjectableRule } from "@/lib/projected-balances";

const fieldClass =
  "w-full min-h-[2.5rem] rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-400";
const btnClass =
  "touch-manipulation rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50";

const CADENCES: Array<{ value: RecurringCadence; label: string }> = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

function describe(change: ScenarioChange, fmt: (c: number) => string, ruleName: (id: string) => string): string {
  if (change.kind === "add") {
    return `${change.type === "INCOME" ? "New income" : "New bill"} ${change.name ? `“${change.name}” ` : ""}${fmt(change.amountCents)} ${change.cadence.toLowerCase()} from ${change.startYmd}`;
  }
  if (change.kind === "income") return `Income ${change.pct > 0 ? "+" : ""}${change.pct}% from ${change.fromYmd}`;
  return `Without ${change.ruleIds.map(ruleName).join(", ")}`;
}

/**
 * What-if scenarios layered on the projected balances (`src/lib/forecast-scenarios.ts`). The
 * changes live only in this component's state: trying something never touches the rules.
 */
export function WhatIfPanel({
  accounts,
  rules,
  todayYmd,
  includeTransfers,
  currency,
}: {
  accounts: AccountBalanceRow[];
  rules: ProjectableRule[];
  todayYmd: string;
  includeTransfers: boolean;
  currency: string;
}) {
  const fmt = (cents: number) => formatCurrency(cents, currency);
  const [changes, setChanges] = useState<ScenarioChange[]>([]);
  const [kind, setKind] = useState<ScenarioChange["kind"]>("add");
  const projected = accounts.filter((a) => a.counted && a.latest);
  const [addType, setAddType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [addName, setAddName] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addCadence, setAddCadence] = useState<RecurringCadence>("MONTHLY");
  const [startYmd, setStartYmd] = useState(todayYmd);
  const [accountId, setAccountId] = useState(projected.find((a) => !a.liability)?.accountId ?? projected[0]?.accountId ?? "");
  const [pct, setPct] = useState("5");
  const [removeIds, setRemoveIds] = useState<string[]>([]);

  const removable = rules.filter((r) => r.id && r.type === "EXPENSE");
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name ?? "a rule";

  const base = { accounts, todayYmd, currentYm: todayYmd.slice(0, 7), includeTransfers, days: SCENARIO_DAYS };
  const baseline = useMemo(() => projectBalances({ ...base, rules }), [accounts, rules, todayYmd, includeTransfers]); // eslint-disable-line react-hooks/exhaustive-deps
  const scenario = useMemo(
    () => projectBalances({ ...base, rules: applyScenario(rules, changes) }),
    [accounts, rules, todayYmd, includeTransfers, changes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const amountCents = Math.round(Number(addAmount) * 100);
  const canAdd =
    kind === "add"
      ? Number.isFinite(amountCents) && amountCents > 0 && Boolean(accountId) && /^\d{4}-\d{2}-\d{2}$/.test(startYmd)
      : kind === "income"
        ? Number.isFinite(Number(pct)) && Number(pct) !== 0 && Number(pct) > -100 && /^\d{4}-\d{2}-\d{2}$/.test(startYmd)
        : removeIds.length > 0;

  function addChange() {
    if (!canAdd) return;
    const change: ScenarioChange =
      kind === "add"
        ? { kind, name: addName.trim(), type: addType, amountCents, cadence: addCadence, startYmd, accountId }
        : kind === "income"
          ? { kind, pct: Number(pct), fromYmd: startYmd }
          : { kind, ruleIds: removeIds };
    setChanges((prev) => [...prev, change]);
    setAddName("");
    setAddAmount("");
    setRemoveIds([]);
  }

  const dips = scenario.accounts.filter((a) => a.belowZero && !baseline.accounts.find((b) => b.accountId === a.accountId)?.belowZero);

  return (
    <div className="mt-4 border-t border-slate-800 pt-3" data-testid="what-if">
      <h3 className="text-base font-semibold">What if…</h3>
      <p className="mb-2 text-sm text-slate-400">
        Try a change and see net worth against today&apos;s plan over the next year. Nothing is saved.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of change">
        {(
          [
            ["add", "New bill or income"],
            ["income", "Income changes"],
            ["remove", "Drop bills"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              kind === value ? "border-sky-400/60 bg-sky-500/15 text-sky-100" : "border-slate-700 bg-slate-900 text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {kind === "add" ? (
          <>
            <select aria-label="Bill or income" className={fieldClass} value={addType} onChange={(e) => setAddType(e.target.value as "EXPENSE" | "INCOME")}>
              <option value="EXPENSE">Bill</option>
              <option value="INCOME">Income</option>
            </select>
            <input aria-label="What it is" className={fieldClass} placeholder="e.g. Car payment" value={addName} onChange={(e) => setAddName(e.target.value)} />
            <input aria-label="Amount" className={fieldClass} inputMode="decimal" placeholder="Amount" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} />
            <select aria-label="How often" className={fieldClass} value={addCadence} onChange={(e) => setAddCadence(e.target.value as RecurringCadence)}>
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select aria-label="Account" className={fieldClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {projected.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
            </select>
            <input aria-label="Starting" type="date" className={fieldClass} value={startYmd} onChange={(e) => setStartYmd(e.target.value)} />
          </>
        ) : kind === "income" ? (
          <>
            <input aria-label="Change in percent" className={fieldClass} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
            <input aria-label="Starting" type="date" className={fieldClass} value={startYmd} onChange={(e) => setStartYmd(e.target.value)} />
          </>
        ) : removable.length === 0 ? (
          <p className="text-sm text-slate-400 sm:col-span-3">No recurring bills to drop.</p>
        ) : (
          <fieldset className="space-y-1 sm:col-span-3">
            <legend className="sr-only">Bills to drop</legend>
            {removable.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={removeIds.includes(r.id!)}
                  onChange={(e) =>
                    setRemoveIds((prev) => (e.target.checked ? [...prev, r.id!] : prev.filter((id) => id !== r.id)))
                  }
                />
                {r.name} · {fmt(r.amountCents)} {r.planned ? `planned for ${r.nextExpectedDate.toISOString().slice(0, 10)}` : r.cadence.toLowerCase()}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={btnClass} disabled={!canAdd} onClick={addChange}>
          Add to scenario
        </button>
        {changes.length > 0 ? (
          <button type="button" className={btnClass} onClick={() => setChanges([])}>
            Clear
          </button>
        ) : null}
      </div>
      {changes.length > 0 ? (
        <>
          <ul className="mt-3 space-y-1 text-sm" data-testid="what-if-changes">
            {changes.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-2 py-1">
                <span className="min-w-0 truncate">{describe(c, fmt, ruleName)}</span>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-200"
                  aria-label={`Remove change ${i + 1}`}
                  onClick={() => setChanges((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-right text-xs tabular-nums sm:text-sm" data-testid="what-if-results">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 text-left font-medium">Net worth</th>
                  {SCENARIO_DAYS.map((d) => (
                    <th key={d} className="py-1 font-medium">
                      {d === 365 ? "1 year" : `${d} days`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1 text-left text-slate-400">Today&apos;s plan</td>
                  {SCENARIO_DAYS.map((d, i) => (
                    <td key={d}>{fmt(baseline.netCents[i + 1])}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1 text-left text-slate-400">With the changes</td>
                  {SCENARIO_DAYS.map((d, i) => (
                    <td key={d}>{fmt(scenario.netCents[i + 1])}</td>
                  ))}
                </tr>
                <tr className="font-semibold">
                  <td className="py-1 text-left">Difference</td>
                  {SCENARIO_DAYS.map((d, i) => {
                    const diff = scenario.netCents[i + 1] - baseline.netCents[i + 1];
                    return (
                      <td key={d} className={diff >= 0 ? "text-emerald-300" : "text-amber-300"}>
                        {diff >= 0 ? "+" : "−"}
                        {fmt(Math.abs(diff))}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {dips.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {dips.map((a) => (
                <li key={a.accountId}>
                  {a.name} would go below zero on {a.belowZero!.date.toISOString().slice(0, 10)}.
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
