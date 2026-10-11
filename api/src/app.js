import express from "express";
import os from "node:os";
import { validatePollInput, parseId } from "./validation.js";
import { log } from "./logger.js";

const startedAt = Date.now();

// Dependencies are injected so tests can pass fakes instead of a real database.
export function createApp({ pool, config, metrics }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use(metrics.middleware);

  // Access log (skips probe/metrics noise).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (["/healthz", "/readyz", "/metrics"].includes(req.path)) return;
      log.info("request", { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
    });
    next();
  });

  if (config.corsOrigin) {
    app.use((req, res, next) => {
      res.set("Access-Control-Allow-Origin", config.corsOrigin);
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }

  // ---- Operational endpoints ----------------------------------------------

  // Liveness: is the process alive? Never touches dependencies.
  let unhealthy = false; // flipped by the chaos endpoint below
  app.get("/healthz", (req, res) => {
    if (unhealthy) return res.status(500).json({ status: "unhealthy" });
    res.json({ status: "ok" });
  });

  // Readiness: can this instance serve traffic right now?
  app.get("/readyz", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ready", checks: { postgres: "ok" } });
    } catch (err) {
      res.status(503).json({ status: "not ready", checks: { postgres: err.message } });
    }
  });

  app.get("/metrics", metrics.handler);

  // Shows which instance answered: useful to watch load balancing and rolling updates.
  app.get("/api/info", (req, res) => {
    res.json({
      service: "quickpolls-api",
      version: config.appVersion,
      hostname: os.hostname(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      node: process.version,
    });
  });

  // ---- Polls ----------------------------------------------------------------

  app.get("/api/polls", async (req, res) => {
    const { rows } = await pool.query(`
      SELECT p.id, p.question, p.created_at,
             COUNT(o.id)::int AS option_count,
             COALESCE(SUM(o.votes), 0)::int AS total_votes
      FROM polls p
      LEFT JOIN options o ON o.poll_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 50`);
    res.json(
      rows.map((r) => ({
        id: r.id,
        question: r.question,
        createdAt: r.created_at,
        optionCount: r.option_count,
        totalVotes: r.total_votes,
      })),
    );
  });

  app.post("/api/polls", async (req, res) => {
    const result = validatePollInput(req.body);
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    const { question, options } = result.value;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("INSERT INTO polls (question) VALUES ($1) RETURNING id", [question]);
      const pollId = rows[0].id;
      for (const [i, label] of options.entries()) {
        await client.query("INSERT INTO options (poll_id, position, label) VALUES ($1, $2, $3)", [pollId, i, label]);
      }
      await client.query("COMMIT");
      metrics.pollsCreated.inc();
      res.status(201).json(await loadPoll(pollId));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/polls/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ errors: ["invalid poll id"] });
    const poll = await loadPoll(id);
    if (!poll) return res.status(404).json({ errors: ["poll not found"] });
    res.json(poll);
  });

  app.post("/api/polls/:id/vote", async (req, res) => {
    const pollId = parseId(req.params.id);
    const optionId = parseId(req.body?.optionId);
    if (!pollId || !optionId) return res.status(400).json({ errors: ["invalid poll id or optionId"] });

    const { rowCount } = await pool.query(
      "UPDATE options SET votes = votes + 1 WHERE id = $1 AND poll_id = $2",
      [optionId, pollId],
    );
    if (rowCount === 0) return res.status(404).json({ errors: ["option not found for this poll"] });

    metrics.votesCast.inc();
    res.json(await loadPoll(pollId));
  });

  app.delete("/api/polls/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ errors: ["invalid poll id"] });
    const { rowCount } = await pool.query("DELETE FROM polls WHERE id = $1", [id]);
    if (rowCount === 0) return res.status(404).json({ errors: ["poll not found"] });
    res.sendStatus(204);
  });

  // ---- Chaos endpoints (off by default, set ENABLE_CHAOS=true) --------------
  // Use them to watch Kubernetes react: restarts, OOMKills, autoscaling.

  if (config.enableChaos) {
    const leaked = [];

    // Burns CPU for N seconds without blocking the event loop -> trigger an HPA scale-up.
    app.post("/api/chaos/cpu", (req, res) => {
      const seconds = Math.min(Number(req.query.seconds) || 10, 120);
      const until = Date.now() + seconds * 1000;
      const burn = () => {
        const sliceEnd = Date.now() + 50;
        while (Date.now() < sliceEnd) Math.sqrt(Math.random());
        if (Date.now() < until) setImmediate(burn);
      };
      burn();
      log.warn("chaos: burning cpu", { seconds });
      res.status(202).json({ status: "burning cpu", seconds });
    });

    // Allocates and keeps memory -> hit the memory limit and get OOMKilled.
    app.post("/api/chaos/memory", (req, res) => {
      const mb = Math.min(Number(req.query.mb) || 50, 2048);
      leaked.push(Buffer.alloc(mb * 1024 * 1024, 1));
      const totalMb = leaked.reduce((s, b) => s + b.length, 0) / 1024 / 1024;
      log.warn("chaos: leaked memory", { mb, totalMb });
      res.json({ status: "leaked", mb, totalMb });
    });

    // Crashes the process -> watch the restart count / CrashLoopBackOff.
    app.post("/api/chaos/crash", (req, res) => {
      log.error("chaos: crashing on purpose");
      res.status(202).json({ status: "crashing" });
      setTimeout(() => process.exit(1), 100);
    });

    // Makes this instance fail liveness -> Kubernetes should restart it.
    app.post("/api/chaos/unhealthy", (req, res) => {
      unhealthy = true;
      log.warn("chaos: liveness will now fail");
      res.status(202).json({ status: "liveness probe will fail" });
    });
  }

  app.use((req, res) => res.status(404).json({ errors: ["not found"] }));

  // Express 5 forwards rejected promises from async handlers here.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ errors: ["invalid JSON body"] });
    log.error("unhandled error", { error: err.message, path: req.path });
    res.status(500).json({ errors: ["internal server error"] });
  });

  async function loadPoll(id) {
    const { rows } = await pool.query(
      `SELECT p.id, p.question, p.created_at, o.id AS option_id, o.label, o.votes
       FROM polls p
       JOIN options o ON o.poll_id = p.id
       WHERE p.id = $1
       ORDER BY o.position`,
      [id],
    );
    if (rows.length === 0) return null;
    const options = rows.map((r) => ({ id: r.option_id, label: r.label, votes: r.votes }));
    return {
      id: rows[0].id,
      question: rows[0].question,
      createdAt: rows[0].created_at,
      options,
      totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
    };
  }

  return app;
}
