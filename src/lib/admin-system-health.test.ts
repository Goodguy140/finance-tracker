import { describe, expect, it } from "vitest";
import { summarizeDatabaseUrlDisplay } from "./admin-system-health";

describe("summarizeDatabaseUrlDisplay", () => {
  it("returns basename for file URLs and strips query", () => {
    expect(summarizeDatabaseUrlDisplay("file:./dev.db?cache=shared")).toEqual({
      kind: "sqlite_file",
      label: "dev.db",
    });
  });

  it("labels non-file URLs", () => {
    expect(summarizeDatabaseUrlDisplay("postgresql://user:pass@host/db")).toEqual({
      kind: "other",
      label: "non-file database",
    });
  });

  it("handles empty", () => {
    expect(summarizeDatabaseUrlDisplay("  ")).toEqual({ kind: "missing", label: "not configured" });
  });
});
