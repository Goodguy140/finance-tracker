-- The dashboard loads revised-but-committed rows on every render. PlaidStagedTransaction
-- rows are never pruned -- the (userId, plaidTransactionId) pair is the sync's idempotency
-- key -- so that predicate scanned a range that grows with every sync, to find a column
-- that is null for almost every row.
--
-- Index only, no new columns, so REQUIRED_SCHEMA_COLUMNS and the repair script are
-- unaffected and neither SCHEMA_REPAIR_VERSION needs bumping.

-- CreateIndex
CREATE INDEX "PlaidStagedTransaction_userId_revisedAfterResolveAt_idx" ON "PlaidStagedTransaction"("userId", "revisedAfterResolveAt");
