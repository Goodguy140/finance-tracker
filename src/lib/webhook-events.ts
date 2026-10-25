/** Webhook event names and labels, safe to import in the browser (see ./webhooks.ts). */
export const WEBHOOK_EVENTS = [
  "transaction.created",
  "transactions.imported",
  "budget.over",
  "bill.due",
  "sync.failed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "transaction.created": "A transaction is added (by hand, the API or a recurring auto-post)",
  "transactions.imported": "A statement is imported",
  "budget.over": "A budget goes over its limit",
  "bill.due": "A recurring bill is due tomorrow",
  "sync.failed": "A bank sync fails",
};

