/** Shown inside the admin layout while a section's data loads, so the nav responds at once. */
export default function AdminLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-40 animate-pulse rounded bg-slate-800" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
    </div>
  );
}
