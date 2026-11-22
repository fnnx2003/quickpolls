import { EventEmitter } from "node:events";
import os from "node:os";
import { log } from "./logger.js";

const CHANNEL = "quickpolls:events";

// Fans out "something changed" events to every open SSE stream (see GET /api/events).
//
// Without Redis, events stay inside this process: a browser connected to replica A never hears
// about a vote handled by replica B. With Redis (see redis.js), every replica publishes to one
// channel and relays everything it receives, so all browsers hear about all changes.
export function createEventBus({ redis = null } = {}) {
  const local = new EventEmitter();
  local.setMaxListeners(0); // one listener per open browser tab
  const emitLocal = (event) => local.emit("event", event);

  if (redis?.enabled) {
    // subscribe() is queued until the connection is up, and node-redis re-subscribes after reconnects.
    redis.starting
      .then(() =>
        redis.subscriber?.subscribe(CHANNEL, (message) => {
          try {
            emitLocal(JSON.parse(message));
          } catch {
            log.warn("ignoring malformed event", { message });
          }
        }),
      )
      .catch(() => {});
  }

  return {
    mode: redis?.enabled ? "redis" : "local",

    redisReady: () => Boolean(redis?.ready()),

    // Fire-and-forget: never throws, so a Redis outage can't fail a vote.
    async publish(type, pollId) {
      const event = { type, pollId, from: os.hostname(), at: new Date().toISOString() };
      if (redis?.client) {
        try {
          await redis.client.publish(CHANNEL, JSON.stringify(event));
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
  };
}
