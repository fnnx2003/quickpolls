import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { createCluster } from "../src/cluster.js";

const pool = { query: async () => ({ rows: [] }) };
const config = { appVersion: "test" };

// Just enough of a node-redis client for the cluster registry.
function fakeRedis() {
  const store = new Map();
  const client = {
    async set(key, value) {
      store.set(key, value);
    },
    async del(key) {
      store.delete(key);
    },
    async mGet(keys) {
      return keys.map((k) => store.get(k) ?? null);
    },
    async *scanIterator({ MATCH }) {
      const prefix = MATCH.replace("*", "");
      for (const k of store.keys()) if (k.startsWith(prefix)) yield k;
    },
  };
  return { enabled: true, client, store };
}

test("without redis, the cluster only knows about itself", async () => {
  const cluster = createCluster({ pool, config });
  const { mode, replicas } = await cluster.list();
  assert.equal(mode, "local");
  assert.equal(replicas.length, 1);
  assert.equal(replicas[0].hostname, os.hostname());
  assert.equal(replicas[0].version, "test");
});

test("redis down is reported separately from redis not configured", async () => {
  const cluster = createCluster({ redis: { enabled: true, client: null }, pool, config });
  assert.equal((await cluster.list()).mode, "redis-down");
});

test("with redis, replicas see each other and leave cleanly", async () => {
  const redis = fakeRedis();
  redis.store.set(
    "quickpolls:replica:other-pod",
    JSON.stringify({ hostname: "other-pod", startedAt: "2000-01-01T00:00:00Z", status: "ready" }),
  );
  redis.store.set("quickpolls:replica:broken", "{not json");

  const cluster = createCluster({ redis, pool, config });
  await cluster.markShuttingDown();
  const { mode, replicas } = await cluster.list();
  assert.equal(mode, "redis");
  assert.deepEqual(
    replicas.map((r) => r.hostname),
    ["other-pod", os.hostname()],
    "sorted by start time, malformed records skipped",
  );
  assert.equal(replicas[1].status, "shutting-down");

  await cluster.leave();
  assert.equal(redis.store.has(`quickpolls:replica:${os.hostname()}`), false);
});
