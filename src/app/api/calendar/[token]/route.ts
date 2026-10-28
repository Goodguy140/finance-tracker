import { NextResponse } from "next/server";
import { calendarFeedForToken, hashCalendarFeedToken } from "@/lib/calendar-feed";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";

// Fetched by calendar apps' servers with no session; the secret in the path is the credential.
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * GET /api/calendar/<secret>.ics — the user's recurring bills, pay, transfers and decide-by
 * dates as an iCalendar feed (`src/lib/calendar-feed.ts`). An unknown secret is a plain 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token.replace(/\.ics$/i, "");
  try {
    await enforceSlidingWindowRateLimit(
      `calendar:${hashCalendarFeedToken(raw).slice(0, 16)}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS,
      "Rate limit exceeded.",
    );
  } catch {
    return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  }
  const ics = await calendarFeedForToken(raw);
  if (ics === null) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="finance-tracker.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
