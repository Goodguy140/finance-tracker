import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { getCountryConfig } from "@/lib/country-config";
import { dateFromYmd } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";
import { requireUserApiUser } from "@/lib/session";
import { loadCsvTransactions, transactionsCsv } from "@/lib/transactions-csv";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both optional and both inclusive. */
export async function GET(request: NextRequest) {
  const auth = await requireUserApiUser();
  if (auth.status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // As for the JSON backup: the passkey wall must not be walked around through the API.
  if (auth.status === 403) {
    return NextResponse.json({ error: "Passkey verification required" }, { status: 403 });
  }
  const user = auth.user;

  const fromRaw = request.nextUrl.searchParams.get("from") ?? "";
  const toRaw = request.nextUrl.searchParams.get("to") ?? "";
  if ((fromRaw && !YMD.test(fromRaw)) || (toRaw && !YMD.test(toRaw))) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD." }, { status: 400 });
  }
  const from = fromRaw ? dateFromYmd(fromRaw) : undefined;
  const toInclusive = toRaw ? dateFromYmd(toRaw) : undefined;
  const to = toInclusive ? new Date(toInclusive.getTime() + 86_400_000) : undefined;

  const rows = await loadCsvTransactions(prisma, user.id, { from, to });
  const csv = transactionsCsv(rows, getCountryConfig(user.countryCode).defaultCurrency);
  const span = fromRaw || toRaw ? `${fromRaw || "start"}-to-${toRaw || "today"}` : "all";
  const filename = `transactions-${span}.csv`;

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_backup_exported,
    metadata: { format: "csv", scope: "transactions", rows: rows.length },
    headers: await headers(),
  });

  // A byte-order mark so Excel reads the file as UTF-8 (accented payees, the € sign).
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
