import type { FinancialScore, Insight, InsightSection, ScoreBand } from '@/api/types';
import { formatDay } from '@/utils/dates';

export const INSIGHTS_PATH = '/api/v1/insights';
export const SCORE_PATH = '/api/v1/score';

/** The website's Insights sections, in its order and with its titles. */
const SECTIONS: { id: InsightSection; title: string }[] = [
  { id: 'ahead', title: 'Coming up' },
  { id: 'gap', title: 'Possible gaps in your data' },
  { id: 'recurring', title: 'Recurring charges we noticed' },
  { id: 'habit', title: 'Spending habits' },
  { id: 'saving', title: 'Ways to save' },
  { id: 'improvement', title: 'Suggestions' },
  { id: 'good', title: 'Going well' },
];

export type InsightGroup = { id: InsightSection; title: string; insights: Insight[] };

/** Insights under the website's section titles, in its order, leaving out sections with none. */
export function groupInsights(insights: readonly Insight[]): InsightGroup[] {
  return SECTIONS.map((section) => ({ ...section, insights: insights.filter((i) => i.section === section.id) })).filter(
    (group) => group.insights.length > 0,
  );
}

const SEVERITY_ORDER: Record<Insight['severity'], number> = { high: 0, medium: 1, low: 2 };

/**
 * The few Home's Insights card shows: the most pressing across every section, as the website's
 * dashboard card picks them (`compareBySeverity`): severity, then the bigger amount a year.
 */
export function pressingInsights(insights: readonly Insight[], count = 3): Insight[] {
  return [...insights]
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (b.annualCents ?? 0) - (a.annualCents ?? 0) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, count);
}

/** What the ideas would save in a year between them; the server already leaves out double counting. */
export function potentialSavingCents(insights: readonly Insight[]): number {
  return insights.reduce((sum, insight) => sum + (insight.savingCents ?? 0), 0);
}

export type HideOption = { mode: 'snooze' | 'forever'; label: string };

/** The website's hide buttons for each kind of insight. */
export function hideOptions(insight: Insight, snoozeDays: number): HideOption[] {
  const snooze: HideOption = { mode: 'snooze', label: `Snooze ${snoozeDays} days` };
  if (insight.section === 'recurring') return [{ mode: 'forever', label: 'Not recurring' }];
  if (insight.section === 'habit') return [snooze, { mode: 'forever', label: "Don't flag this" }];
  return [snooze, { mode: 'forever', label: 'Dismiss' }];
}

/** "Snoozed until Thu, Dec 3", or "Dismissed" for good. */
export function hiddenText(insight: Insight): string {
  return insight.hiddenUntil ? `Snoozed until ${formatDay(insight.hiddenUntil)}` : 'Dismissed';
}

/**
 * The address of a page on the person's own server. Only a path on that server is opened, never
 * another site, whatever the server sends.
 */
export function websiteUrl(origin: string | null | undefined, path: string): string | null {
  if (!origin || !path.startsWith('/') || path.startsWith('//')) return null;
  return `${origin}${path}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Scored = Extract<FinancialScore, { status: 'scored' }>;

/** "Up 3 since October; savings rate moved most (+6)." as the website words it. */
export function scoreChangeText(score: Scored): string | null {
  const { change } = score;
  if (!change) return null;
  const delta = score.score - change.fromScore;
  const month = MONTHS[Number(change.fromMonth.slice(5, 7)) - 1] ?? change.fromMonth;
  const head = delta === 0 ? `Same as in ${month}` : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} since ${month}`;
  if (!change.mover) return `${head}.`;
  const moved = `${change.mover.delta > 0 ? '+' : '−'}${Math.abs(change.mover.delta)}`;
  return `${head}; ${change.mover.label.toLowerCase()} moved most (${moved}).`;
}

/** Which theme colour a band is drawn in: green when strong or good, amber when fair, red below. */
export function bandTone(band: ScoreBand | null): 'positive' | 'warning' | 'danger' | 'textSecondary' {
  if (band === null) return 'textSecondary';
  if (band === 'Strong' || band === 'Good') return 'positive';
  if (band === 'Fair') return 'warning';
  return 'danger';
}
