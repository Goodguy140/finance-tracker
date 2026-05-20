import { isSmtpConfigured, sendEmail } from "@/lib/email";

export type BudgetAlertEmailPayload = {
  to: string;
  subject: string;
  text: string;
};

export function isBudgetAlertEmailConfigured(): boolean {
  return isSmtpConfigured();
}

export async function sendBudgetAlertEmail(
  payload: BudgetAlertEmailPayload,
): Promise<{ sent: boolean; reason?: string }> {
  return sendEmail(payload);
}
