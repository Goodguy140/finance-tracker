import { describe, expect, it } from "vitest";
import { MAX_TAGS_PER_TRANSACTION, normalizeTagName, parseTagNames, resolveTagFilter, tagNameKey } from "./tags";

describe("normalizeTagName", () => {
  it("trims, collapses spaces and drops a leading #", () => {
    expect(normalizeTagName("  #Tax   deductible ")).toBe("Tax deductible");
    expect(normalizeTagName("##")).toBe("");
  });

  it("cannot keep a comma, the field's separator", () => {
    expect(normalizeTagName("a,b")).toBe("a b");
  });

  it("matches names case-insensitively", () => {
    expect(tagNameKey(" Trip ")).toBe(tagNameKey("#trip"));
  });
});

describe("parseTagNames", () => {
  it("splits each value on commas, keeps the first spelling and drops empties", () => {
    expect(parseTagNames(["Trip, reimbursable", "trip", "", " , "])).toEqual(["Trip", "reimbursable"]);
  });

  it("refuses more tags than a transaction can hold rather than dropping some", () => {
    const names = Array.from({ length: MAX_TAGS_PER_TRANSACTION + 1 }, (_, i) => `t${i}`);
    expect(() => parseTagNames(names)).toThrow(/up to/);
  });
});

describe("resolveTagFilter", () => {
  const tags = [{ id: "t1", name: "Trip" }];

  it("accepts only an id the user owns", () => {
    expect(resolveTagFilter("t1", tags)).toEqual(tags[0]);
    expect(resolveTagFilter(["t1", "t2"], tags)).toEqual(tags[0]);
    expect(resolveTagFilter("someone-elses", tags)).toBeNull();
    expect(resolveTagFilter(undefined, tags)).toBeNull();
  });
});
