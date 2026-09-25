-- Strips Plaid ids from verifications whose bank connection has already been unlinked.
--
-- Unlinking used to keep plaidTransactionId, plaidItemId and plaidAccountRowId on every
-- verification it stamped with itemRemovedAt. Nothing reads them once the connection is gone
-- — the badge needs only the fact of verification and the institution name — so unlinking
-- now clears them (purgePlaidItemData). This does the same for rows unlinked before that.
--
-- Data only; the schema is unchanged. NULLs are distinct under the
-- (userId, plaidTransactionId) unique index, so any number of scrubbed rows coexist.

UPDATE "TransactionVerification"
SET "plaidTransactionId" = NULL, "plaidItemId" = NULL, "plaidAccountRowId" = NULL
WHERE "itemRemovedAt" IS NOT NULL
   OR ("plaidItemId" IS NOT NULL AND "plaidItemId" NOT IN (SELECT "id" FROM "PlaidItem"));
