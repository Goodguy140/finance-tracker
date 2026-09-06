import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeActionError, GENERIC_ACTION_ERROR, isExpectedActionError } from "./action-errors";
import { isActionFailure } from "./action-result";

describe("describeActionError", () => {
  it("passes our own guard messages through", () => {
    expect(describeActionError(new Error("Expense not found."))).toBe("Expense not found.");
    expect(isExpectedActionError(new Error("Expense not found."))).toBe(true);
  });

  it("names the field for a validation failure", () => {
    const result = z.object({ amount: z.coerce.number().positive("Enter a positive amount.") }).safeParse({ amount: "-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(describeActionError(result.error)).toBe("amount: Enter a positive amount.");
  });

  it("hides database and unknown errors behind a generic message", () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`)", {
      code: "P2002",
      clientVersion: "test",
    });
    expect(describeActionError(prismaError)).toBe(GENERIC_ACTION_ERROR);
    expect(isExpectedActionError(prismaError)).toBe(false);
    expect(describeActionError("boom")).toBe(GENERIC_ACTION_ERROR);
    expect(describeActionError(new Error(""))).toBe(GENERIC_ACTION_ERROR);
  });
});

describe("isActionFailure", () => {
  it("recognises the failure shape and nothing else", () => {
    expect(isActionFailure({ ok: false, error: "x" })).toBe(true);
    expect(isActionFailure({ ok: true })).toBe(false);
    expect(isActionFailure(undefined)).toBe(false);
    expect(isActionFailure({ ok: false })).toBe(false);
  });
});
