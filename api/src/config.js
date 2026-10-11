// All configuration comes from environment variables (12-factor style),
// so the same image can run in dev, staging and prod.

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function databaseUrl(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  // If PGHOST/PGUSER/PGPASSWORD/PGDATABASE are set, let the pg driver read them.
  if (env.PGHOST) return undefined;
  return "postgres://polls:polls@localhost:5432/polls";
}

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: databaseUrl(env),
    appVersion: env.APP_VERSION ?? "dev",
    corsOrigin: env.CORS_ORIGIN ?? "",
    runMigrations: bool(env.RUN_MIGRATIONS, true),
    enableChaos: bool(env.ENABLE_CHAOS, false),
    shutdownTimeoutMs: Number(env.SHUTDOWN_TIMEOUT_MS ?? 10000),
  };
}
