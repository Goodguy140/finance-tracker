import type { Prisma } from "@prisma/client";

/**
 * Deletes a user's financial data: what "Clear financial data" removes, and what a backup
 * restore replaces. One list for both, so a table added later cannot be left behind by one of
 * them (score history and closed months once were).
 *
 * Kept: the login, profile and preferences, sign-in methods, API tokens, webhooks, the calendar
 * link, phone notification devices, charge alert settings and the dashboard layout. Those are
 * how the person gets in and how the app behaves for them, not their financial records.
 *
 * Plaid items must already be revoked at Plaid (`revokePlaidItemsForUser`): deleting the rows
 * here ends nothing there.
 */
export async function wipeUserFinancialData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const where = { where: { userId } };
  await tx.user.update({ where: { id: userId }, data: { defaultExpenseAccountId: null } });
  await tx.transactionRule.deleteMany(where);
  await tx.hiddenTitleSuggestion.deleteMany(where);
  await tx.savedSearch.deleteMany(where);
  await tx.tag.deleteMany(where);
  await tx.insightDismissal.deleteMany(where);
  await tx.insightPreference.deleteMany(where);
  await tx.budget.deleteMany(where);
  await tx.yearlyBudget.deleteMany(where);
  await tx.budgetAlertNotification.deleteMany(where);
  await tx.recurringTransaction.deleteMany(where);
  await tx.investmentFlow.deleteMany(where);
  await tx.contributionRoom.deleteMany(where);
  await tx.portfolioSnapshot.deleteMany(where);
  await tx.savingsGoal.deleteMany(where);
  await tx.plannedTransaction.deleteMany(where);
  // History worked out from the data below: left in place it would compare a fresh start (or a
  // restored file) with figures that no longer exist.
  await tx.financialScoreSnapshot.deleteMany(where);
  await tx.monthClose.deleteMany(where);
  // Plaid rows reference Transaction and Account, so they go before both. Staged rows and
  // items are dropped outright rather than kept: a bank connection is not financial
  // history, and leaving stale cursors behind would make a later re-link re-propose
  // transactions against records that no longer exist.
  await tx.plaidStagedTransaction.deleteMany(where);
  await tx.transactionVerification.deleteMany(where);
  await tx.plaidAccount.deleteMany(where);
  await tx.plaidItem.deleteMany(where);
  await tx.transactionAttachment.deleteMany(where);
  await tx.deletedTransaction.deleteMany(where);
  await tx.transaction.deleteMany(where);
  await tx.accountReconciliation.deleteMany(where);
  await tx.account.deleteMany(where);
  await tx.category.deleteMany(where);
}
