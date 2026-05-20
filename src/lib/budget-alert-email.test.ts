import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({
  isSmtpConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

const { isBudgetAlertEmailConfigured, sendBudgetAlertEmail } = await import("@/lib/budget-alert-email");
const { sendEmail } = await import("@/lib/email");

describe("sendBudgetAlertEmail", () => {
  it("delegates to sendEmail", async () => {
    const result = await sendBudgetAlertEmail({
      to: "u@example.com",
      subject: "Budget",
      text: "Over limit",
    });
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });

  it("reports configured when SMTP is available", () => {
    expect(isBudgetAlertEmailConfigured()).toBe(true);
  });
});
