import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectLive } from "./live.js";

// api.js reads window.__APP_CONFIG__ at import time; tests run in Node, without a browser.
vi.hoisted(() => {
  globalThis.window = {};
});

// Minimal stand-in for the browser's EventSource.
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = FakeEventSource.CONNECTING;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("connectLive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports status and parses events", () => {
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    connectLive({ onEvent, onStatus });
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe("/api/events");

    es.onopen();
    es.onmessage({ data: '{"type":"poll.voted","pollId":3}' });
    es.onmessage({ data: "not json" });

    expect(onStatus).toHaveBeenLastCalledWith("live");
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: "poll.voted", pollId: 3 });
  });

  it("retries after the server refuses the stream", () => {
    const onStatus = vi.fn();
    const stop = connectLive({ onEvent: () => {}, onStatus });
    const es = FakeEventSource.instances[0];

    es.readyState = FakeEventSource.CLOSED;
    es.onerror();
    expect(onStatus).toHaveBeenLastCalledWith("offline");

    vi.advanceTimersByTime(10000);
    expect(FakeEventSource.instances).toHaveLength(2);

    stop();
    expect(FakeEventSource.instances[1].readyState).toBe(FakeEventSource.CLOSED);
  });
});
