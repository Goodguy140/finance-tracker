-- Interest rate and minimum payment on credit card and loan accounts, for the debt payoff plan.
--
-- Hand-written like every migration here (see AGENTS.md). New columns on an existing table,
-- so they are also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files.
ALTER TABLE "Account" ADD COLUMN "interestRateBps" INTEGER;
ALTER TABLE "Account" ADD COLUMN "minimumPaymentCents" INTEGER;
