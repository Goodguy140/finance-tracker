import type { PrismaClient } from "@prisma/client";

/**
 * The dashboard's first-run checklist. Each step is read from what the user already has, so it
 * ticks itself off as they go; the card goes once every step is done or the user hides it.
 */

export type GetStartedStepId = "bank" | "transactions" | "budget" | "recurring" | "balances";

export type GetStartedStep = {
  id: GetStartedStepId;
  label: string;
  hint: string;
  href: string;
  action: string;
  done: boolean;
};

export type GetStartedFacts = {
  plaidConfigured: boolean;
  bankCount: number;
  transactionCount: number;
  budgetCount: number;
  recurringCount: number;
  balanceCount: number;
};

export function getStartedSteps(facts: GetStartedFacts): GetStartedStep[] {
  const steps: GetStartedStep[] = [];
  // Without Plaid keys on the server there is nothing to connect to, so the step is left out.
  if (facts.plaidConfigured) {
    steps.push({
      id: "bank",
      label: "Connect a bank",
      hint: "Its transactions arrive in a review queue for you to add, nothing is booked on its own.",
      href: "/settings/banks",
      action: "Connect",
      done: facts.bankCount > 0,
    });
  }
  steps.push(
    {
      id: "transactions",
      label: "Bring in your history",
      hint: "Import a CSV your bank exported, or log your first expense on the Add card.",
      href: "/settings/import",
      action: "Import CSV",
      done: facts.transactionCount > 0,
    },
    {
      id: "budget",
      label: "Set a budget",
      hint: "Start from amounts suggested by your past spending, and the Budgets card shows what is left.",
      href: "/settings/categories?suggest=1",
      action: "Set budgets",
      done: facts.budgetCount > 0,
    },
    {
      id: "recurring",
      label: "Add a recurring bill",
      hint: "Rent, phone, subscriptions: Upcoming bills then forecasts what is due.",
      href: "#card-recurring",
      action: "Add a bill",
      done: facts.recurringCount > 0,
    },
    {
      id: "balances",
      label: "Record your account balances",
      hint: "Net worth and projected balances start from them.",
      href: "/settings/accounts",
      action: "Add balances",
      done: facts.balanceCount > 0,
    },
  );
  return steps;
}

/** The steps to show, or null when the card should not appear. */
export async function loadGetStarted(
  db: PrismaClient,
  user: { id: string; getStartedDismissedAt: Date | null },
  plaidConfigured: boolean,
): Promise<GetStartedStep[] | null> {
  if (user.getStartedDismissedAt) return null;
  const where = { userId: user.id };
  const [bankCount, transactionCount, budgetCount, recurringCount, balanceCount] = await Promise.all([
    db.plaidItem.count({ where }),
    db.transaction.count({ where }),
    db.budget.count({ where }),
    db.recurringTransaction.count({ where }),
    db.accountBalanceSnapshot.count({ where }),
  ]);
  const steps = getStartedSteps({ plaidConfigured, bankCount, transactionCount, budgetCount, recurringCount, balanceCount });
  return steps.every((step) => step.done) ? null : steps;
}
