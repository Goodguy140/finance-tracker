import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { API_BULK_MAX, parseBulkBody, parseDecisionBody, parsePairBody, serializeReviewRow } from "./review-queue";
import type { ReviewRow } from "@/lib/plaid/review-queue-view";

describe("parseDecisionBody", () => {
  it("reads the phone's lowercase countAs as the type the queue books", () => {
    expect(parseDecisionBody({ decision: "add", countAs: "transfer" })).toEqual({
      ok: true,
      value: { decision: "add", countAs: TransactionType.TRANSFER, categoryId: null },
    });
    expect(parseDecisionBody({ decision: "add", categoryId: "c1" })).toEqual({
      ok: true,
      value: { decision: "add", countAs: null, categoryId: "c1" },
    });
  });

  it("refuses a link with nothing to link to, and an unknown decision", () => {
    expect(parseDecisionBody({ decision: "link" })).toMatchObject({ ok: false });
    expect(parseDecisionBody({ decision: "approve" })).toEqual({ ok: false, error: "'decision' must be add, link or ignore." });
    expect(parseDecisionBody({ decision: "add", countAs: "EXPENSE" })).toMatchObject({ ok: false });
  });
});

describe("parseBulkBody", () => {
  it("names each link's bank row as the decisions expect it, and adds each row once", () => {
    expect(parseBulkBody({ action: "link", links: [{ id: "s1", transactionId: "t1" }] })).toEqual({
      ok: true,
      value: { action: "link", links: [{ stagedId: "s1", transactionId: "t1" }] },
    });
    expect(parseBulkBody({ action: "add", ids: ["s1", "s1", "s2"] })).toEqual({
      ok: true,
      value: { action: "add", ids: ["s1", "s2"], categoryId: null },
    });
  });

  it("refuses an empty or oversized batch", () => {
    expect(parseBulkBody({ action: "ignore", ids: [] })).toMatchObject({ ok: false });
    const tooMany = Array.from({ length: API_BULK_MAX + 1 }, (_, i) => `s${i}`);
    expect(parseBulkBody({ action: "add", ids: tooMany })).toMatchObject({ ok: false });
  });
});

it("refuses pairing a row with itself", () => {
  expect(parsePairBody({ id: "s1", peerId: "s1" })).toEqual({ ok: false, error: "Choose the two sides of the transfer." });
});

it("serializes a queue row in the API's lowercase shape", () => {
  const proposal = { title: "Payroll", note: null, tagNames: [], split: null, reason: null };
  const row: ReviewRow = {
    id: "s1",
    institutionName: "Tangerine",
    heading: "Payroll",
    bankName: "PAYROLL DEP",
    asTransfer: proposal,
    asNonTransfer: proposal,
    amountCents: 250000,
    moneyIn: true,
    isTransfer: false,
    dateYmd: "2026-11-01",
    dateDisplay: "Nov 1, 2026",
    accountLabel: "Chequing",
    nonTransferType: "INCOME",
    categoryOptions: [],
    suggestedCategoryId: "",
    isPending: false,
    match: null,
    transferPair: { stagedId: "s2", heading: "Transfer", accountLabel: "Savings", dateYmd: "2026-11-02", dateDisplay: "", outflow: false },
  };
  expect(serializeReviewRow(row)).toMatchObject({
    type: "income",
    direction: "in",
    suggestedCategoryId: null,
    date: "2026-11-01",
    transferPair: { id: "s2", account: "Savings", date: "2026-11-02", outflow: false },
  });
});
