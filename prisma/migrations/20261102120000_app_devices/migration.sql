-- Phone app sign-in: `AppDevice` is a signed-in phone (its token's SHA-256), `AppSignInCode` the
-- one-time PKCE code `/app/authorize` hands the app to exchange for one.
--
-- Hand-written like every migration here (see AGENTS.md). New tables only, so nothing goes in
-- REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "AppDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSignInCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSignInCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AppDevice_tokenHash_key" ON "AppDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AppDevice_userId_idx" ON "AppDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSignInCode_codeHash_key" ON "AppSignInCode"("codeHash");

-- CreateIndex
CREATE INDEX "AppSignInCode_userId_idx" ON "AppSignInCode"("userId");
