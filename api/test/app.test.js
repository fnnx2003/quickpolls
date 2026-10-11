// HTTP tests against the real Express app with a fake database: no Postgres needed,
// so these run anywhere (perfect for a CI "test" stage).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createMetrics } from "../src/metrics.js";

let dbUp = true;
const fakePool = {
  async query(sql) {
    if (!dbUp) throw new Error("connection refused");
    if (sql.includes("FROM polls p") && sql.includes("LIMIT 50")) {
      return { rows: [{ id: 1, question: "Q?", created_at: "2026-01-01", option_count: 2, total_votes: 3 }] };
    }
    return { rows: [], rowCount: 0 };
  },
};

let server;
let base;

before(async () => {
  const app = createApp({
    pool: fakePool,
    config: { appVersion: "test", corsOrigin: "", enableChaos: false },
    metrics: createMetrics(),
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("GET /healthz returns ok", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("GET /readyz reflects database state", async () => {
  dbUp = true;
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  dbUp = false;
  assert.equal((await fetch(`${base}/readyz`)).status, 503);
  dbUp = true;
});

test("GET /api/info returns the version", async () => {
  const body = await (await fetch(`${base}/api/info`)).json();
  assert.equal(body.version, "test");
  assert.ok(body.hostname);
});

test("GET /api/polls lists polls", async () => {
  const body = await (await fetch(`${base}/api/polls`)).json();
  assert.equal(body.length, 1);
  assert.equal(body[0].totalVotes, 3);
});

test("POST /api/polls validates input", async () => {
  const res = await fetch(`${base}/api/polls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "x", options: [] }),
  });
  assert.equal(res.status, 400);
});

test("POST /api/polls rejects malformed JSON", async () => {
  const res = await fetch(`${base}/api/polls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
});

test("GET /api/polls/:id returns 404 for unknown poll", async () => {
  assert.equal((await fetch(`${base}/api/polls/999`)).status, 404);
});

test("chaos endpoints are disabled by default", async () => {
  assert.equal((await fetch(`${base}/api/chaos/crash`, { method: "POST" })).status, 404);
});

test("GET /metrics exposes Prometheus metrics", async () => {
  const text = await (await fetch(`${base}/metrics`)).text();
  assert.match(text, /http_request_duration_seconds/);
});
