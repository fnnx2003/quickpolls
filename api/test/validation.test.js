import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePollInput, parseId } from "../src/validation.js";

test("accepts a valid poll and trims input", () => {
  const r = validatePollInput({ question: "  Tabs or spaces? ", options: [" Tabs", "Spaces "] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { question: "Tabs or spaces?", options: ["Tabs", "Spaces"] });
});

test("rejects a short question", () => {
  const r = validatePollInput({ question: "?", options: ["a", "b"] });
  assert.equal(r.ok, false);
});

test("rejects fewer than 2 options", () => {
  const r = validatePollInput({ question: "Valid question", options: ["only one", "  "] });
  assert.equal(r.ok, false);
});

test("rejects duplicate options case-insensitively", () => {
  const r = validatePollInput({ question: "Valid question", options: ["Yes", "yes"] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("options must be unique"));
});

test("rejects a missing body", () => {
  assert.equal(validatePollInput(undefined).ok, false);
});

test("parseId", () => {
  assert.equal(parseId("42"), 42);
  assert.equal(parseId(7), 7);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("1.5"), null);
  assert.equal(parseId("abc"), null);
  assert.equal(parseId(undefined), null);
});
