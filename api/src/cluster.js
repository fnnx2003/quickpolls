import os from "node:os";
import { log } from "./logger.js";

const PREFIX = "quickpolls:replica:";
const HEARTBEAT_MS = 5000;
// A replica that stops heartbeating (crash, OOMKill, kill -9) disappears from Redis after this.
// Graceful shutdowns remove themselves right away.
const TTL_SECONDS = 15;

// Every API replica writes a small "I'm alive" record to Redis every few seconds, so
// GET /api/cluster can list all replicas, whichever one answers. Without Redis it can only
// describe itself: the same per-replica blind spot as live updates.
export function createCluster({ redis = null, pool, config, events }) {
  const hostname = os.hostname();
  const startedAt = new Date().toISOString();
  const key = PREFIX + hostname;
  let status = "ready";
  let db = "unknown";
  let cpuPercent = 0;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = performance.now();
  let timer = null;

  function snapshot() {
    return {
      hostname,
      version: config.appVersion,
      node: process.version,
      startedAt,
      lastSeen: new Date().toISOString(),
      status,
      db,
      liveConnections: events?.listenerCount() ?? 0,
      cpuPercent,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  // CPU used since the previous heartbeat, as % of one core (a k8s CPU limit of "1" = 100%).
  function sampleCpu() {
    const now = performance.now();
    const used = process.cpuUsage(lastCpu);
    cpuPercent = Math.round(((used.user + used.system) / 1000 / (now - lastCpuAt)) * 100);
    lastCpu = process.cpuUsage();
    lastCpuAt = now;
  }

  async function heartbeat() {
    sampleCpu();
    try {
      await pool.query("SELECT 1");
      db = "ok";
    } catch {
      db = "down";
    }
    await redis?.client?.set(key, JSON.stringify(snapshot()), { EX: TTL_SECONDS }).catch((err) => {
      log.warn("cluster heartbeat failed", { error: err.message });
    });
  }

  return {
    start() {
      heartbeat();
      timer = setInterval(heartbeat, HEARTBEAT_MS);
      timer.unref();
    },

    // Called first thing on SIGTERM, so the page shows this replica draining before it disappears.
    async markShuttingDown() {
      status = "shutting-down";
      await redis?.client?.set(key, JSON.stringify(snapshot()), { EX: TTL_SECONDS }).catch(() => {});
    },

    async leave() {
      clearInterval(timer);
      await redis?.client?.del(key).catch(() => {});
    },

    async list() {
      const self = snapshot();
      const client = redis?.client;
      if (!client) return { mode: redis?.enabled ? "redis-down" : "local", replicas: [self] };

      const keys = [];
      for await (const k of client.scanIterator({ MATCH: `${PREFIX}*`, COUNT: 100 })) keys.push(k);
      const values = keys.length ? await client.mGet(keys) : [];
      const replicas = values.filter(Boolean).flatMap((v) => {
        try {
          return [JSON.parse(v)];
        } catch {
          return [];
        }
      });
      // Use our own fresh numbers (and show up even before our first heartbeat lands).
      const others = replicas.filter((r) => r.hostname !== hostname);
      return {
        mode: "redis",
        replicas: [...others, self].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      };
    },
  };
}
