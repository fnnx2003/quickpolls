import express from "express";
import os from "node:os";
import { validatePollInput, parseId, parseOptionIds, parseVoterId } from "./validation.js";
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
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Voter-Id");
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

  const SORTS = {
    newest: "p.created_at DESC",
    oldest: "p.created_at ASC",
    popular: "total_votes DESC, p.created_at DESC",
  };

  app.get("/api/polls", async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const orderBy = SORTS[req.query.sort] ?? SORTS.newest;
    const status = ["open", "closed"].includes(req.query.status) ? req.query.status : "all";

    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      where.push(`p.question ILIKE $${params.length}`);
    }
    if (status === "open") where.push("(p.closes_at IS NULL OR p.closes_at > now())");
    if (status === "closed") where.push("p.closes_at <= now()");

    const { rows } = await pool.query(
      `
      SELECT p.id, p.question, p.created_at, p.allow_multiple, p.closes_at,
             (p.closes_at IS NOT NULL AND p.closes_at <= now()) AS closed,
             COUNT(o.id)::int AS option_count,
             COALESCE(SUM(o.votes), 0)::int AS total_votes
      FROM polls p
      LEFT JOIN options o ON o.poll_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY p.id
      ORDER BY ${orderBy}
      LIMIT 50`,
      params,
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        question: r.question,
        createdAt: r.created_at,
        allowMultiple: r.allow_multiple ?? false,
        closesAt: r.closes_at ?? null,
        closed: r.closed ?? false,
        optionCount: r.option_count,
        totalVotes: r.total_votes,
      })),
    );
  });

  app.get("/api/stats", async (req, res) => {
    const { rows } = await pool.query(`
      SELECT (SELECT COUNT(*) FROM polls)::int AS polls,
             (SELECT COUNT(*) FROM polls WHERE closes_at IS NULL OR closes_at > now())::int AS open_polls,
             (SELECT COALESCE(SUM(votes), 0) FROM options)::int AS votes`);
    const r = rows[0] ?? {};
    res.json({ polls: r.polls ?? 0, openPolls: r.open_polls ?? 0, votes: r.votes ?? 0 });
  });

  app.post("/api/polls", async (req, res) => {
    const result = validatePollInput(req.body);
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    const { question, options, allowMultiple, closesInMinutes } = result.value;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO polls (question, allow_multiple, closes_at)
         VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(mins => $3::int) END)
         RETURNING id`,
        [question, allowMultiple, closesInMinutes],
      );
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
    const poll = await loadPoll(id, parseVoterId(req.get("X-Voter-Id")));
    if (!poll) return res.status(404).json({ errors: ["poll not found"] });
    res.json(poll);
  });

  app.post("/api/polls/:id/vote", async (req, res) => {
    const pollId = parseId(req.params.id);
    const optionIds = parseOptionIds(req.body);
    if (!pollId || !optionIds) return res.status(400).json({ errors: ["invalid poll id or optionId"] });
    // Without a voter id (e.g. curl) votes are anonymous and unlimited, like before.
    const voterId = parseVoterId(req.get("X-Voter-Id"));

    const client = await pool.connect();
    let committed = false;
    const fail = (status, message) => res.status(status).json({ errors: [message] });
    try {
      await client.query("BEGIN");
      const { rows: polls } = await client.query(
        `SELECT allow_multiple, (closes_at IS NOT NULL AND closes_at <= now()) AS closed
         FROM polls WHERE id = $1`,
        [pollId],
      );
      if (polls.length === 0) return fail(404, "poll not found");
      const { allow_multiple: allowMultiple, closed } = polls[0];
      if (closed) return fail(409, "this poll is closed");
      if (!allowMultiple && optionIds.length > 1) return fail(400, "this poll allows only one choice");

      const { rows: found } = await client.query(
        "SELECT id FROM options WHERE poll_id = $1 AND id = ANY($2::int[])",
        [pollId, optionIds],
      );
      if (found.length !== optionIds.length) return fail(404, "option not found for this poll");

      let newIds = optionIds;
      if (voterId) {
        // Serialize concurrent requests from the same voter on the same poll.
        await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [pollId, voterId]);
        const { rows: existing } = await client.query(
          "SELECT option_id FROM poll_votes WHERE poll_id = $1 AND voter_id = $2",
          [pollId, voterId],
        );
        const already = new Set(existing.map((r) => r.option_id));
        if (!allowMultiple && already.size > 0) return fail(409, "you already voted on this poll");
        newIds = optionIds.filter((id) => !already.has(id));
        if (newIds.length === 0) return fail(409, "you already voted for that option");
        await client.query(
          `INSERT INTO poll_votes (poll_id, option_id, voter_id)
           SELECT $1, unnest($2::int[]), $3`,
          [pollId, newIds, voterId],
        );
      }

      await client.query("UPDATE options SET votes = votes + 1 WHERE id = ANY($1::int[])", [newIds]);
      await client.query("COMMIT");
      committed = true;
      metrics.votesCast.inc(newIds.length);
    } finally {
      if (!committed) await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    res.json(await loadPoll(pollId, voterId));
  });

  // Closes a poll right now (no more votes). Results stay visible.
  app.post("/api/polls/:id/close", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ errors: ["invalid poll id"] });
    const { rowCount } = await pool.query(
      "UPDATE polls SET closes_at = LEAST(COALESCE(closes_at, now()), now()) WHERE id = $1",
      [id],
    );
    if (rowCount === 0) return res.status(404).json({ errors: ["poll not found"] });
    res.json(await loadPoll(id, parseVoterId(req.get("X-Voter-Id"))));
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

  async function loadPoll(id, voterId = null) {
    const { rows } = await pool.query(
      `SELECT p.id, p.question, p.created_at, p.allow_multiple, p.closes_at,
              (p.closes_at IS NOT NULL AND p.closes_at <= now()) AS closed,
              o.id AS option_id, o.label, o.votes
       FROM polls p
       JOIN options o ON o.poll_id = p.id
       WHERE p.id = $1
       ORDER BY o.position`,
      [id],
    );
    if (rows.length === 0) return null;
    const options = rows.map((r) => ({ id: r.option_id, label: r.label, votes: r.votes }));

    let myVotes = [];
    if (voterId) {
      const mine = await pool.query("SELECT option_id FROM poll_votes WHERE poll_id = $1 AND voter_id = $2", [
        id,
        voterId,
      ]);
      myVotes = mine.rows.map((r) => r.option_id);
    }

    return {
      id: rows[0].id,
      question: rows[0].question,
      createdAt: rows[0].created_at,
      allowMultiple: rows[0].allow_multiple,
      closesAt: rows[0].closes_at,
      closed: rows[0].closed,
      options,
      totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
      myVotes,
    };
  }

  return app;
}
