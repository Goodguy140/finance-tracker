import { tfsaAnnualLimitCents, FHSA_ANNUAL_LIMIT_CENTS, FHSA_LIFETIME_LIMIT_CENTS } from "@/lib/contribution-room";

/**
 * A deterministic, long-range retirement (FIRE) projection for Canada. No Monte Carlo: one path
 * at a steady return. Everything is in today's dollars: the return is turned into a real one
 * (net of inflation), and amounts that are indexed (TFSA room, the RRSP dollar limit, savings,
 * spending) stay flat in real terms. FHSA limits are not indexed, so they shrink in real terms.
 *
 * While working, each year's savings go TFSA first, then RRSP, then FHSA, each within its room,
 * and the rest to a non-registered account. Once retired, spending comes out of non-registered
 * first, then FHSA and RRSP, then TFSA. Taxes are left out: withdrawals are before tax.
 */
export const RETIREMENT_BUCKETS = ["TFSA", "RRSP", "FHSA", "NON_REGISTERED"] as const;
export type RetirementBucket = (typeof RETIREMENT_BUCKETS)[number];
export type Buckets = Record<RetirementBucket, number>;

/** The RRSP dollar limit for 2026; 18% of earned income up to this. Indexed, so flat in real terms. */
export const RRSP_DOLLAR_LIMIT_CENTS = 3_381_000;
export const RRSP_INCOME_SHARE = 0.18;

const CONTRIBUTION_ORDER: readonly RetirementBucket[] = ["TFSA", "RRSP", "FHSA", "NON_REGISTERED"];
const WITHDRAWAL_ORDER: readonly RetirementBucket[] = ["NON_REGISTERED", "FHSA", "RRSP", "TFSA"];

export type RetirementInput = {
  startYear: number;
  age: number;
  retireAge: number;
  /** The last age the projection runs to. */
  endAge?: number;
  annualSavingsCents: number;
  annualIncomeCents: number;
  retiredSpendingCents: number;
  /** Yearly percentages, e.g. 6 for 6%. */
  returnPct: number;
  inflationPct: number;
  withdrawalPct: number;
  balances: Buckets;
  /** Unused room this year; null when unknown, which counts only this year's new room. */
  room: { TFSA: number | null; RRSP: number | null; FHSA: number | null };
  /** Saving for a first home: FHSA room only applies when true. */
  fhsaEligible: boolean;
  /** FHSA contributions made so far, toward the $40,000 lifetime limit. */
  fhsaContributedCents?: number;
};

export type RetirementYear = {
  year: number;
  age: number;
  retired: boolean;
  /** Balances at the end of the year. */
  balances: Buckets;
  totalCents: number;
  contributed: Buckets;
  withdrawnCents: number;
  /** Spending the accounts could not cover this year. */
  shortfallCents: number;
};

export type RetirementProjection = {
  realReturnPct: number;
  /** Savings needed to retire on the spending at the withdrawal rate. */
  fiNumberCents: number;
  /** The first age the total reaches the FI number; null if never before `endAge`. */
  fiAge: number | null;
  /** Total at the start of retirement (end of the year before `retireAge`). */
  atRetirementCents: number;
  /** The age money runs out in retirement; null when it lasts to `endAge`. */
  runsOutAge: number | null;
  years: RetirementYear[];
};

const empty = (): Buckets => ({ TFSA: 0, RRSP: 0, FHSA: 0, NON_REGISTERED: 0 });
const sum = (b: Buckets) => b.TFSA + b.RRSP + b.FHSA + b.NON_REGISTERED;

export function realReturn(returnPct: number, inflationPct: number): number {
  return (1 + returnPct / 100) / (1 + inflationPct / 100) - 1;
}

export function projectRetirement(input: RetirementInput): RetirementProjection {
  const endAge = Math.max(input.endAge ?? 95, input.age);
  const r = realReturn(input.returnPct, input.inflationPct);
  const inflation = 1 + input.inflationPct / 100;
  const fiNumberCents = input.withdrawalPct > 0 ? Math.round(input.retiredSpendingCents / (input.withdrawalPct / 100)) : 0;
  const balances: Buckets = { ...input.balances };
  const firstYearTfsa = tfsaAnnualLimitCents(input.startYear);
  const rrspAnnual = Math.min(Math.round(Math.max(0, input.annualIncomeCents) * RRSP_INCOME_SHARE), RRSP_DOLLAR_LIMIT_CENTS);
  const room = { TFSA: 0, RRSP: 0, FHSA: 0 };
  // Nominal dollars, since the lifetime limit is fixed in dollars.
  let fhsaLifetimeLeftNominal = Math.max(0, FHSA_LIFETIME_LIMIT_CENTS - (input.fhsaContributedCents ?? 0));

  const years: RetirementYear[] = [];
  let fiAge: number | null = null;
  let runsOutAge: number | null = null;
  let atRetirementCents = input.retireAge <= input.age ? sum(balances) : 0;

  for (let i = 0; input.age + i <= endAge; i++) {
    const age = input.age + i;
    const year = input.startYear + i;
    const deflator = inflation ** i;
    // New room for the year. This year's unused room, when known, already holds its new room.
    if (i === 0) {
      room.TFSA = input.room.TFSA ?? firstYearTfsa;
      room.RRSP = input.room.RRSP ?? rrspAnnual;
      room.FHSA = input.fhsaEligible ? (input.room.FHSA ?? FHSA_ANNUAL_LIMIT_CENTS) : 0;
    } else {
      room.TFSA += firstYearTfsa;
      room.RRSP += rrspAnnual;
      // Unused FHSA room carries forward at most one year's limit.
      if (input.fhsaEligible) room.FHSA = Math.min(room.FHSA, FHSA_ANNUAL_LIMIT_CENTS / deflator) + FHSA_ANNUAL_LIMIT_CENTS / deflator;
    }
    if (input.fhsaEligible) room.FHSA = Math.min(room.FHSA, fhsaLifetimeLeftNominal / deflator);

    for (const b of RETIREMENT_BUCKETS) balances[b] = balances[b] * (1 + r);

    const retired = age >= input.retireAge;
    const contributed = empty();
    let withdrawnCents = 0;
    let shortfallCents = 0;
    if (!retired) {
      let left = Math.max(0, input.annualSavingsCents);
      for (const b of CONTRIBUTION_ORDER) {
        const cap = b === "NON_REGISTERED" ? left : Math.min(left, Math.max(0, room[b]));
        if (cap <= 0) continue;
        contributed[b] = cap;
        balances[b] += cap;
        left -= cap;
        if (b !== "NON_REGISTERED") room[b] -= cap;
        if (b === "FHSA") fhsaLifetimeLeftNominal -= cap * deflator;
      }
    } else {
      let need = Math.max(0, input.retiredSpendingCents);
      for (const b of WITHDRAWAL_ORDER) {
        const take = Math.min(need, balances[b]);
        balances[b] -= take;
        need -= take;
        withdrawnCents += take;
      }
      shortfallCents = need;
      if (need > 0 && runsOutAge === null) runsOutAge = age;
    }
    const totalCents = sum(balances);
    if (fiAge === null && fiNumberCents > 0 && totalCents >= fiNumberCents) fiAge = age;
    if (age === input.retireAge - 1) atRetirementCents = totalCents;
    years.push({
      year,
      age,
      retired,
      balances: Object.fromEntries(RETIREMENT_BUCKETS.map((b) => [b, Math.round(balances[b])])) as Buckets,
      totalCents: Math.round(totalCents),
      contributed: Object.fromEntries(RETIREMENT_BUCKETS.map((b) => [b, Math.round(contributed[b])])) as Buckets,
      withdrawnCents: Math.round(withdrawnCents),
      shortfallCents: Math.round(shortfallCents),
    });
  }

  return {
    realReturnPct: r * 100,
    fiNumberCents,
    fiAge,
    atRetirementCents: Math.round(atRetirementCents),
    runsOutAge,
    years,
  };
}
