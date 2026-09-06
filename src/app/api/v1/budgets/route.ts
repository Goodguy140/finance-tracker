import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES, authenticateApiToken } from "@/lib/api-token";
import { buildMonthlyBudgetProgress, budgetRowPercentUsed } from "@/lib/budget-progress";
import { currentYmInTimeZone } from "@/lib/period-month";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";
import { monthParamSchema } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

// Token-authenticated, no cookies; never cached.
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * GET /api/v1/budgets?month=YYYY-MM
 * Returns the authenticated user's current-month budget-vs-actual.
 * Auth: `Authorization: Bearer <personal access token>` with scope `budgets:read`.
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
  } catch {
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

  const h = await headers();
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_budgets_read,
    targetType: "personal_access_token",
    targetId: auth.token.id,
    metadata: { periodMonth: ym },
    headers: h,
  });

  return NextResponse.json(
    {
      periodMonth: progress.periodMonth,
      currency: progress.currency,
      budgets: progress.budgets.map((row) => ({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        limitCents: row.limitCents,
        spentCents: row.spentCents,
        percentUsed: budgetRowPercentUsed(row),
      })),
      totalLimitCents: progress.totalLimitCents,
      totalSpentCents: progress.totalSpentCents,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
