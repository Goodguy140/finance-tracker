-- Bill reminder emails: how many days ahead a user wants them (null = off), and on each
-- recurring rule the latest occurrence already reminded, so each goes out once.
--
-- Hand-written like every migration here (see AGENTS.md). New columns on existing tables, so
-- they are also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files (to 19).
ALTER TABLE "User" ADD COLUMN "billReminderDays" INTEGER;
ALTER TABLE "RecurringTransaction" ADD COLUMN "reminderSentForDate" DATETIME;
