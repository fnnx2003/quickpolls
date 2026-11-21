import { EventEmitter } from "node:events";
import os from "node:os";
import { log } from "./logger.js";

const CHANNEL = "quickpolls:events";

// Fans out "something changed" events to every open SSE stream (see GET /api/events).
//
// Without REDIS_URL, events stay inside this process: a browser connected to replica A never hears
// about a vote handled by replica B. With REDIS_URL, every replica publishes to one Redis channel
// and relays everything it receives, so all browsers hear about all changes.
export function createEventBus({ redisUrl = "" } = {}) {
  const local = new EventEmitter();
  local.setMaxListeners(0); // one listener per open browser tab
  const emitLocal = (event) => local.emit("event", event);

  let pub = null;
  let sub = null;

  // Redis is optional: never block startup or crash on it, just log and keep retrying.
  async function connectRedis() {
    const { createClient } = await import("redis");
    const options = {
      url: redisUrl,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 500, 5000) },
    };
    // No offline queue on the publisher: when Redis is down, publish fails fast and we fall back to local.
    pub = createClient({ ...options, disableOfflineQueue: true });
    sub = createClient(options);

    for (const [name, client] of [["publisher", pub], ["subscriber", sub]]) {
      let lastError = "";
      client.on("ready", () => {
        lastError = "";
        log.info("redis connected", { client: name });
      });
      client.on("error", (err) => {
        if (err.message === lastError) return; // reconnect loops repeat the same error every few seconds
        lastError = err.message;
        log.warn("redis error", { client: name, error: err.message });
      });
    }

    // subscribe() is queued until the connection is up, and node-redis re-subscribes after reconnects.
    sub.connect().catch(() => {});
    sub.subscribe(CHANNEL, (message) => {
      try {
        emitLocal(JSON.parse(message));
      } catch {
        log.warn("ignoring malformed event", { message });
      }
    }).catch(() => {});
    pub.connect().catch(() => {});
  }

  const starting = redisUrl
    ? connectRedis().catch((err) => log.error("could not start redis client", { error: err.message }))
    : Promise.resolve();

  return {
    mode: redisUrl ? "redis" : "local",

    redisReady: () => Boolean(pub?.isReady && sub?.isReady),

    // Fire-and-forget: never throws, so a Redis outage can't fail a vote.
    async publish(type, pollId) {
      const event = { type, pollId, from: os.hostname(), at: new Date().toISOString() };
      if (pub?.isReady) {
        try {
          await pub.publish(CHANNEL, JSON.stringify(event));
          return; // our own subscriber delivers it back to local listeners
        } catch (err) {
          log.warn("redis publish failed, delivering locally", { error: err.message });
        }
      }
      emitLocal(event);
    },

    subscribe(listener) {
      local.on("event", listener);
      return () => local.off("event", listener);
    },

    listenerCount: () => local.listenerCount("event"),

    async close() {
      await starting; // the clients may not exist yet if close() runs right after startup
      await Promise.all([pub, sub].filter(Boolean).map((c) => c.disconnect().catch(() => {})));
    },
  };
}
