import { describe, expect, it } from "vitest";
import { REVIEW_QUEUE_PAGE_SIZE, nextReviewQueueLimit, parseReviewQueueLimit } from "./review-queue-page";

describe("parseReviewQueueLimit", () => {
  it("defaults to one page", () => {
    expect(parseReviewQueueLimit(undefined)).toBe(REVIEW_QUEUE_PAGE_SIZE);
    expect(parseReviewQueueLimit("")).toBe(REVIEW_QUEUE_PAGE_SIZE);
    expect(parseReviewQueueLimit("abc")).toBe(REVIEW_QUEUE_PAGE_SIZE);
    expect(parseReviewQueueLimit("-5")).toBe(REVIEW_QUEUE_PAGE_SIZE);
    expect(parseReviewQueueLimit("10")).toBe(REVIEW_QUEUE_PAGE_SIZE);
  });

  it("rounds up to whole pages", () => {
    expect(parseReviewQueueLimit("400")).toBe(400);
    expect(parseReviewQueueLimit("401")).toBe(600);
    expect(parseReviewQueueLimit(["600", "200"])).toBe(600);
  });
});

describe("nextReviewQueueLimit", () => {
  it("is null once every row is shown", () => {
    expect(nextReviewQueueLimit(0, 0)).toBeNull();
    expect(nextReviewQueueLimit(150, 150)).toBeNull();
    expect(nextReviewQueueLimit(200, 200)).toBeNull();
  });

  it("asks for the next page when rows are left", () => {
    expect(nextReviewQueueLimit(200, 201)).toBe(400);
    expect(nextReviewQueueLimit(400, 1000)).toBe(600);
  });
});
