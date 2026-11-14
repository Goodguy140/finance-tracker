import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseAppPeriod } from "@/lib/api-v1/period";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { COMPARISONS, loadAppSpending, type SpendingChoice } from "@/lib/api-v1/spending";
import type { CumulativeComparison } from "@/lib/cumulative-spend";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spending?month=YYYY-MM&compare=none|last-month|three-month-average&savings=1|0 — the
 * dashboard's Cumulative spending and Spending by category cards for a month (this month when
 * `month` is left out), for the phone app's Home screen. `range=ytd` (through `month`) or
 * `range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` shows that period instead: by month, or by day for a
 * range of up to 62 days, with no comparison. `compare` and `savings` are the cards' Compare with
 * and Show savings; left out, they follow the website's card settings. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "spending");
  if (!authorized.ok) return authorized.response;
  const { user } = authorized.auth;
  const params = new URL(request.url).searchParams;

  const parsed = parseAppPeriod(params, user.timezone);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const choice: SpendingChoice = {};
  const compare = params.get("compare");
  if (compare !== null) {
    if (!COMPARISONS.includes(compare as CumulativeComparison)) {
      return apiError("Invalid 'compare' parameter — expected none, last-month or three-month-average.", 400);
    }
    choice.compareWith = compare as CumulativeComparison;
  }
  const savings = params.get("savings");
  if (savings !== null) {
    if (savings !== "1" && savings !== "0") return apiError("Invalid 'savings' parameter — expected 1 or 0.", 400);
    choice.showSavings = savings === "1";
  }

  return NextResponse.json(await loadAppSpending(user, parsed.period, choice), { headers: NO_STORE });
}
