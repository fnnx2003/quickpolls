export function percent(votes, total) {
  if (!total) return 0;
  return Math.round((votes / total) * 100);
}

export function cleanOptions(options) {
  return options.map((o) => o.trim()).filter(Boolean);
}

export function timeAgo(date, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// "in 5m", "in 3h", "in 2d" for a future date; null if it's already past.
export function timeLeft(date, now = Date.now()) {
  const seconds = Math.round((new Date(date).getTime() - now) / 1000);
  if (seconds <= 0) return null;
  if (seconds < 60) return "in <1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

// Index of the option(s) with the most votes, empty if nobody voted yet.
export function leaders(options) {
  const max = Math.max(0, ...options.map((o) => o.votes));
  return max === 0 ? [] : options.filter((o) => o.votes === max).map((o) => o.id);
}

// "#/poll/12" -> 12
export function pollIdFromHash(hash) {
  const m = /^#\/poll\/(\d+)$/.exec(hash);
  return m ? Number(m[1]) : null;
}

// "#/cluster" -> "cluster", anything else -> "polls"
export function pageFromHash(hash) {
  return hash === "#/cluster" ? "cluster" : "polls";
}

// CI tags images with the full git SHA; 7 characters are enough to tell versions apart.
export function shortVersion(version) {
  return /^[0-9a-f]{40}$/.test(version) ? version.slice(0, 7) : version;
}

// 75000 -> "1m 15s", 93784000 -> "1d 2h"
export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Replicas heartbeat every 5s; missing two in a row means the process is stuck or gone (crash, OOMKill).
const STALE_MS = 12000;

export function replicaHealth(replica, now) {
  if (now - new Date(replica.lastSeen).getTime() > STALE_MS) return "not-responding";
  if (replica.status === "shutting-down") return "shutting-down";
  if (replica.db === "down") return "db-down";
  return "ready";
}

// [{ version, count }], most common first. More than one entry = a rolling update in progress.
export function versionSummary(replicas) {
  const counts = new Map();
  for (const r of replicas) counts.set(r.version, (counts.get(r.version) ?? 0) + 1);
  return [...counts].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count);
}
