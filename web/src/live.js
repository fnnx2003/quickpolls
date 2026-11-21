import { eventsUrl } from "./api.js";

const RETRY_MS = 10000;

// Live updates over Server-Sent Events. EventSource reconnects by itself after network blips;
// we only step in when the server refuses the stream outright (e.g. an older API without /api/events).
// Status: "connecting" | "live" | "offline". While not "live", the app falls back to polling.
export function connectLive({ onEvent, onStatus }) {
  let source = null;
  let retryTimer = null;

  function open() {
    source = new EventSource(eventsUrl);
    source.onopen = () => onStatus("live");
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        // ignore malformed messages
      }
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        onStatus("offline");
        retryTimer = setTimeout(open, RETRY_MS);
      } else {
        onStatus("connecting");
      }
    };
  }

  open();
  return () => {
    clearTimeout(retryTimer);
    source?.close();
  };
}
