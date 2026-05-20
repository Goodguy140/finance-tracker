import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async () => ({}));
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

const { sendEmail, isSmtpConfigured } = await import("@/lib/email");

describe("sendEmail", () => {
  const env = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns not configured when SMTP env is missing", async () => {
    delete process.env.SMTP_HOST;
    expect(isSmtpConfigured()).toBe(false);
    const result = await sendEmail({ to: "a@b.com", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends mail when SMTP is configured", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "from@example.com";

    const result = await sendEmail({ to: "to@example.com", subject: "Alert", text: "Body" });
    expect(result.sent).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "from@example.com",
        to: "to@example.com",
        subject: "Alert",
        text: "Body",
      }),
    );
  });
});
