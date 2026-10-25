import { describe, it, expect } from "vitest";
import { percent, cleanOptions, timeAgo, timeLeft, leaders, pollIdFromHash } from "./utils.js";

describe("percent", () => {
  it("handles zero total", () => expect(percent(0, 0)).toBe(0));
  it("rounds", () => expect(percent(1, 3)).toBe(33));
});

describe("cleanOptions", () => {
  it("trims and drops empty entries", () => {
    expect(cleanOptions([" a ", "", "  ", "b"])).toEqual(["a", "b"]);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  it("just now", () => expect(timeAgo("2026-01-01T11:59:30Z", now)).toBe("just now"));
  it("minutes", () => expect(timeAgo("2026-01-01T11:50:00Z", now)).toBe("10m ago"));
  it("days", () => expect(timeAgo("2025-12-30T12:00:00Z", now)).toBe("2d ago"));
});

describe("timeLeft", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  it("past", () => expect(timeLeft("2026-01-01T11:00:00Z", now)).toBe(null));
  it("minutes", () => expect(timeLeft("2026-01-01T12:10:00Z", now)).toBe("in 10m"));
  it("days", () => expect(timeLeft("2026-01-04T12:00:00Z", now)).toBe("in 3d"));
});

describe("leaders", () => {
  it("no votes", () => expect(leaders([{ id: 1, votes: 0 }])).toEqual([]));
  it("ties", () =>
    expect(leaders([{ id: 1, votes: 2 }, { id: 2, votes: 2 }, { id: 3, votes: 1 }])).toEqual([1, 2]));
});

describe("pollIdFromHash", () => {
  it("parses", () => expect(pollIdFromHash("#/poll/12")).toBe(12));
  it("ignores others", () => expect(pollIdFromHash("#/other")).toBe(null));
});
