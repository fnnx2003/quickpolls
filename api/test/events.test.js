import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../src/events.js";
import { createRedis } from "../src/redis.js";

test("local bus delivers events to subscribers until they unsubscribe", async () => {
  const bus = createEventBus();
  assert.equal(bus.mode, "local");
  const received = [];
  const unsubscribe = bus.subscribe((e) => received.push(e));

  await bus.publish("poll.created", 1);
  unsubscribe();
  await bus.publish("poll.created", 2);

  assert.equal(received.length, 1);
  assert.equal(received[0].type, "poll.created");
  assert.equal(received[0].pollId, 1);
  assert.ok(received[0].from);
});

test("redis bus falls back to local delivery while redis is unreachable", async () => {
  const redis = createRedis("redis://127.0.0.1:1");
  const bus = createEventBus({ redis });
  assert.equal(bus.mode, "redis");
  const received = [];
  bus.subscribe((e) => received.push(e));

  await bus.publish("poll.voted", 3);

  assert.equal(bus.redisReady(), false);
  assert.deepEqual(received.map((e) => e.pollId), [3]);
  await redis.close();
});
