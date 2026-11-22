import { describe, it, expect } from "vitest";
import {
  percent,
  cleanOptions,
  timeAgo,
  timeLeft,
  leaders,
  pollIdFromHash,
  pageFromHash,
  shortVersion,
  formatDuration,
  replicaHealth,
  versionSummary,
} from "./utils.js";

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

describe("pageFromHash", () => {
  it("cluster", () => expect(pageFromHash("#/cluster")).toBe("cluster"));
  it("defaults to polls", () => expect(pageFromHash("#/poll/3")).toBe("polls"));
});

describe("shortVersion", () => {
  it("shortens git SHAs", () => expect(shortVersion("18333004777b5a42381749b5f6cc32aad7e35f65")).toBe("1833300"));
  it("keeps other tags", () => expect(shortVersion("dev")).toBe("dev"));
});

describe("formatDuration", () => {
  it("seconds", () => expect(formatDuration(42000)).toBe("42s"));
  it("minutes", () => expect(formatDuration(75000)).toBe("1m 15s"));
  it("days", () => expect(formatDuration(93784000)).toBe("1d 2h"));
});

describe("replicaHealth", () => {
  const now = new Date("2026-01-01T12:00:20Z").getTime();
  const base = { lastSeen: "2026-01-01T12:00:18Z", status: "ready", db: "ok" };
  it("ready", () => expect(replicaHealth(base, now)).toBe("ready"));
  it("stale heartbeat", () =>
    expect(replicaHealth({ ...base, lastSeen: "2026-01-01T12:00:00Z" }, now)).toBe("not-responding"));
  it("draining", () => expect(replicaHealth({ ...base, status: "shutting-down" }, now)).toBe("shutting-down"));
  it("database down", () => expect(replicaHealth({ ...base, db: "down" }, now)).toBe("db-down"));
});

describe("versionSummary", () => {
  it("counts versions, most common first", () =>
    expect(versionSummary([{ version: "a" }, { version: "b" }, { version: "b" }])).toEqual([
      { version: "b", count: 2 },
      { version: "a", count: 1 },
    ]));
});
