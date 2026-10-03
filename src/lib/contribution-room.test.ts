import { describe, expect, it } from "vitest";
import {
  computeRoomYear,
  previewContribution,
  roomYearFor,
  tfsaAnnualLimitCents,
  type RoomEntry,
  type RoomFlow,
} from "./contribution-room";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const contribution = (accountType: RoomFlow["accountType"], ymd: string, amountCents: number): RoomFlow => ({
  accountType,
  date: d(ymd),
  direction: "CONTRIBUTION",
  amountCents,
});
const withdrawal = (accountType: RoomFlow["accountType"], ymd: string, amountCents: number): RoomFlow => ({
  accountType,
  date: d(ymd),
  direction: "WITHDRAWAL",
  amountCents,
});

describe("roomYearFor", () => {
  it("puts RRSP contributions in the first 60 days against the previous year", () => {
    expect(roomYearFor("RRSP", d("2026-01-15"))).toBe(2025);
    expect(roomYearFor("RRSP", d("2026-03-01"))).toBe(2025); // day 60 in a non-leap year
    expect(roomYearFor("RRSP", d("2026-03-02"))).toBe(2026);
    expect(roomYearFor("RRSP", d("2024-02-29"))).toBe(2023); // leap year: day 60
    expect(roomYearFor("RRSP", d("2024-03-01"))).toBe(2024);
  });

  it("uses the calendar year for TFSA and FHSA", () => {
    expect(roomYearFor("TFSA", d("2026-01-15"))).toBe(2026);
    expect(roomYearFor("FHSA", d("2026-01-15"))).toBe(2026);
  });
});

describe("computeRoomYear", () => {
  it("subtracts the year's contributions from an entered figure", () => {
    const entries: RoomEntry[] = [{ accountType: "TFSA", year: 2026, roomCents: 2_000_000 }];
    const flows = [contribution("TFSA", "2026-02-01", 500_000), contribution("TFSA", "2025-12-31", 900_000)];
    const room = computeRoomYear("TFSA", 2026, entries, flows);
    expect(room).toMatchObject({
      source: "entered",
      startingRoomCents: 2_000_000,
      contributedCents: 500_000,
      remainingCents: 1_500_000,
      overCents: 0,
    });
  });

  it("does not give TFSA withdrawals back until the next year", () => {
    const entries: RoomEntry[] = [{ accountType: "TFSA", year: 2025, roomCents: 1_000_000 }];
    const flows = [contribution("TFSA", "2025-03-01", 1_000_000), withdrawal("TFSA", "2025-06-01", 400_000)];
    expect(computeRoomYear("TFSA", 2025, entries, flows).remainingCents).toBe(0);

    const next = computeRoomYear("TFSA", 2026, entries, flows);
    expect(next.source).toBe("estimated");
    expect(next.estimatedFromYear).toBe(2025);
    // 0 unused + 4,000 withdrawn + 7,000 new room.
    expect(next.startingRoomCents).toBe(400_000 + tfsaAnnualLimitCents(2026));
  });

  it("carries a TFSA over-contribution forward as negative room", () => {
    const entries: RoomEntry[] = [{ accountType: "TFSA", year: 2025, roomCents: 100_000 }];
    const flows = [contribution("TFSA", "2025-03-01", 300_000)];
    expect(computeRoomYear("TFSA", 2025, entries, flows).overCents).toBe(200_000);
    expect(computeRoomYear("TFSA", 2026, entries, flows).startingRoomCents).toBe(700_000 - 200_000);
  });

  it("carries at most $8,000 of FHSA room and never more than the lifetime limit allows", () => {
    const entries: RoomEntry[] = [{ accountType: "FHSA", year: 2024, roomCents: 800_000 }];
    // Nothing contributed in 2024: 8,000 carries, plus 8,000 new.
    expect(computeRoomYear("FHSA", 2025, entries, []).startingRoomCents).toBe(1_600_000);
    // Two untouched years still only carry 8,000.
    expect(computeRoomYear("FHSA", 2026, entries, []).startingRoomCents).toBe(1_600_000);

    const heavy: RoomEntry[] = [{ accountType: "FHSA", year: 2026, roomCents: 1_600_000 }];
    const flows = [
      contribution("FHSA", "2023-05-01", 800_000),
      contribution("FHSA", "2024-05-01", 800_000),
      contribution("FHSA", "2025-05-01", 800_000),
      contribution("FHSA", "2026-05-01", 1_600_000),
    ];
    // 40,000 lifetime minus 40,000 contributed through 2026 leaves nothing for 2027.
    expect(computeRoomYear("FHSA", 2027, heavy, flows).startingRoomCents).toBe(0);
  });

  it("does not let FHSA withdrawals restore room", () => {
    const entries: RoomEntry[] = [{ accountType: "FHSA", year: 2025, roomCents: 800_000 }];
    const flows = [contribution("FHSA", "2025-02-01", 800_000), withdrawal("FHSA", "2025-08-01", 800_000)];
    expect(computeRoomYear("FHSA", 2026, entries, flows).startingRoomCents).toBe(800_000);
  });

  it("leaves RRSP room unknown for a year without an entry", () => {
    const entries: RoomEntry[] = [{ accountType: "RRSP", year: 2025, roomCents: 1_000_000 }];
    const room = computeRoomYear("RRSP", 2026, entries, []);
    expect(room.source).toBe("unknown");
    expect(room.remainingCents).toBeNull();
  });

  it("counts RRSP contributions in the next year's first 60 days against the earlier year", () => {
    const entries: RoomEntry[] = [{ accountType: "RRSP", year: 2025, roomCents: 1_000_000 }];
    const flows = [contribution("RRSP", "2025-01-20", 999_999), contribution("RRSP", "2026-02-10", 1_250_000)];
    const room = computeRoomYear("RRSP", 2025, entries, flows);
    expect(room.contributedCents).toBe(1_250_000);
    expect(room.overCents).toBe(250_000);
    expect(room.penaltyExcessCents).toBe(50_000);
  });

  it("ignores flows for other account types", () => {
    const entries: RoomEntry[] = [{ accountType: "TFSA", year: 2026, roomCents: 700_000 }];
    const flows = [contribution("RRSP", "2026-05-01", 700_000), contribution("FHSA", "2026-05-01", 700_000)];
    expect(computeRoomYear("TFSA", 2026, entries, flows).remainingCents).toBe(700_000);
  });
});

describe("previewContribution", () => {
  const entries: RoomEntry[] = [
    { accountType: "TFSA", year: 2026, roomCents: 700_000 },
    { accountType: "RRSP", year: 2026, roomCents: 500_000 },
  ];

  it("returns nothing when the contribution fits", () => {
    expect(previewContribution("TFSA", d("2026-06-01"), 700_000, entries, [])).toBeNull();
  });

  it("warns with the amount over", () => {
    const flows = [contribution("TFSA", "2026-02-01", 600_000)];
    expect(previewContribution("TFSA", d("2026-06-01"), 300_000, entries, flows)).toEqual({
      roomYear: 2026,
      remainingBeforeCents: 100_000,
      overByCents: 200_000,
      withinCushion: false,
    });
  });

  it("flags an RRSP excess inside the $2,000 cushion", () => {
    expect(previewContribution("RRSP", d("2026-06-01"), 600_000, entries, [])?.withinCushion).toBe(true);
    expect(previewContribution("RRSP", d("2026-06-01"), 800_000, entries, [])?.withinCushion).toBe(false);
  });

  it("says nothing when the room is unknown", () => {
    expect(previewContribution("FHSA", d("2026-06-01"), 9_999_999, entries, [])).toBeNull();
  });
});
