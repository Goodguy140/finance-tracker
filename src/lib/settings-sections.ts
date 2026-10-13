/**
 * Every page under Settings, in the order the sidebar and the phone list show them. One
 * list, so the nav, the Settings home and the old `#hash` redirects cannot drift apart.
 */
export type SettingsGroupId = "you" | "money" | "data";

export type SettingsSectionId =
  | "profile"
  | "security"
  | "notifications"
  | "appearance"
  | "accounts"
  | "goals"
  | "banks"
  | "categories"
  | "rules"
  | "tags"
  | "subscriptions"
  | "import"
  | "backup"
  | "developer";

export type SettingsSection = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  /** One line under the page title, and under the row on the Settings home. */
  summary: string;
  /** Extra words the settings search matches, beyond the label and summary. */
  keywords: string[];
};

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "you", label: "You" },
  { id: "money", label: "Money" },
  { id: "data", label: "Data" },
];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "profile",
    group: "you",
    label: "Profile",
    summary: "Your name, country and timezone.",
    keywords: ["name", "country", "region", "timezone", "email"],
  },
  {
    id: "security",
    group: "you",
    label: "Security",
    summary: "Passkeys, recovery codes, password and linked sign-ins.",
    keywords: ["password", "passkey", "mfa", "2fa", "recovery", "google", "sign in"],
  },
  {
    id: "notifications",
    group: "you",
    label: "Notifications",
    summary: "Budget alerts by email.",
    keywords: ["email", "alerts", "budget alert"],
  },
  {
    id: "appearance",
    group: "you",
    label: "Appearance",
    summary: "Dashboard readability and installing the app.",
    keywords: ["dashboard", "readability", "columns", "install", "pwa", "home screen"],
  },
  {
    id: "accounts",
    group: "money",
    label: "Accounts",
    summary: "Where your transactions are recorded.",
    keywords: ["balance", "net worth", "savings", "archive", "default", "tfsa", "rrsp", "fhsa", "contribution room", "currency"],
  },
  {
    id: "goals",
    group: "money",
    label: "Savings goals",
    summary: "What you're saving toward, and how far along you are.",
    keywords: ["goal", "target", "emergency fund", "save up", "down payment"],
  },
  {
    id: "banks",
    group: "money",
    label: "Connected banks",
    summary: "Bank connections and where each account syncs to.",
    keywords: ["plaid", "bank", "sync", "link", "connect"],
  },
  {
    id: "categories",
    group: "money",
    label: "Categories & budgets",
    summary: "Your categories, the monthly budget on each, and bank category mapping.",
    keywords: ["budget", "limit", "merge", "rename", "plaid mapping"],
  },
  {
    id: "rules",
    group: "money",
    label: "Rules",
    summary: "Fill in categories, titles and more automatically.",
    keywords: ["automation", "auto categorize", "learned"],
  },
  {
    id: "tags",
    group: "money",
    label: "Tags",
    summary: "Rename, merge and delete tags.",
    keywords: ["label"],
  },
  {
    id: "subscriptions",
    group: "money",
    label: "Subscriptions",
    summary: "Shared subscriptions and who has paid.",
    keywords: ["recurring", "split", "share", "netflix"],
  },
  {
    id: "import",
    group: "data",
    label: "Import",
    summary: "Bring in expenses from a CSV statement.",
    keywords: ["csv", "statement", "upload"],
  },
  {
    id: "backup",
    group: "data",
    label: "Backup & export",
    summary: "Download or restore your data, or start over.",
    keywords: ["export", "json", "restore", "delete account", "clear data", "danger"],
  },
  {
    id: "developer",
    group: "data",
    label: "Developer",
    summary: "API tokens for other apps.",
    keywords: ["api", "token", "integration"],
  },
];

export function settingsHref(id: SettingsSectionId): string {
  return `/settings/${id}`;
}

export function getSettingsSection(id: SettingsSectionId): SettingsSection {
  const section = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown settings section ${id}`);
  return section;
}

/**
 * Where each anchor from the old single-page Settings lands now. Links and bookmarks to
 * `/settings#plaid` and friends keep working; the hash never reaches the server, so the
 * Settings home resolves it in the browser.
 */
const LEGACY_HASHES: Record<string, string> = {
  profile: "/settings/profile",
  security: "/settings/security",
  accounts: "/settings/accounts",
  balances: "/settings/accounts",
  goals: "/settings/goals",
  "contribution-room": "/settings/accounts",
  tfsa: "/settings/accounts",
  rrsp: "/settings/accounts",
  fhsa: "/settings/accounts",
  banks: "/settings/banks",
  plaid: "/settings/banks",
  categories: "/settings/categories",
  "bank-categories": "/settings/categories",
  budgets: "/settings/categories",
  rules: "/settings/rules",
  automation: "/settings/rules",
  tags: "/settings/tags",
  subscriptions: "/settings/subscriptions",
  subs: "/settings/subscriptions",
  data: "/settings/import",
  import: "/settings/import",
  advanced: "/settings/backup",
  backup: "/settings/backup",
  integrations: "/settings/developer",
  api: "/settings/developer",
  tokens: "/settings/developer",
};

export function resolveLegacySettingsHash(hash: string): string | null {
  const key = hash.replace(/^#/, "").toLowerCase();
  return LEGACY_HASHES[key] ?? null;
}

/** Case-insensitive match on label, summary and keywords, for the settings search box. */
export function matchSettingsSection(section: SettingsSection, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [section.label, section.summary, ...section.keywords].some((text) => text.toLowerCase().includes(q));
}
