export function validatePollInput(body) {
  const errors = [];

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (question.length < 3 || question.length > 200) {
    errors.push("question must be 3-200 characters");
  }

  const raw = Array.isArray(body?.options) ? body.options : [];
  const options = raw
    .filter((o) => typeof o === "string")
    .map((o) => o.trim())
    .filter(Boolean);

  if (options.length < 2 || options.length > 10) {
    errors.push("between 2 and 10 options are required");
  }
  if (options.some((o) => o.length > 100)) {
    errors.push("options must be at most 100 characters");
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    errors.push("options must be unique");
  }

  if (body?.allowMultiple !== undefined && typeof body.allowMultiple !== "boolean") {
    errors.push("allowMultiple must be a boolean");
  }

  // Optional auto-close, from 1 minute up to 30 days.
  let closesInMinutes = null;
  if (body?.closesInMinutes !== undefined && body.closesInMinutes !== null) {
    closesInMinutes = body.closesInMinutes;
    if (!Number.isInteger(closesInMinutes) || closesInMinutes < 1 || closesInMinutes > MAX_CLOSE_MINUTES) {
      errors.push(`closesInMinutes must be an integer between 1 and ${MAX_CLOSE_MINUTES}`);
    }
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { question, options, allowMultiple: body.allowMultiple === true, closesInMinutes } };
}

const MAX_CLOSE_MINUTES = 30 * 24 * 60;

// Accepts { optionId: 3 } or { optionIds: [3, 4] } and returns unique ids, or null if invalid.
export function parseOptionIds(body) {
  const raw = Array.isArray(body?.optionIds) ? body.optionIds : [body?.optionId];
  if (raw.length === 0 || raw.length > 10) return null;
  const ids = raw.map(parseId);
  if (ids.some((id) => id === null)) return null;
  return [...new Set(ids)];
}

// The browser sends a random id so the API can enforce one vote per person (per browser).
export function parseVoterId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

export function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
}
