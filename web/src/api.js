const config = window.__APP_CONFIG__ ?? {};
const BASE = (config.apiBaseUrl ?? "").replace(/\/$/, "");

// Random per-browser id so the API can allow one vote per person.
// Uses getRandomValues (not randomUUID) because randomUUID needs HTTPS outside localhost.
function loadVoterId() {
  try {
    let id = localStorage.getItem("quickpolls.voterId");
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("quickpolls.voterId", id);
    }
    return id;
  } catch {
    return null; // storage blocked: votes are sent anonymously
  }
}
const voterId = loadVoterId();

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(voterId && { "X-Voter-Id": voterId }) },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.errors?.join(", ") || `Request failed (${res.status})`);
  return body;
}

export const api = {
  info: () => request("/api/info"),
  stats: () => request("/api/stats"),
  listPolls: ({ search = "", sort = "newest", status = "all" } = {}) =>
    request(`/api/polls?${new URLSearchParams({ search, sort, status })}`),
  getPoll: (id) => request(`/api/polls/${id}`),
  createPoll: (poll) => request("/api/polls", { method: "POST", body: JSON.stringify(poll) }),
  vote: (pollId, optionIds) =>
    request(`/api/polls/${pollId}/vote`, { method: "POST", body: JSON.stringify({ optionIds }) }),
  closePoll: (id) => request(`/api/polls/${id}/close`, { method: "POST" }),
  deletePoll: (id) => request(`/api/polls/${id}`, { method: "DELETE" }),
};

export const environment = config.environment ?? "unknown";
