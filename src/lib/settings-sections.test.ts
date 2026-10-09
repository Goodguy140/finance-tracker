import { describe, expect, it } from "vitest";
import {
  getSettingsSection,
  matchSettingsSection,
  resolveLegacySettingsHash,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
} from "./settings-sections";

describe("settings sections", () => {
  it("gives every section a known group and a unique id", () => {
    const groups = new Set(SETTINGS_GROUPS.map((g) => g.id));
    expect(SETTINGS_SECTIONS.every((s) => groups.has(s.group))).toBe(true);
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it("sends every old tab anchor to the page that holds it now", () => {
    expect(resolveLegacySettingsHash("#budgets")).toBe("/settings/categories");
    expect(resolveLegacySettingsHash("#plaid")).toBe("/settings/banks");
    expect(resolveLegacySettingsHash("#contribution-room")).toBe("/settings/accounts");
    expect(resolveLegacySettingsHash("#Advanced")).toBe("/settings/backup");
    expect(resolveLegacySettingsHash("#integrations")).toBe("/settings/developer");
    expect(resolveLegacySettingsHash("")).toBeNull();
    expect(resolveLegacySettingsHash("#nothing-here")).toBeNull();
  });

  it("points every old anchor at a page that exists", () => {
    const pages = new Set(SETTINGS_SECTIONS.map((s) => `/settings/${s.id}`));
    for (const hash of ["profile", "security", "accounts", "banks", "categories", "rules", "tags", "subscriptions", "import", "advanced", "api"]) {
      expect(pages.has(resolveLegacySettingsHash(`#${hash}`) ?? "")).toBe(true);
    }
  });

  it("finds a section by its keywords, not just its name", () => {
    expect(matchSettingsSection(getSettingsSection("profile"), "timezone")).toBe(true);
    expect(matchSettingsSection(getSettingsSection("accounts"), "TFSA")).toBe(true);
    expect(matchSettingsSection(getSettingsSection("developer"), "token")).toBe(true);
    expect(matchSettingsSection(getSettingsSection("tags"), "timezone")).toBe(false);
    expect(matchSettingsSection(getSettingsSection("tags"), "  ")).toBe(true);
  });
});
