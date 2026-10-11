const config = window.__APP_CONFIG__ ?? {};
const BASE = (config.apiBaseUrl ?? "").replace(/\/$/, "");

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.errors?.join(", ") || `Request failed (${res.status})`);
  return body;
}

export const api = {
  info: () => request("/api/info"),
  listPolls: () => request("/api/polls"),
  getPoll: (id) => request(`/api/polls/${id}`),
  createPoll: (question, options) =>
    request("/api/polls", { method: "POST", body: JSON.stringify({ question, options }) }),
  vote: (pollId, optionId) =>
    request(`/api/polls/${pollId}/vote`, { method: "POST", body: JSON.stringify({ optionId }) }),
  deletePoll: (id) => request(`/api/polls/${id}`, { method: "DELETE" }),
};

export const environment = config.environment ?? "unknown";
