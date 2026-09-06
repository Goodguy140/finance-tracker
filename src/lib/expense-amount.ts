import { MAX_AMOUNT, toCents } from "./money";

const TOO_LARGE = `Amounts cannot exceed ${MAX_AMOUNT.toLocaleString("en-CA")}.`;

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

export type ParsedExpenseAmount = {
  amountCents: number;
  preCreditCents: number | null;
  creditCents: number | null;
  creditBreakdownJson: string | null;
};

/**
 * Parses expense amount fields from a form.
 * Either a simple `amount`, or receipt breakdown: `preCreditTotal` minus optional `creditTotal` (defaults to 0).
 */
export function parseExpenseAmountFromForm(formData: FormData): ParsedExpenseAmount {
  const preRaw = getFormValue(formData, "preCreditTotal").trim();
  const creditRaws = formData
    .getAll("creditTotal")
    .map((v) => String(v ?? "").trim())
    .filter((v) => v !== "");
  const amountRaw = getFormValue(formData, "amount").trim();

  if (preRaw !== "") {
    const pre = Number(preRaw);
    if (!Number.isFinite(pre) || pre <= 0) {
      throw new Error("Total before credits must be a positive number.");
    }
    if (pre > MAX_AMOUNT) throw new Error(TOO_LARGE);
    let creditNum = 0;
    for (const c of creditRaws) {
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("Each credit must be zero or a positive number.");
      }
      if (n > MAX_AMOUNT) throw new Error(TOO_LARGE);
      creditNum += n;
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
      creditBreakdownJson: JSON.stringify(
        creditRaws
          .map((c) => toCents(Number(c)))
          .filter((cents) => Number.isFinite(cents) && cents > 0),
      ),
    };
  }

  if (creditRaws.length > 0) {
    throw new Error("Enter a total before credits, or clear the credits field.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Enter a non-zero amount. Use a negative value for statement credits.");
  }
  if (Math.abs(amount) > MAX_AMOUNT) throw new Error(TOO_LARGE);

  return {
    amountCents: toCents(amount),
    preCreditCents: null,
    creditCents: null,
    creditBreakdownJson: null,
  };
}
