-- AlterTable
-- Session revocation counter. Existing rows start at 0, which matches the value
-- already-issued tokens are treated as carrying, so this does not sign anyone out.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
