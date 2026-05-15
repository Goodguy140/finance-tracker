/**
 * Optional budget alert email delivery. Requires SMTP env vars; no-op when unset.
 *
 * Env (all required when sending):
 * - SMTP_HOST
 * - SMTP_PORT (default 587)
 * - SMTP_USER
 * - SMTP_PASS
 * - SMTP_FROM (e.g. alerts@example.com)
 *
 * TODO: Wire nodemailer (or your mail provider) when SMTP_* is configured.
 */

export type BudgetAlertEmailPayload = {
  to: string;
  subject: string;
  text: string;
};

export function isBudgetAlertEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM,
  );
}

export async function sendBudgetAlertEmail(
  payload: BudgetAlertEmailPayload,
): Promise<{ sent: boolean; reason?: string }> {
  if (!isBudgetAlertEmailConfigured()) {
    return { sent: false, reason: "SMTP not configured" };
  }

  // TODO: implement with nodemailer when adding the dependency:
  // const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
  // await transporter.sendMail({ from: SMTP_FROM, to: payload.to, subject, text });
  void payload;
  return { sent: false, reason: "Email delivery not implemented yet" };
}
