-- Credit limit and payment due day on credit card accounts, for utilization and due-date
-- reminders, and the due date a reminder last covered.
--
-- Hand-written like every migration here (see AGENTS.md). New columns on an existing table,
-- so they are also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files.
ALTER TABLE "Account" ADD COLUMN "creditLimitCents" INTEGER;
ALTER TABLE "Account" ADD COLUMN "paymentDueDay" INTEGER;
ALTER TABLE "Account" ADD COLUMN "paymentRemindedFor" DATETIME;
