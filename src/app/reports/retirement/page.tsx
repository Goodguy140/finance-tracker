import Link from "next/link";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { inputClass } from "@/components/forms/shared";
import { formatCurrency, parseCentsInput } from "@/lib/money";
import { projectRetirement, type RetirementYear } from "@/lib/retirement";
import { loadRetirementDefaults } from "@/lib/retirement-data";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { loadInvestmentReturns } from "@/lib/investment-returns-data";
import { homeCurrencyOf } from "@/lib/home-currency";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";
const linkBtn =
  "inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function num(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const dollars = (cents: number) => (cents / 100).toFixed(0);

/** A deterministic Canadian retirement / FIRE projection, starting from the user's own numbers. */
export default async function RetirementPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const currency = homeCurrencyOf(user.countryCode);
  const fmt = (cents: number) => formatCurrency(Math.round(cents / 100) * 100, currency).replace(/\.00$/, "");
  const [d, returns] = await Promise.all([loadRetirementDefaults(user), loadInvestmentReturns(user)]);
  // The user's own money-weighted return, offered once there is a year of history to go on.
  const ownWindow = returns.total?.sinceStart;
  const ownReturnPct =
    ownWindow && ownWindow.days >= 365 && ownWindow.annualRate !== null
      ? Math.round(Math.min(20, Math.max(-5, ownWindow.annualRate * 100)) * 10) / 10
      : null;
  const withReturn = (pct: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
    }
    params.set("return", String(pct));
    return `/reports/retirement?${params.toString()}`;
  };

  const ageRaw = one(sp.age).trim();
  const age = ageRaw === "" ? null : Math.round(num(ageRaw, 35, 16, 90));
  const retireAge = Math.round(num(one(sp.retire), 65, 30, 90));
  const incomeCents = Math.max(0, parseCentsInput(one(sp.income)) ?? d.incomeCents);
  const savingsCents = Math.max(0, parseCentsInput(one(sp.savings)) ?? Math.max(0, d.incomeCents - d.spendingCents));
  const spendingCents = Math.max(0, parseCentsInput(one(sp.spending)) ?? d.spendingCents);
  const returnPct = num(one(sp.return), 6, -5, 20);
  const inflationPct = num(one(sp.inflation), 2.5, 0, 15);
  const withdrawalPct = num(one(sp.swr), 4, 1, 10);
  // The checkbox follows a hidden "off", so a ticked box sends both and the last one wins.
  const fhsaRaw = Array.isArray(sp.fhsa) ? sp.fhsa[sp.fhsa.length - 1] : (sp.fhsa ?? "");
  const fhsaEligible = fhsaRaw === "" ? d.hasFhsaAccount : fhsaRaw === "on";
  const startingTotal = d.balances.TFSA + d.balances.RRSP + d.balances.FHSA + d.balances.NON_REGISTERED;

  const projection =
    age === null
      ? null
      : projectRetirement({
          startYear: d.year,
          age,
          retireAge,
          endAge: 95,
          annualSavingsCents: savingsCents,
          annualIncomeCents: incomeCents,
          retiredSpendingCents: spendingCents,
          returnPct,
          inflationPct,
          withdrawalPct,
          balances: d.balances,
          room: d.room,
          fhsaEligible,
          fhsaContributedCents: d.fhsaContributedCents,
        });
  const milestones: RetirementYear[] = projection
    ? projection.years.filter((y, i) => i === 0 || y.age % 5 === 0 || y.age === retireAge || i === projection.years.length - 1)
    : [];
  const firstYear = projection?.years[0];

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      <main className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Retirement</h1>
            <p className="mt-1 text-sm text-slate-400">
              When your savings could cover your spending, with TFSA, RRSP and FHSA room in the picture. In today&apos;s dollars.
            </p>
          </div>
          <Link href="/reports" className={linkBtn}>
            Back to reports
          </Link>
        </div>

        <section aria-labelledby="retire-inputs" className={card}>
          <h2 id="retire-inputs" className="text-lg font-semibold">
            Your numbers
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Filled in from the last 12 months ({fmt(d.incomeCents)} income, {fmt(d.spendingCents)} spending) and{" "}
            {fmt(startingTotal)} in TFSA, RRSP, FHSA and non-registered accounts. Change anything to try it out.
          </p>
          {ownReturnPct !== null && ownWindow ? (
            <p className="mt-1 text-xs text-slate-400" data-testid="retire-own-return">
              Your investments have returned {ownReturnPct}% a year since {formatDateOnlyUtc(ownWindow.startDate)}.{" "}
              {ownReturnPct === returnPct ? (
                "That is the return used below."
              ) : (
                <Link href={withReturn(ownReturnPct)} className="text-sky-300 hover:text-sky-200">
                  Use {ownReturnPct}%
                </Link>
              )}
            </p>
          ) : null}
          <form method="get" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { name: "age", label: "Your age", value: ageRaw, placeholder: "35" },
              { name: "retire", label: "Retire at", value: String(retireAge) },
              { name: "income", label: "Income a year", value: dollars(incomeCents) },
              { name: "savings", label: "Saving a year", value: dollars(savingsCents) },
              { name: "spending", label: "Spending a year in retirement", value: dollars(spendingCents) },
              { name: "return", label: "Return %", value: String(returnPct) },
              { name: "inflation", label: "Inflation %", value: String(inflationPct) },
              { name: "swr", label: "Withdrawal rate %", value: String(withdrawalPct) },
            ].map((f) => (
              <label key={f.name} className="block">
                <span className="text-xs text-slate-400">{f.label}</span>
                <input name={f.name} inputMode="decimal" defaultValue={f.value} placeholder={f.placeholder} aria-label={f.label} className={inputClass} />
              </label>
            ))}
            <label className="col-span-2 inline-flex items-center gap-2 text-sm text-slate-300 sm:col-span-3">
              <input type="hidden" name="fhsa" value="off" />
              <input
                type="checkbox"
                name="fhsa"
                value="on"
                defaultChecked={fhsaEligible}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-2 focus:ring-blue-500/40"
              />
              Saving for a first home (FHSA)
            </label>
            <div className="col-span-2 flex items-end sm:col-span-1">
              <button type="submit" className={`${linkBtn} w-full`}>
                Work it out
              </button>
            </div>
          </form>
        </section>

        {projection && firstYear ? (
          <>
            <section aria-label="Summary" className="grid gap-3 sm:grid-cols-4" data-testid="retire-summary">
              {[
                { label: "Enough to retire on", value: fmt(projection.fiNumberCents), hint: `${fmt(spendingCents)} ÷ ${withdrawalPct}%` },
                {
                  label: "Financially independent",
                  value: projection.fiAge === null ? "Not by 95" : `At ${projection.fiAge}`,
                  hint: projection.fiAge === null ? "Save more or spend less" : `In ${d.year + projection.fiAge - age!}`,
                  testId: "retire-fi-age",
                },
                { label: `Saved by ${retireAge}`, value: fmt(projection.atRetirementCents), hint: "Before you stop working" },
                {
                  label: "Money lasts",
                  value: projection.runsOutAge === null ? "Past 95" : `Until ${projection.runsOutAge}`,
                  hint: "Spending from savings alone",
                  testId: "retire-runs-out",
                },
              ].map((t) => (
                <div key={t.label} className={card} data-testid={t.testId}>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">{t.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</p>
                  <p className="text-xs text-slate-500">{t.hint}</p>
                </div>
              ))}
            </section>

            <section aria-labelledby="retire-this-year" className={card}>
              <h2 id="retire-this-year" className="text-lg font-semibold">
                Where this year&apos;s savings go
              </h2>
              <p className="mt-1 text-xs text-slate-500">TFSA first, then RRSP, then FHSA, each within its room; the rest is non-registered.</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="retire-allocation">
                {(["TFSA", "RRSP", "FHSA", "NON_REGISTERED"] as const).map((b) => (
                  <div key={b} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-400">{b === "NON_REGISTERED" ? "Non-registered" : b}</dt>
                    <dd className="tabular-nums">{fmt(firstYear.contributed[b])}</dd>
                    {b !== "NON_REGISTERED" && d.room[b] === null ? (
                      <p className="text-[11px] text-slate-500">Room not entered: new room only</p>
                    ) : null}
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="retire-table" className={card}>
              <h2 id="retire-table" className="text-lg font-semibold">
                Year by year
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm" data-testid="retire-years">
                  <thead className="text-left text-xs text-slate-400">
                    <tr>
                      <th className="py-1 pr-2 font-normal">Age</th>
                      <th className="py-1 pr-2 text-right font-normal">TFSA</th>
                      <th className="py-1 pr-2 text-right font-normal">RRSP</th>
                      <th className="py-1 pr-2 text-right font-normal">FHSA</th>
                      <th className="py-1 pr-2 text-right font-normal">Non-registered</th>
                      <th className="py-1 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {milestones.map((y) => (
                      <tr key={y.age} className={`border-t border-slate-800 ${y.shortfallCents > 0 ? "text-red-200" : ""}`}>
                        <td className="py-1 pr-2">
                          {y.age} <span className="text-xs text-slate-500">{y.year}</span>
                          {y.age === retireAge ? <span className="ml-1 text-xs text-sky-300">retire</span> : null}
                        </td>
                        <td className="py-1 pr-2 text-right">{fmt(y.balances.TFSA)}</td>
                        <td className="py-1 pr-2 text-right">{fmt(y.balances.RRSP)}</td>
                        <td className="py-1 pr-2 text-right">{fmt(y.balances.FHSA)}</td>
                        <td className="py-1 pr-2 text-right">{fmt(y.balances.NON_REGISTERED)}</td>
                        <td className="py-1 text-right">{fmt(y.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <p className={`${card} text-sm text-slate-300`} data-testid="retire-need-age">
            Enter your age above to see the projection.
          </p>
        )}

        <section aria-labelledby="retire-assumptions" className={`${card} text-xs text-slate-400`}>
          <h2 id="retire-assumptions" className="text-sm font-semibold text-slate-200">
            How it works
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>One steady path, no market ups and downs. Returns are taken net of inflation, so every amount is in today&apos;s dollars.</li>
            <li>
              New room each year: the TFSA limit, 18% of income up to the RRSP limit, and $8,000 of FHSA room up to $40,000 for life. This
              year&apos;s unused room comes from <Link href="/settings/accounts" className="text-sky-300">contribution room</Link> when you have entered it.
            </li>
            <li>In retirement, spending comes from non-registered first, then FHSA and RRSP, then TFSA. Taxes, CPP and OAS are left out.</li>
            <li>Only TFSA, RRSP, FHSA and non-registered accounts count as retirement savings.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
