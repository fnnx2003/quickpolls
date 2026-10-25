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
