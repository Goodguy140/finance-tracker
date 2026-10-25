-- Opt-in zero-based budgeting mode.
ALTER TABLE "User" ADD COLUMN "zeroBasedBudgeting" BOOLEAN NOT NULL DEFAULT false;
