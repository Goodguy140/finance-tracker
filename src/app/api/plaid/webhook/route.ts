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
/** Plaid's webhook bodies are a few hundred bytes; anything near this is not one of them. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

/** The body as text, or null once it passes `limit` bytes — read no further than that. */
async function readBodyCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

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

  // Looked at before the body is read: a delivery with no signature is refused without
  // buffering anything it sent.
  const signedJwt = request.headers.get("plaid-verification");
  if (!signedJwt?.trim()) {
    return Response.json({ ok: false }, { status: 401 });
  }

  // The raw text, not request.json(): the signature covers these exact bytes, and a
  // re-serialised object would hash differently.
  const body = await readBodyCapped(request, MAX_WEBHOOK_BODY_BYTES);
  if (body === null) {
    return Response.json({ ok: false }, { status: 413 });
  }
  const verification = await verifyPlaidWebhook({
    body,
    signedJwt,
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
