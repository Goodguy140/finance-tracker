import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES, authenticateApiToken } from "@/lib/api-token";
import { buildMonthlyBudgetProgress, budgetRowPercentUsed } from "@/lib/budget-progress";
import { currentYmInTimeZone } from "@/lib/period-month";
import { enforceSlidingWindowRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { monthParamSchema } from "@/lib/validation";
import { loadYearlyBudgetRows } from "@/lib/yearly-budgets";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

// Token-authenticated, no cookies; never cached.
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * GET /api/v1/budgets?month=YYYY-MM
 * Returns the authenticated user's current-month budget-vs-actual.
 * Auth: `Authorization: Bearer <personal access token>` with scope `budgets:read`, or a phone
 * app device token.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiToken(request, API_SCOPES.budgetsRead);
  if (auth.status === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.status === "forbidden") {
    return NextResponse.json(
      { error: "Token is missing the required scope 'budgets:read'." },
      { status: 403 },
    );
  }

  try {
    await enforceSlidingWindowRateLimit(
      `api:budgets:${auth.token.id}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS,
      "Rate limit exceeded. Try again shortly.",
    );
  } catch (err) {
    if (!(err instanceof RateLimitExceededError)) throw err;
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const rawMonth = new URL(request.url).searchParams.get("month");
  let ym = currentYmInTimeZone(auth.user.timezone);
  if (rawMonth !== null) {
    const parsed = monthParamSchema.safeParse(rawMonth);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid 'month' parameter — expected YYYY-MM." },
        { status: 400 },
      );
    }
    ym = parsed.data;
  }

  const progress = await buildMonthlyBudgetProgress(auth.user.id, ym);
  // Added for the phone app's Budgets screen; scripts written against the first fields are unaffected.
  const [yearly, categories] = await Promise.all([
    loadYearlyBudgetRows(auth.user.id, ym, progress.currency),
    prisma.category.findMany({
      where: { userId: auth.user.id, kind: "EXPENSE" },
      select: { id: true, groupName: true, rolloverSinceMonth: true },
    }),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const groupOf = (categoryId: string) => categoryById.get(categoryId)?.groupName ?? null;

  // The phone app's reads are not audited, as the website's are not (see transactions).
  if (auth.token.kind === "token") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.api_budgets_read,
      targetType: "personal_access_token",
      targetId: auth.token.id,
      metadata: { periodMonth: ym },
      headers: await headers(),
    });
  }

  return NextResponse.json(
    {
      periodMonth: progress.periodMonth,
      currency: progress.currency,
      budgets: progress.budgets.map((row) => ({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        // The month's limit with any budget rollover included, then its two parts.
        limitCents: row.limitCents,
        monthlyLimitCents: row.baseLimitCents,
        rolloverCents: row.carryCents,
        spentCents: row.spentCents,
        percentUsed: budgetRowPercentUsed(row),
        groupName: groupOf(row.categoryId),
        // Rollover is on for the category from this month or earlier.
        rollover: (categoryById.get(row.categoryId)?.rolloverSinceMonth ?? "9999-12") <= ym,
      })),
      totalLimitCents: progress.totalLimitCents,
      totalSpentCents: progress.totalSpentCents,
      // Yearly budgets as sinking funds, kept out of the monthly totals as on the website.
      yearly: yearly.map((row) => ({ ...row, groupName: groupOf(row.categoryId) })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
