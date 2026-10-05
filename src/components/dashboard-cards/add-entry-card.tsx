"use client";

import { type ComponentProps, useState } from "react";
import { ExpenseForm, IncomeForm } from "@/components/forms";

type Option = { id: string; name: string };

/**
 * The Add card: logging an expense or an income from the same place. Income used to sit behind
 * the header's Add menu, a click and a tab away from the expense form beside it; the phone has
 * long had both side by side as its two quick-add buttons, and this is the desktop's version.
 */
export function AddEntryCardBody({
  expense,
  incomeCategories,
}: {
  expense: ComponentProps<typeof ExpenseForm>;
  incomeCategories: Option[];
}) {
  const [kind, setKind] = useState<"expense" | "income">("expense");

  return (
    <>
      <div role="radiogroup" aria-label="What to add" className="mb-3 inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5">
        {(["expense", "income"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            onClick={() => setKind(option)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              kind === option ? "bg-blue-500 text-white" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {option === "expense" ? "Expense" : "Income"}
          </button>
        ))}
      </div>
      {kind === "expense" ? (
        <ExpenseForm {...expense} />
      ) : (
        <IncomeForm accounts={expense.accounts} incomeCategories={incomeCategories} />
      )}
    </>
  );
}
