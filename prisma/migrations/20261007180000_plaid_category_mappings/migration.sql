-- Plaid category mappings: the user's own choice of category for a Plaid
-- personal_finance_category code, overriding the built-in name map in category-map.ts.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "PlaidCategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "plaidCategory" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaidCategoryMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaidCategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaidCategoryMapping_userId_plaidCategory_key" ON "PlaidCategoryMapping"("userId", "plaidCategory");

-- CreateIndex
CREATE INDEX "PlaidCategoryMapping_categoryId_idx" ON "PlaidCategoryMapping"("categoryId");
