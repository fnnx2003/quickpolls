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
