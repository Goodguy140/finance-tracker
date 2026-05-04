import { toCents } from "./money";

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

export type ParsedExpenseAmount = {
  amountCents: number;
  preCreditCents: number | null;
  creditCents: number | null;
};

/**
 * Parses expense amount fields from a form.
 * Either a simple `amount`, or receipt breakdown: `preCreditTotal` minus optional `creditTotal` (defaults to 0).
 */
export function parseExpenseAmountFromForm(formData: FormData): ParsedExpenseAmount {
  const preRaw = getFormValue(formData, "preCreditTotal").trim();
  const creditRaw = getFormValue(formData, "creditTotal").trim();
  const amountRaw = getFormValue(formData, "amount").trim();

  if (preRaw !== "") {
    const pre = Number(preRaw);
    if (!Number.isFinite(pre) || pre <= 0) {
      throw new Error("Total before credits must be a positive number.");
    }
    const creditNum = creditRaw === "" ? 0 : Number(creditRaw);
    if (!Number.isFinite(creditNum) || creditNum < 0) {
      throw new Error("Credits must be zero or a positive number.");
    }
    const net = pre - creditNum;
    if (!Number.isFinite(net) || net === 0) {
      throw new Error(
        "Net amount after credits cannot be zero. Adjust totals, or clear receipt breakdown and enter a single amount.",
      );
    }
    return {
      amountCents: toCents(net),
      preCreditCents: toCents(pre),
      creditCents: toCents(creditNum),
    };
  }

  if (creditRaw !== "") {
    throw new Error("Enter a total before credits, or clear the credits field.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Enter a non-zero amount. Use a negative value for statement credits.");
  }

  return {
    amountCents: toCents(amount),
    preCreditCents: null,
    creditCents: null,
  };
}
