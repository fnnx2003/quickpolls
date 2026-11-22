import { log } from "./logger.js";

// Optional Redis connection, shared by live updates (events.js) and the cluster view (cluster.js).
// It never blocks startup or crashes the process: while Redis is down, callers fall back to
// per-replica behaviour, and node-redis keeps reconnecting in the background.
export function createRedis(url = "") {
  let client = null; // regular commands: PUBLISH, SET, SCAN…
  let subscriber = null; // a connection in subscribe mode can't run other commands

  async function start() {
    const { createClient } = await import("redis");
    const options = { url, socket: { reconnectStrategy: (retries) => Math.min(retries * 500, 5000) } };
    // No offline queue for commands: when Redis is down they fail fast instead of piling up in memory.
    client = createClient({ ...options, disableOfflineQueue: true });
    subscriber = createClient(options);

    for (const [name, c] of [["client", client], ["subscriber", subscriber]]) {
      let lastError = "";
      c.on("ready", () => {
        lastError = "";
        log.info("redis connected", { client: name });
      });
      c.on("error", (err) => {
        if (err.message === lastError) return; // reconnect loops repeat the same error every few seconds
        lastError = err.message;
        log.warn("redis error", { client: name, error: err.message });
      });
      c.connect().catch(() => {});
    }
  }

  const starting = url
    ? start().catch((err) => log.error("could not start redis client", { error: err.message }))
    : Promise.resolve();

  return {
    enabled: Boolean(url),
    starting,
    // null while disconnected, so callers can do `if (redis.client)` and fall back otherwise.
    get client() {
      return client?.isReady ? client : null;
    },
    get subscriber() {
      return subscriber;
    },
    ready: () => Boolean(client?.isReady && subscriber?.isReady),
    async close() {
      await starting; // the clients may not exist yet if close() runs right after startup
      await Promise.all([client, subscriber].filter(Boolean).map((c) => c.disconnect().catch(() => {})));
    },
  };
}
