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

  return errors.length ? { ok: false, errors } : { ok: true, value: { question, options } };
}

export function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
}
