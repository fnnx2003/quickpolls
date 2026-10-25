import pg from "pg";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (
  id          SERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS options (
  id        SERIAL PRIMARY KEY,
  poll_id   INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  label     TEXT NOT NULL,
  votes     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS options_poll_id_idx ON options(poll_id);

-- Added later: every statement is idempotent so existing databases upgrade in place.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS allow_multiple BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;

-- One row per (voter, option): stops the same browser from voting twice.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  voter_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, voter_id, option_id)
);
`;

// Arbitrary constant: several API replicas may start at once, the lock makes them migrate one at a time.
const MIGRATION_LOCK_ID = 727274;

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(SCHEMA);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

export async function migrateWithRetry(pool, { attempts = 10, delayMs = 3000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await migrate(pool);
      log.info("migrations applied");
      return;
    } catch (err) {
      log.warn("migration failed, retrying", { attempt: i, attempts, error: err.message });
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Run standalone: `npm run migrate` (handy for a Kubernetes Job or initContainer).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new pg.Pool({ connectionString: loadConfig().databaseUrl });
  migrateWithRetry(pool)
    .then(() => pool.end())
    .catch((err) => {
      log.error("migration failed", { error: err.message });
      process.exit(1);
    });
}
