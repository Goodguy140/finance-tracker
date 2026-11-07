/**
 * Which cards Home shows, and in what order, as the person arranged them under Edit Home. Kept on
 * the phone for one sign-in (`src/state/home-layout.ts`); until they change it, Home is the default
 * below.
 */

/** Every card Home can show, in the default order. `shown` is whether a fresh Home has it. */
export const HOME_SECTIONS = [
  { id: 'safe-to-spend', title: 'Safe to spend', description: 'What is free to spend until month end', shown: true },
  { id: 'waiting', title: 'Waiting for you', description: 'Bank rows and entries to review, when there are any', shown: true },
  { id: 'spending', title: 'Spending charts', description: 'By category and cumulative, swiped between', shown: true },
  { id: 'budgets', title: 'Budgets', description: 'Budgets at 80% or more, and the month’s total', shown: true },
  { id: 'coming-up', title: 'Bills and pay', description: 'What is due in the next few days', shown: true },
  { id: 'score', title: 'Financial score', description: 'Your score and how it moved', shown: true },
  { id: 'net-worth', title: 'Net worth', description: 'What you own less what you owe', shown: true },
  { id: 'goals', title: 'Savings goals', description: 'Your first few goals and what each needs, when you have any', shown: true },
  { id: 'recent', title: 'Recent transactions', description: 'The last few entries, newest first', shown: false },
  { id: 'insights', title: 'Insights', description: 'The most pressing few', shown: false },
] as const;

export type HomeSection = (typeof HOME_SECTIONS)[number];
export type HomeSectionId = HomeSection['id'];

/** The cards on Home, top to bottom. Every other card is under More cards. */
export type HomeLayout = readonly HomeSectionId[];

/**
 * What is kept on the phone: the cards on Home, and every card the app knew of when they were
 * arranged, so a card added in a later update can still appear where it belongs.
 */
export type StoredHomeLayout = { shown: string[]; known: string[] };

const IDS: readonly HomeSectionId[] = HOME_SECTIONS.map((section) => section.id);

export const DEFAULT_HOME_LAYOUT: HomeLayout = HOME_SECTIONS.filter((section) => section.shown).map((section) => section.id);

function isSectionId(value: unknown): value is HomeSectionId {
  return typeof value === 'string' && (IDS as readonly string[]).includes(value);
}

export function homeSection(id: HomeSectionId): HomeSection {
  return HOME_SECTIONS.find((section) => section.id === id)!;
}

/**
 * The layout to show from what was kept. Nothing kept (or something unreadable) is the default.
 * Cards the phone no longer has are dropped. A card that is new since the person arranged Home
 * comes in as a fresh Home would have it: on, just after the card it follows by default, or off.
 */
export function resolveHomeLayout(stored: unknown): HomeLayout {
  if (!stored || typeof stored !== 'object') return DEFAULT_HOME_LAYOUT;
  const { shown, known } = stored as Partial<StoredHomeLayout>;
  if (!Array.isArray(shown)) return DEFAULT_HOME_LAYOUT;
  const layout: HomeSectionId[] = [];
  for (const id of shown) if (isSectionId(id) && !layout.includes(id)) layout.push(id);
  const knew = new Set(Array.isArray(known) ? known : []);
  HOME_SECTIONS.forEach((section, index) => {
    if (knew.has(section.id) || !section.shown || layout.includes(section.id)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const placed = layout.indexOf(HOME_SECTIONS[before].id);
      if (placed >= 0) {
        at = placed + 1;
        break;
      }
    }
    layout.splice(at, 0, section.id);
  });
  return layout;
}

export function storedHomeLayout(layout: HomeLayout): StoredHomeLayout {
  return { shown: [...layout], known: [...IDS] };
}

/** The cards not on Home, in the default order: the More cards list. */
export function hiddenSections(layout: HomeLayout): HomeSectionId[] {
  return IDS.filter((id) => !layout.includes(id));
}

/** Puts a card back on Home, at the bottom, as iOS adds a control. */
export function addSection(layout: HomeLayout, id: HomeSectionId): HomeLayout {
  return layout.includes(id) ? layout : [...layout, id];
}

export function removeSection(layout: HomeLayout, id: HomeSectionId): HomeLayout {
  return layout.filter((shown) => shown !== id);
}

/**
 * A drag in the list, as SwiftUI reports it: the rows picked up, and the position they were put
 * down at, counted before they were lifted out (so it can be `layout.length`).
 */
export function moveSections(layout: HomeLayout, sourceIndices: readonly number[], destination: number): HomeLayout {
  const sources = [...new Set(sourceIndices)].filter((i) => i >= 0 && i < layout.length).sort((a, b) => a - b);
  if (sources.length === 0) return layout;
  const moving = sources.map((i) => layout[i]);
  const rest = layout.filter((_, i) => !sources.includes(i));
  const target = Math.min(Math.max(destination, 0), layout.length);
  const at = target - sources.filter((i) => i < target).length;
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return next.every((id, i) => id === layout[i]) ? layout : next;
}

export function isDefaultHomeLayout(layout: HomeLayout): boolean {
  return layout.length === DEFAULT_HOME_LAYOUT.length && layout.every((id, i) => id === DEFAULT_HOME_LAYOUT[i]);
}
