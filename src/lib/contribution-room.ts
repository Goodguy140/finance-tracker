/**
 * TFSA, RRSP and FHSA contribution room.
 *
 * The user types each year's figure from CRA (My Account, or the notice of assessment). That
 * figure already accounts for everything CRA knew up to that point, so for a year with an
 * entry the only arithmetic here is subtracting the contributions recorded against that
 * year. For a year without one, TFSA and FHSA room is rolled forward from the latest earlier
 * entry using the published rules; RRSP room cannot be (it depends on earned income), so it
 * stays unknown until the user enters it.
 *
 * Pure: no Prisma, no clock. Callers pass the entries, the flows and the year.
 */

export const REGISTERED_ACCOUNT_TYPES = ["TFSA", "RRSP", "FHSA"] as const;
export type RegisteredAccountType = (typeof REGISTERED_ACCOUNT_TYPES)[number];

export function isRegisteredAccountType(type: string): type is RegisteredAccountType {
  return (REGISTERED_ACCOUNT_TYPES as readonly string[]).includes(type);
}

/** First year any of the three existed (TFSA, 2009). Entries before it are rejected. */
export const FIRST_ROOM_YEAR = 2009;

/**
 * New TFSA room added each January 1. Years after the last published figure reuse it, which
 * is right until the indexed limit next steps up by $500; the user's own entry wins anyway.
 */
const TFSA_ANNUAL_LIMIT_CENTS: Record<number, number> = {
  2009: 500_000, 2010: 500_000, 2011: 500_000, 2012: 500_000,
  2013: 550_000, 2014: 550_000,
  2015: 1_000_000,
  2016: 550_000, 2017: 550_000, 2018: 550_000,
  2019: 600_000, 2020: 600_000, 2021: 600_000, 2022: 600_000,
  2023: 650_000,
  2024: 700_000, 2025: 700_000, 2026: 700_000,
};
const LAST_TFSA_LIMIT_YEAR = 2026;

export function tfsaAnnualLimitCents(year: number): number {
  if (year < FIRST_ROOM_YEAR) return 0;
  return TFSA_ANNUAL_LIMIT_CENTS[Math.min(year, LAST_TFSA_LIMIT_YEAR)];
}

export const FHSA_ANNUAL_LIMIT_CENTS = 800_000;
/** At most one year's limit of unused room carries into the next year. */
export const FHSA_CARRY_FORWARD_MAX_CENTS = 800_000;
export const FHSA_LIFETIME_LIMIT_CENTS = 4_000_000;
/** CRA only charges the 1%/month RRSP penalty on the excess above this. */
export const RRSP_OVERCONTRIBUTION_CUSHION_CENTS = 200_000;
/**
 * Contributions in the first 60 days of a year can be deducted against the previous year's
 * limit, so an RRSP "room year" runs from day 61 to day 60 of the next calendar year.
 */
export const RRSP_FIRST_DAYS_OF_NEXT_YEAR = 60;

export type RoomEntry = { accountType: RegisteredAccountType; year: number; roomCents: number };
/** `date` is a date-only value at UTC midnight, as everywhere else in the app. */
export type RoomFlow = {
  accountType: RegisteredAccountType;
  date: Date;
  direction: "CONTRIBUTION" | "WITHDRAWAL";
  amountCents: number;
};

/** Which room year a contribution made on `date` counts against. */
export function roomYearFor(accountType: RegisteredAccountType, date: Date): number {
  const year = date.getUTCFullYear();
  if (accountType !== "RRSP") return year;
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return dayOfYear <= RRSP_FIRST_DAYS_OF_NEXT_YEAR ? year - 1 : year;
}

export type RoomYear = {
  accountType: RegisteredAccountType;
  year: number;
  /** Room available for the year, before this year's contributions. Null when unknown. */
  startingRoomCents: number | null;
  /** "entered" from CRA, "estimated" by rolling an earlier entry forward, or "unknown". */
  source: "entered" | "estimated" | "unknown";
  /** The year the estimate was rolled forward from. */
  estimatedFromYear: number | null;
  contributedCents: number;
  withdrawnCents: number;
  remainingCents: number | null;
  /**
   * Amount over the room. For RRSP this is the full excess; `penaltyExcessCents` is the part
   * above the $2,000 cushion.
   */
  overCents: number;
  penaltyExcessCents: number;
};

function sumFlows(
  flows: RoomFlow[],
  accountType: RegisteredAccountType,
  year: number,
  direction: RoomFlow["direction"],
): number {
  let total = 0;
  for (const flow of flows) {
    if (flow.accountType !== accountType || flow.direction !== direction) continue;
    if (roomYearFor(accountType, flow.date) !== year) continue;
    total += flow.amountCents;
  }
  return total;
}

function lifetimeContributionsThrough(flows: RoomFlow[], year: number): number {
  let total = 0;
  for (const flow of flows) {
    if (flow.accountType === "FHSA" && flow.direction === "CONTRIBUTION" && flow.date.getUTCFullYear() <= year) {
      total += flow.amountCents;
    }
  }
  return total;
}

/**
 * Room at the start of `year + 1`, given the room at the start of `year`.
 *
 * TFSA: unused room carries forward in full, withdrawals come back the following January,
 * and the new annual limit is added. An over-contribution carries forward as negative room.
 * FHSA: at most $8,000 of unused room carries forward, the new $8,000 is added, and the total
 * can never exceed what is left of the $40,000 lifetime limit. Withdrawals never restore it.
 */
function rollForward(
  accountType: "TFSA" | "FHSA",
  year: number,
  startingRoomCents: number,
  flows: RoomFlow[],
): number {
  const contributed = sumFlows(flows, accountType, year, "CONTRIBUTION");
  const unused = startingRoomCents - contributed;
  if (accountType === "TFSA") {
    return unused + sumFlows(flows, accountType, year, "WITHDRAWAL") + tfsaAnnualLimitCents(year + 1);
  }
  const carried = Math.min(unused, FHSA_CARRY_FORWARD_MAX_CENTS);
  const lifetimeLeft = FHSA_LIFETIME_LIMIT_CENTS - lifetimeContributionsThrough(flows, year);
  return Math.min(FHSA_ANNUAL_LIMIT_CENTS + carried, lifetimeLeft);
}

export function computeRoomYear(
  accountType: RegisteredAccountType,
  year: number,
  entries: RoomEntry[],
  flows: RoomFlow[],
): RoomYear {
  const own = entries.filter((e) => e.accountType === accountType && e.year <= year);
  const exact = own.find((e) => e.year === year);

  let startingRoomCents: number | null = null;
  let source: RoomYear["source"] = "unknown";
  let estimatedFromYear: number | null = null;

  if (exact) {
    startingRoomCents = exact.roomCents;
    source = "entered";
  } else if (accountType !== "RRSP" && own.length > 0) {
    const latest = own.reduce((a, b) => (b.year > a.year ? b : a));
    let room = latest.roomCents;
    for (let y = latest.year; y < year; y += 1) room = rollForward(accountType, y, room, flows);
    startingRoomCents = room;
    source = "estimated";
    estimatedFromYear = latest.year;
  }

  const contributedCents = sumFlows(flows, accountType, year, "CONTRIBUTION");
  const withdrawnCents = sumFlows(flows, accountType, year, "WITHDRAWAL");
  const remainingCents = startingRoomCents === null ? null : startingRoomCents - contributedCents;
  const overCents = remainingCents !== null && remainingCents < 0 ? -remainingCents : 0;
  const penaltyExcessCents =
    accountType === "RRSP" ? Math.max(0, overCents - RRSP_OVERCONTRIBUTION_CUSHION_CENTS) : overCents;

  return {
    accountType,
    year,
    startingRoomCents,
    source,
    estimatedFromYear,
    contributedCents,
    withdrawnCents,
    remainingCents,
    overCents,
    penaltyExcessCents,
  };
}

export type ContributionWarning = {
  roomYear: number;
  remainingBeforeCents: number;
  overByCents: number;
  /** Over, but within the RRSP $2,000 cushion: no penalty yet. */
  withinCushion: boolean;
};

/**
 * What adding a contribution of `amountCents` on `date` would do to the room for its year.
 * Null when the room is unknown or the contribution fits.
 */
export function previewContribution(
  accountType: RegisteredAccountType,
  date: Date,
  amountCents: number,
  entries: RoomEntry[],
  flows: RoomFlow[],
): ContributionWarning | null {
  const roomYear = roomYearFor(accountType, date);
  const room = computeRoomYear(accountType, roomYear, entries, flows);
  if (room.remainingCents === null) return null;
  const after = room.remainingCents - amountCents;
  if (after >= 0) return null;
  const overByCents = -after;
  return {
    roomYear,
    remainingBeforeCents: room.remainingCents,
    overByCents,
    withinCushion: accountType === "RRSP" && overByCents <= RRSP_OVERCONTRIBUTION_CUSHION_CENTS,
  };
}

/** What the server hands the browser: plain JSON, dates as `YYYY-MM-DD`. */
export type ContributionRoomData = {
  entries: Array<RoomEntry & { id: string }>;
  flows: Array<Omit<RoomFlow, "date"> & { date: string }>;
  /** Registered accounts only, by account id, so a form can tell which room an account uses. */
  accountTypes: Record<string, RegisteredAccountType>;
};

export function roomFlowsFromData(data: ContributionRoomData): RoomFlow[] {
  return data.flows.map((flow) => ({ ...flow, date: new Date(`${flow.date}T00:00:00.000Z`) }));
}
