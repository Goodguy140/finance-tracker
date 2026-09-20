/**
 * Saying plainly when a bank connection is costing money without earning it.
 *
 * Plaid bills per connected Item per month, whether or not that Item is usable. A
 * connection that needs re-authentication, whose consent has lapsed, or that feeds no
 * account is a standing charge with nothing coming back — and nothing else in the UI would
 * tell you, because a broken row otherwise just sits there looking inert.
 */
export type PlaidCostWarningInput = {
  status: string;
  consentExpiresAt: Date | null;
  hasMappedAccount: boolean;
};

export function describePlaidCostWarning(input: PlaidCostWarningInput): string | null {
  const suffix = "Plaid charges for every connected bank each month, so disconnect it if you no longer need it.";

  if (input.status === "LOGIN_REQUIRED") {
    return `This connection cannot fetch anything until you sign in again. ${suffix}`;
  }
  if (input.status === "ERROR") {
    return `This connection is failing and is not fetching anything. ${suffix}`;
  }
  if (input.consentExpiresAt && input.consentExpiresAt.getTime() <= Date.now()) {
    return `Your consent for this bank has expired, so it cannot fetch anything until you renew it. ${suffix}`;
  }
  if (!input.hasMappedAccount) {
    return `None of this bank's accounts are set to sync, so it is not fetching anything. Map one below, or disconnect it — Plaid charges for every connected bank each month.`;
  }
  return null;
}
