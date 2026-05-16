export function AdminBackupPanel() {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="font-semibold text-slate-100">Backup &amp; restore</h2>
      <p className="text-xs text-slate-500">
        Download a JSON snapshot of <strong>your own</strong> user record and related finance data. Only{" "}
        <code className="text-slate-400">SERVER_ADMIN</code> accounts can use this export endpoint.
      </p>
      <p>
        <a
          href="/api/backup/export"
          className="inline-flex rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
        >
          Download JSON backup
        </a>
      </p>
      <div className="text-xs text-slate-400 space-y-2">
        <p className="font-medium text-amber-200/90">Highly sensitive</p>
        <p>
          The file can include OAuth tokens, password hashes, reset token hashes, and full transaction history. Store it
          encrypted and never commit it to git.
        </p>
        <p className="font-medium text-slate-200">Included (high level)</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>User profile, role, password hash field, email verification</li>
          <li>Linked OAuth accounts (access/refresh tokens)</li>
          <li>Financial accounts, categories, transactions (including splits), budgets, subscriptions</li>
          <li>Investment flows and portfolio snapshots</li>
          <li>Password reset token metadata</li>
        </ul>
        <p className="font-medium text-slate-200">Not included</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Other users&apos; data</li>
          <li>Server-wide encrypted settings (OAuth admin keys live in the database separately)</li>
          <li>Sessions</li>
        </ul>
        <p className="font-medium text-slate-200">SQLite restore (manual)</p>
        <p>
          There is no in-app destructive restore. To restore the whole app: stop traffic, replace the SQLite database
          file on disk, restart the container, then verify login, dashboard, and transactions. To merge a per-user JSON
          file, use <strong>Settings → Import backup</strong> (same email only).
        </p>
      </div>
    </section>
  );
}
