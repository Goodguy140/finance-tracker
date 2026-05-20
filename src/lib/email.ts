import nodemailer from "nodemailer";

export type SendEmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM,
  );
}

function getSmtpPort() {
  const raw = process.env.SMTP_PORT?.trim();
  if (!raw) return 587;
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) ? port : 587;
}

export async function sendEmail(
  payload: SendEmailPayload,
): Promise<{ sent: boolean; reason?: string }> {
  if (!isSmtpConfigured()) {
    return { sent: false, reason: "SMTP not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: getSmtpPort(),
    secure: getSmtpPort() === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });

  return { sent: true };
}
