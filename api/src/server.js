import pg from "pg";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createMetrics } from "./metrics.js";
import { migrateWithRetry } from "./migrate.js";
import { log } from "./logger.js";

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on("error", (err) => log.error("postgres pool error", { error: err.message }));

if (config.runMigrations) {
  try {
    await migrateWithRetry(pool);
  } catch (err) {
    log.error("could not reach database, exiting", { error: err.message });
    process.exit(1);
  }
}

const app = createApp({ pool, config, metrics: createMetrics() });
const server = app.listen(config.port, () => {
  log.info("api listening", { port: config.port, version: config.appVersion });
});

// Graceful shutdown: Kubernetes sends SIGTERM, we stop accepting connections,
// finish in-flight requests, close the DB pool, then exit.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  setTimeout(() => {
    log.error("forced shutdown after timeout");
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();
  server.close(async () => {
    await pool.end().catch(() => {});
    log.info("shutdown complete");
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
