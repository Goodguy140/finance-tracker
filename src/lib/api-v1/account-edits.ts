import { AccountType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AccountEditError, createAccount, setAccountArchived, setCardTerms, updateAccount } from "@/lib/account-edits";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

/** Settings → Accounts' add and edit forms for the phone: `POST /api/v1/accounts`, `PATCH /api/v1/accounts/:id`. */

const name = z.string().trim().min(2, "Name the account, in 2 to 80 characters.").max(80, "Name the account, in 2 to 80 characters.");
const type = z.enum(AccountType, "That is not an account type.");

const createSchema = z.object({ name, type }).strict();

const patchSchema = z
  .object({
    name: name.optional(),
    type: type.optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "A currency is a 3-letter code, like CAD.")
      .transform((value) => value.toUpperCase())
      .optional(),
    countsAsSavings: z.boolean().optional(),
    /** A credit card's limit; null clears it. */
    creditLimitCents: z.number().int().min(1, "Enter the credit limit as an amount, like 5000.").max(MAX_AMOUNT_CENTS).nullable().optional(),
    /** The day of the month a card's payment is due, 1 to 31; null clears it. */
    paymentDueDay: z.number().int().min(1, "Enter the due day as a day of the month, 1 to 31.").max(31, "Enter the due day as a day of the month, 1 to 31.").nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export type AccountEditResult = { ok: true; id: string } | { ok: false; status: 400 | 404; error: string };

function refused(error: unknown): AccountEditResult {
  if (error instanceof AccountEditError) return { ok: false, status: error.notFound ? 404 : 400, error: error.message };
  throw error;
}

export async function createAccountFromApi(
  db: PrismaClient,
  user: { id: string; countryCode: string | null },
  body: unknown,
  headers?: Headers,
): Promise<AccountEditResult> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid account." };
  return { ok: true, id: await createAccount(db, user, parsed.data, headers) };
}

/**
 * Changes what the body names, in the form's order: the details, then a card's limit and due
 * day, then archived. A refusal stops there with its reason; what came before it is saved.
 */
export async function patchAccountFromApi(
  db: PrismaClient,
  userId: string,
  accountId: string,
  body: unknown,
  headers?: Headers,
): Promise<AccountEditResult> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid account." };
  const change = parsed.data;
  const current = await db.account.findFirst({
    where: { id: accountId, userId },
    select: { name: true, type: true, currency: true, countsAsSavings: true, creditLimitCents: true, paymentDueDay: true },
  });
  if (!current) return { ok: false, status: 404, error: "Account not found." };
  try {
    if (change.name !== undefined || change.type !== undefined || change.currency !== undefined || change.countsAsSavings !== undefined) {
      await updateAccount(db, userId, accountId, {
        name: change.name ?? current.name,
        type: change.type ?? current.type,
        currency: change.currency ?? current.currency,
        countsAsSavings: change.countsAsSavings ?? current.countsAsSavings,
      });
    }
    if (change.creditLimitCents !== undefined || change.paymentDueDay !== undefined) {
      await setCardTerms(db, userId, accountId, {
        creditLimitCents: change.creditLimitCents !== undefined ? change.creditLimitCents : current.creditLimitCents,
        paymentDueDay: change.paymentDueDay !== undefined ? change.paymentDueDay : current.paymentDueDay,
      });
    }
    if (change.archived !== undefined) await setAccountArchived(db, userId, accountId, change.archived, headers);
    return { ok: true, id: accountId };
  } catch (error) {
    return refused(error);
  }
}
