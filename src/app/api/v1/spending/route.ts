import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { COMPARISONS, loadAppSpending, type SpendingChoice } from "@/lib/api-v1/spending";
import type { CumulativeComparison } from "@/lib/cumulative-spend";
import { currentYmInTimeZone } from "@/lib/period-month";
import { monthParamSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spending?month=YYYY-MM&compare=none|last-month|three-month-average&savings=1|0 — the
 * dashboard's Cumulative spending and Spending by category cards for a month (this month when
 * `month` is left out), for the phone app's Home screen. `compare` and `savings` are the cards'
 * Compare with and Show savings; left out, they follow the website's card settings. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "spending");
  if (!authorized.ok) return authorized.response;
  const { user } = authorized.auth;
  const params = new URL(request.url).searchParams;

  let ym = currentYmInTimeZone(user.timezone);
  const rawMonth = params.get("month");
  if (rawMonth !== null) {
    const parsed = monthParamSchema.safeParse(rawMonth);
    if (!parsed.success) return apiError("Invalid 'month' parameter — expected YYYY-MM.", 400);
    ym = parsed.data;
  }

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

  return NextResponse.json(await loadAppSpending(user, ym, choice), { headers: NO_STORE });
}
