/**
 * Deciding whether a Plaid account may feed one of the user's app accounts.
 *
 * Mapping is the point where a bank feed is pointed at a set of books, so the checks that
 * belong here are the ones that would otherwise corrupt totals silently.
 */

export type MappingAccountSummary = {
  id: string;
  name: string;
  currency: string;
  archived: boolean;
};

export type PlaidAccountSummary = {
  id: string;
  name: string;
  mask: string | null;
  /** Plaid does not always report one; unknown is not the same as mismatched. */
  currency: string | null;
};

export type MappingRefusal = { ok: false; reason: string };
export type MappingCheck = { ok: true } | MappingRefusal;

function label(account: PlaidAccountSummary): string {
  return account.mask ? `${account.name} ••${account.mask}` : account.name;
}

/**
 * Refuses a mapping that would mix currencies.
 *
 * This app stores amounts as bare integer cents with the currency held once, on the
 * account — there is no FX layer and no per-transaction currency. Feeding a USD card into
 * a CAD account would therefore add USD cents to CAD cents and quietly corrupt every
 * total, budget and chart downstream, with nothing on screen indicating why. Refusing is
 * recoverable in a way that silently wrong numbers are not.
 *
 * A currency Plaid did not report is allowed through: unknown is not the same as
 * mismatched, and blocking on missing metadata would strand legitimate accounts.
 */
export function checkCurrencyCompatible(
  plaidAccount: PlaidAccountSummary,
  appAccount: MappingAccountSummary,
): MappingCheck {
  const plaidCurrency = plaidAccount.currency?.trim().toUpperCase();
  if (!plaidCurrency) return { ok: true };

  const appCurrency = appAccount.currency.trim().toUpperCase();
  if (plaidCurrency === appCurrency) return { ok: true };

  return {
    ok: false,
    reason:
      `${label(plaidAccount)} is a ${plaidCurrency} account and “${appAccount.name}” is in ${appCurrency}. ` +
      `This app has no currency conversion — amounts are stored as plain cents against the account's own ` +
      `currency — so syncing one into the other would silently corrupt your totals. ` +
      `Create a ${plaidCurrency} account and map it there instead.`,
  };
}

/** An archived account is hidden from every picker; syncing into one would strand the rows. */
export function checkAccountSelectable(appAccount: MappingAccountSummary): MappingCheck {
  if (appAccount.archived) {
    return {
      ok: false,
      reason: `“${appAccount.name}” is archived. Unarchive it first, or choose a different account.`,
    };
  }
  return { ok: true };
}

/**
 * Every check that must pass before a Plaid account is pointed at an app account.
 * Returns the first refusal so the user gets one clear reason rather than a list.
 */
export function checkMappingAllowed(
  plaidAccount: PlaidAccountSummary,
  appAccount: MappingAccountSummary,
): MappingCheck {
  const selectable = checkAccountSelectable(appAccount);
  if (!selectable.ok) return selectable;
  return checkCurrencyCompatible(plaidAccount, appAccount);
}
