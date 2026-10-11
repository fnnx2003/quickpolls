import { describe, it, expect } from "vitest";
import { percent, cleanOptions, timeAgo } from "./utils.js";

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
