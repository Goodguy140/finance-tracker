import { prisma } from "@/lib/prisma";
import { PlaidNotConfiguredError, requirePlaidClient } from "@/lib/plaid/service";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";
import { applyPlaidWebhook, type PlaidWebhookBody } from "@/lib/plaid/webhooks";

/**
 * POST /api/plaid/webhook
 *
 * Excluded from the session gate in `src/proxy.ts` — Plaid has no cookie — so the
 * signature check in `verifyPlaidWebhook` is the only thing standing between the internet
 * and a bank connection's status. Nothing is parsed, let alone acted on, before it passes.
 *
 * Responses are deliberately uninformative. A verified delivery for an item this server
 * does not hold still gets 200: Plaid would otherwise retry it for days, and a distinct
 * status would tell a caller which item ids exist here.
 */
export async function POST(request: Request) {
  let client;
  try {
    client = await requirePlaidClient();
  } catch (err) {
    if (err instanceof PlaidNotConfiguredError) {
      return Response.json({ ok: false }, { status: 503 });
    }
    throw err;
  }

  // The raw text, not request.json(): the signature covers these exact bytes, and a
  // re-serialised object would hash differently.
  const body = await request.text();
  const verification = await verifyPlaidWebhook({
    body,
    signedJwt: request.headers.get("plaid-verification"),
    fetchKey: async (keyId) => (await client.getWebhookVerificationKey(keyId)).key,
  });
  if (!verification.ok) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let parsed: PlaidWebhookBody;
  try {
    parsed = JSON.parse(body) as PlaidWebhookBody;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object") {
    return Response.json({ ok: false }, { status: 400 });
  }

  await applyPlaidWebhook({ prisma, client }, parsed);
  return Response.json({ ok: true });
}
