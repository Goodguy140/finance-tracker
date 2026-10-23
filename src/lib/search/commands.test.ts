import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, settingsHref } from "@/lib/settings-sections";
import { availableCommands, COMMANDS, matchCommands, scoreCommand, type Command } from "./commands";

const member = availableCommands({ isAdmin: false, hasBanks: false });
const everyone = availableCommands({ isAdmin: true, hasBanks: true });
const ids = (list: Command[]) => list.map((c) => c.id);

describe("matchCommands", () => {
  it("finds an action from the start of each word", () => {
    expect(ids(matchCommands(everyone, "add tr"))[0]).toBe("add-transfer");
    expect(ids(matchCommands(everyone, "transfer"))).toContain("add-transfer");
  });

  it("matches words in any order and on keywords", () => {
    expect(ids(matchCommands(everyone, "bank sync"))).toContain("sync-banks");
    expect(ids(matchCommands(everyone, "tfsa"))).toContain("set-room");
    expect(ids(matchCommands(everyone, "passkey"))).toEqual(expect.arrayContaining(["set-passkeys", "settings-security"]));
  });

  it("puts a label that starts with the query ahead of a keyword match", () => {
    const found = ids(matchCommands(everyone, "budget"));
    expect(found.indexOf("set-budgets")).toBeLessThan(found.indexOf("settings-notifications"));
    expect(found[0]).toBe("set-budgets");
  });

  it("ignores case and accents", () => {
    expect(ids(matchCommands(everyone, "RÉPORTS"))).toContain("page-reports");
  });

  it("returns nothing for a query nothing contains", () => {
    expect(matchCommands(everyone, "zzzz-no-such-thing")).toEqual([]);
    expect(scoreCommand(COMMANDS[0], "zzzz")).toBe(0);
  });

  it("offers the suggestions before anything is typed, leaving out what the user cannot use", () => {
    expect(ids(matchCommands(everyone, "  "))).toContain("sync-banks");
    expect(ids(matchCommands(member, ""))).not.toContain("sync-banks");
    expect(ids(matchCommands(member, "")).slice(0, 3)).toEqual(["add-expense", "add-income", "add-transfer"]);
  });
});

describe("availableCommands", () => {
  it("keeps admin pages from members and bank sync from users without a bank", () => {
    expect(ids(member)).not.toContain("admin-users");
    expect(ids(member)).not.toContain("sync-banks");
    expect(ids(everyone)).toEqual(expect.arrayContaining(["admin-users", "sync-banks"]));
    expect(ids(matchCommands(member, "audit log"))).toEqual([]);
  });

  it("has every settings section", () => {
    const hrefs = member.flatMap((c) => (c.run.type === "link" ? [c.run.href] : []));
    for (const section of SETTINGS_SECTIONS) expect(hrefs).toContain(settingsHref(section.id));
  });

  it("uses unique ids", () => {
    expect(new Set(ids([...COMMANDS])).size).toBe(COMMANDS.length);
  });
});

describe("every link", () => {
  // A renamed or removed page should fail here, not leave a search result that 404s.
  it.each(
    COMMANDS.flatMap((c) => (c.run.type === "link" || c.run.type === "download" ? [[c.id, c.run.href] as const] : [])),
  )("%s points at a route that exists (%s)", (_id, href) => {
    const path = href.split(/[?#]/)[0].replace(/^\//, "");
    const app = join(process.cwd(), "src", "app", path);
    expect(existsSync(join(app, "page.tsx")) || existsSync(join(app, "route.ts"))).toBe(true);
  });
});
