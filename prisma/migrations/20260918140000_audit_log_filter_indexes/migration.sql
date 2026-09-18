-- CreateIndex
-- The audit review page filters by action or actor and always orders by createdAt desc.
-- The existing single-column indexes serve the filter but leave the sort to a scan.
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
