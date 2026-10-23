import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsHref } from "@/lib/settings-sections";

/**
 * The master search's fixed entries: every page, every settings section and the things inside
 * them people look for by name, and the actions it can start. Matched in the browser as you
 * type, so they answer instantly and offline; the user's own data comes from `/api/search`.
 */

export type QuickAddKind = "expense" | "income" | "transfer" | "recurring";

export type CommandRun =
  | { type: "link"; href: string }
  /** A file to save, such as the JSON backup. A plain link, not a client navigation. */
  | { type: "download"; href: string }
  | { type: "add"; kind: QuickAddKind }
  | { type: "sync-banks" }
  | { type: "sign-out" };

export type CommandSection = "Actions" | "Pages" | "Settings" | "Admin";

export type Command = {
  id: string;
  label: string;
  /** Where it is or what it does, in a few words. */
  hint: string;
  section: CommandSection;
  /** More words that should find it. */
  keywords: string[];
  run: CommandRun;
  /** Shown only to server admins. */
  adminOnly?: boolean;
  /** Shown only once a bank is connected. */
  needsBanks?: boolean;
};

export type CommandContext = { isAdmin: boolean; hasBanks: boolean };

const ACTIONS: Command[] = [
  {
    id: "add-expense",
    label: "Add expense",
    hint: "Log a purchase",
    section: "Actions",
    keywords: ["new", "spend", "purchase", "bought", "log", "create", "record"],
    run: { type: "add", kind: "expense" },
  },
  {
    id: "add-income",
    label: "Add income",
    hint: "Log pay or other money in",
    section: "Actions",
    keywords: ["new", "pay", "paycheque", "paycheck", "salary", "deposit", "earned"],
    run: { type: "add", kind: "income" },
  },
  {
    id: "add-transfer",
    label: "Add transfer",
    hint: "Move money between your accounts",
    section: "Actions",
    keywords: ["new", "move", "card payment", "pay off", "between accounts", "savings"],
    run: { type: "add", kind: "transfer" },
  },
  {
    id: "sync-banks",
    label: "Sync banks",
    hint: "Check connected banks for new transactions",
    section: "Actions",
    keywords: ["refresh", "plaid", "update", "pull", "fetch", "bank"],
    run: { type: "sync-banks" },
    needsBanks: true,
  },
  {
    id: "connect-bank",
    label: "Connect a bank",
    hint: "Settings → Connected banks",
    section: "Actions",
    keywords: ["link", "plaid", "add bank", "sync"],
    run: { type: "link", href: "/settings/banks" },
  },
  {
    id: "new-recurring",
    label: "New recurring rule",
    hint: "A bill, pay or transfer that repeats",
    section: "Actions",
    keywords: ["bill", "subscription", "repeat", "monthly", "schedule", "recurring transfer"],
    run: { type: "add", kind: "recurring" },
  },
  {
    id: "new-rule",
    label: "New rule",
    hint: "Settings → Rules",
    section: "Actions",
    keywords: ["automation", "auto categorize", "categorise"],
    run: { type: "link", href: "/settings/rules" },
  },
  {
    id: "new-goal",
    label: "New savings goal",
    hint: "Settings → Savings goals",
    section: "Actions",
    keywords: ["goal", "save up", "target"],
    run: { type: "link", href: "/settings/goals" },
  },
  {
    id: "import-csv",
    label: "Import a CSV statement",
    hint: "Settings → Import",
    section: "Actions",
    keywords: ["upload", "csv", "statement", "bank file"],
    run: { type: "link", href: "/settings/import" },
  },
  {
    id: "download-backup",
    label: "Download a backup",
    hint: "All your data as JSON",
    section: "Actions",
    keywords: ["export", "json", "save", "backup"],
    run: { type: "download", href: "/api/backup/export/me" },
  },
  {
    id: "print",
    label: "Print a summary or template",
    hint: "Reports → Print and templates",
    section: "Actions",
    keywords: ["pdf", "printable", "worksheet", "action plan", "budget template"],
    run: { type: "link", href: "/reports/print" },
  },
  {
    id: "search-transactions",
    label: "Search all transactions",
    hint: "Every month, with filters",
    section: "Actions",
    keywords: ["find", "history", "all months"],
    run: { type: "link", href: "/search" },
  },
  {
    id: "sign-out",
    label: "Log out",
    hint: "Sign out of this device",
    section: "Actions",
    keywords: ["sign out", "logout", "exit"],
    run: { type: "sign-out" },
  },
];

const PAGES: Command[] = [
  { id: "page-dashboard", label: "Dashboard", hint: "This month at a glance", keywords: ["home", "overview", "log", "expense log"], href: "/" },
  { id: "page-insights", label: "Insights", hint: "Score, coming up, ways to save", keywords: ["tips", "suggestions", "habits", "gaps"], href: "/insights" },
  { id: "page-reports", label: "Reports", hint: "Income vs spending, net worth", keywords: ["charts", "year over year", "sankey", "payees"], href: "/reports" },
  { id: "page-net-worth", label: "Net worth", hint: "Reports", keywords: ["assets", "debts", "balances"], href: "/reports#report-net-worth" },
  { id: "page-projected", label: "Projected balances", hint: "Reports", keywords: ["forecast", "future", "below zero"], href: "/reports#report-projected-balances" },
  { id: "page-score", label: "Financial score", hint: "Insights", keywords: ["health", "grade", "rating"], href: "/insights" },
  { id: "page-settings", label: "Settings", hint: "All settings", keywords: ["preferences", "options"], href: "/settings" },
].map(({ href, ...page }) => ({ ...page, section: "Pages" as const, run: { type: "link" as const, href } }));

const GROUP_LABEL = Object.fromEntries(SETTINGS_GROUPS.map((g) => [g.id, g.label]));

/** Things that live inside a settings page and that people search for by their own name. */
const SETTINGS_SHORTCUTS: Command[] = [
  { id: "set-password", label: "Change password", hint: "Settings → Security", keywords: ["reset password"], href: "/settings/security" },
  { id: "set-passkeys", label: "Passkeys", hint: "Settings → Security", keywords: ["face id", "touch id", "webauthn", "2fa", "mfa"], href: "/settings/security" },
  { id: "set-recovery", label: "Recovery codes", hint: "Settings → Security", keywords: ["backup codes", "lost passkey"], href: "/settings/security" },
  { id: "set-sign-out-all", label: "Sign out everywhere", hint: "Settings → Security", keywords: ["other devices", "sessions"], href: "/settings/security" },
  { id: "set-timezone", label: "Timezone and country", hint: "Settings → Profile", keywords: ["region", "currency", "home currency"], href: "/settings/profile" },
  { id: "set-balances", label: "Account balances", hint: "Settings → Accounts", keywords: ["manual balance", "net worth", "snapshot"], href: "/settings/accounts" },
  { id: "set-room", label: "Contribution room", hint: "Settings → Accounts", keywords: ["tfsa", "rrsp", "fhsa", "room left"], href: "/settings/accounts" },
  { id: "set-savings-accounts", label: "Counts as savings", hint: "Settings → Accounts", keywords: ["savings rate", "saved"], href: "/settings/accounts" },
  { id: "set-default-account", label: "Default expense account", hint: "Settings → Accounts", keywords: ["default card"], href: "/settings/accounts" },
  { id: "set-budgets", label: "Budgets", hint: "Settings → Categories & budgets", keywords: ["monthly budget", "limit", "spending limit"], href: "/settings/categories" },
  { id: "set-rollover", label: "Budget rollover", hint: "Settings → Categories & budgets", keywords: ["carry over", "leftover"], href: "/settings/categories" },
  { id: "set-bank-categories", label: "Bank category mapping", hint: "Settings → Categories & budgets", keywords: ["plaid category", "map"], href: "/settings/categories" },
  { id: "set-learned", label: "Learned rule suggestions", hint: "Settings → Rules", keywords: ["suggested rules"], href: "/settings/rules" },
  { id: "set-alert-emails", label: "Budget alert emails", hint: "Settings → Notifications", keywords: ["email", "notify"], href: "/settings/notifications" },
  { id: "set-install", label: "Install the app", hint: "Settings → Appearance", keywords: ["home screen", "pwa", "add to home"], href: "/settings/appearance" },
  { id: "set-restore", label: "Restore a backup", hint: "Settings → Backup & export", keywords: ["upload backup", "json"], href: "/settings/backup" },
  { id: "set-delete-account", label: "Delete account", hint: "Settings → Backup & export", keywords: ["close account", "remove account", "clear data", "start over"], href: "/settings/backup" },
  { id: "set-api-tokens", label: "API tokens", hint: "Settings → Developer", keywords: ["personal access token", "api"], href: "/settings/developer" },
].map(({ href, ...item }) => ({ ...item, section: "Settings" as const, run: { type: "link" as const, href } }));

const SETTINGS: Command[] = [
  ...SETTINGS_SECTIONS.map((s) => ({
    id: `settings-${s.id}`,
    label: s.label,
    hint: `Settings → ${GROUP_LABEL[s.group]}`,
    section: "Settings" as const,
    keywords: [s.summary, ...s.keywords],
    run: { type: "link" as const, href: settingsHref(s.id) },
  })),
  ...SETTINGS_SHORTCUTS,
];

const ADMIN: Command[] = [
  { id: "admin", label: "Admin overview", keywords: ["server", "attention"], href: "/settings/admin" },
  { id: "admin-analytics", label: "Admin analytics", keywords: ["usage", "stats"], href: "/settings/admin/analytics" },
  { id: "admin-users", label: "Users", keywords: ["members", "accounts", "roles", "disable"], href: "/settings/admin/users" },
  { id: "admin-auth", label: "Authentication", keywords: ["sign up", "signup", "google", "sso", "oauth", "password login"], href: "/settings/admin/authentication" },
  { id: "admin-integrations", label: "Integrations", keywords: ["plaid credentials", "bank connections"], href: "/settings/admin/integrations" },
  { id: "admin-operations", label: "Operations", keywords: ["sync interval", "auto-post", "retention"], href: "/settings/admin/operations" },
  { id: "admin-audit", label: "Audit log", keywords: ["history", "events", "log"], href: "/settings/admin/audit" },
  { id: "admin-system", label: "System health", keywords: ["storage", "migrations", "environment", "server backup", "metrics"], href: "/settings/admin/system" },
].map(({ href, ...item }) => ({
  ...item,
  hint: "Settings → Admin",
  section: "Admin" as const,
  run: { type: "link" as const, href },
  adminOnly: true,
}));

export const COMMANDS: readonly Command[] = [...ACTIONS, ...PAGES, ...SETTINGS, ...ADMIN];

/** Shown before anything is typed. */
const SUGGESTED_IDS = ["add-expense", "add-income", "add-transfer", "sync-banks", "search-transactions", "page-insights", "page-reports", "page-settings"];

export function availableCommands(context: CommandContext): Command[] {
  return COMMANDS.filter((c) => (!c.adminOnly || context.isAdmin) && (!c.needsBanks || context.hasBanks));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9#$.]+/g, " ")
    .trim();
}

/**
 * How well `command` answers `query`, higher is better, 0 for no match. Every word typed must
 * appear somewhere, so "add tr" finds "Add transfer" and "bank sync" finds "Sync banks"; a
 * label that starts with the query beats one that merely contains it, which beats a keyword.
 */
export function scoreCommand(command: Command, query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const label = normalize(command.label);
  const haystack = [label, normalize(command.hint), ...command.keywords.map(normalize)].join(" ");
  const words = q.split(" ");
  if (!words.every((w) => haystack.includes(w))) return 0;
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  const labelWords = label.split(" ");
  if (words.every((w) => labelWords.some((lw) => lw.startsWith(w)))) return 60;
  if (label.includes(q)) return 50;
  if (words.every((w) => label.includes(w))) return 40;
  return 20;
}

/** The commands for `query`, best first; the suggestions when it is empty. */
export function matchCommands(commands: readonly Command[], query: string, limit = 8): Command[] {
  if (!normalize(query)) {
    return SUGGESTED_IDS.map((id) => commands.find((c) => c.id === id)).filter((c): c is Command => Boolean(c));
  }
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((m) => m.command);
}
