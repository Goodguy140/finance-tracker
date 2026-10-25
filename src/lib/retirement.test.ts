import { describe, expect, it } from "vitest";
import { projectRetirement, realReturn, type RetirementInput } from "./retirement";

const base: RetirementInput = {
  startYear: 2026,
  age: 30,
  retireAge: 65,
  endAge: 95,
  annualSavingsCents: 3_000_000,
  annualIncomeCents: 10_000_000,
  retiredSpendingCents: 4_000_000,
  returnPct: 0,
  inflationPct: 0,
  withdrawalPct: 4,
  balances: { TFSA: 0, RRSP: 0, FHSA: 0, NON_REGISTERED: 0 },
  room: { TFSA: null, RRSP: null, FHSA: null },
  fhsaEligible: true,
};

describe("projectRetirement", () => {
  it("fills TFSA, then RRSP, then FHSA within their room, and puts the rest in non-registered", () => {
    const p = projectRetirement({ ...base, annualSavingsCents: 4_000_000 });
    // TFSA $7,000 (2026 limit), RRSP 18% of $100,000 = $18,000, FHSA $8,000, rest $7,000.
    expect(p.years[0].contributed).toEqual({ TFSA: 700_000, RRSP: 1_800_000, FHSA: 800_000, NON_REGISTERED: 700_000 });
  });

  it("fills them in that order when savings run short", () => {
    const p = projectRetirement({ ...base, annualSavingsCents: 2_000_000 });
    expect(p.years[0].contributed).toEqual({ TFSA: 700_000, RRSP: 1_300_000, FHSA: 0, NON_REGISTERED: 0 });
  });

  it("uses unused room entered for this year and stops FHSA at the lifetime limit", () => {
    const p = projectRetirement({
      ...base,
      annualSavingsCents: 10_000_000,
      room: { TFSA: 5_000_000, RRSP: 0, FHSA: 800_000 },
      fhsaContributedCents: 3_600_000,
    });
    expect(p.years[0].contributed.TFSA).toBe(5_000_000);
    expect(p.years[0].contributed.RRSP).toBe(0);
    expect(p.years[0].contributed.FHSA).toBe(400_000); // $4,000 left of the $40,000 lifetime
    expect(p.years[1].contributed.FHSA).toBe(0);
    expect(p.years[1].contributed.RRSP).toBe(1_800_000);
  });

  it("gives no FHSA room unless saving for a first home", () => {
    const p = projectRetirement({ ...base, fhsaEligible: false, annualSavingsCents: 4_000_000 });
    expect(p.years[0].contributed.FHSA).toBe(0);
    expect(p.years[0].contributed.NON_REGISTERED).toBe(1_500_000);
  });

  it("finds the FI age and when money runs out, at a flat 0% real return", () => {
    const p = projectRetirement(base);
    expect(p.fiNumberCents).toBe(100_000_000); // $40,000 / 4%
    // $30,000 a year from age 30: $1,000,000 reached in the 34th year, at 63.
    expect(p.fiAge).toBe(63);
    expect(p.atRetirementCents).toBe(105_000_000);
    // $1,050,000 at $40,000 a year lasts 26 full years from 65, running short at 91.
    expect(p.runsOutAge).toBe(91);
    const at91 = p.years.find((y) => y.age === 91)!;
    expect(at91.shortfallCents).toBe(4_000_000 - (105_000_000 - 26 * 4_000_000));
  });

  it("takes retirement spending from non-registered first and TFSA last", () => {
    const p = projectRetirement({
      ...base,
      age: 65,
      balances: { TFSA: 1_000_000, RRSP: 4_000_000, FHSA: 0, NON_REGISTERED: 4_000_000 },
    });
    expect(p.years[0].balances).toEqual({ TFSA: 1_000_000, RRSP: 4_000_000, FHSA: 0, NON_REGISTERED: 0 });
    expect(p.years[1].balances).toEqual({ TFSA: 1_000_000, RRSP: 0, FHSA: 0, NON_REGISTERED: 0 });
    expect(p.years[2].balances.TFSA).toBe(0);
    expect(p.runsOutAge).toBe(67);
  });

  it("works in today's dollars: the return is net of inflation", () => {
    expect(realReturn(6, 2)).toBeCloseTo(0.0392, 4);
    const p = projectRetirement({ ...base, age: 64, returnPct: 3, inflationPct: 3, balances: { ...base.balances, TFSA: 1_000_000 }, annualSavingsCents: 0 });
    expect(p.years[0].totalCents).toBe(1_000_000);
  });
});
