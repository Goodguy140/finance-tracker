-- AlterTable
-- Suspension state for admin de-provisioning. Nullable and unset for every existing row, so
-- deploying this suspends nobody; the guards treat only a non-NULL value as disabled.
ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;
