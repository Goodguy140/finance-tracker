import Link from "next/link";

/** The dark full-page message behind not-found and error pages, in place of Next's white default. */
export function StatusPage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center text-slate-100">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-slate-400">{body}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {children}
        <Link
          href="/"
          className="touch-manipulation rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-400"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
