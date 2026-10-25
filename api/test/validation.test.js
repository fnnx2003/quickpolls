import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePollInput, parseId, parseOptionIds, parseVoterId } from "../src/validation.js";

test("accepts a valid poll and trims input", () => {
  const r = validatePollInput({ question: "  Tabs or spaces? ", options: [" Tabs", "Spaces "] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    question: "Tabs or spaces?",
    options: ["Tabs", "Spaces"],
    allowMultiple: false,
    closesInMinutes: null,
  });
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

test("accepts poll settings", () => {
  const r = validatePollInput({ question: "Pick toppings", options: ["a", "b"], allowMultiple: true, closesInMinutes: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.value.allowMultiple, true);
  assert.equal(r.value.closesInMinutes, 60);
});

test("rejects invalid poll settings", () => {
  const base = { question: "Valid question", options: ["a", "b"] };
  assert.equal(validatePollInput({ ...base, allowMultiple: "yes" }).ok, false);
  assert.equal(validatePollInput({ ...base, closesInMinutes: 0 }).ok, false);
  assert.equal(validatePollInput({ ...base, closesInMinutes: 1.5 }).ok, false);
  assert.equal(validatePollInput({ ...base, closesInMinutes: 60 * 24 * 31 }).ok, false);
});

test("parseOptionIds", () => {
  assert.deepEqual(parseOptionIds({ optionId: 3 }), [3]);
  assert.deepEqual(parseOptionIds({ optionIds: [3, "4", 3] }), [3, 4]);
  assert.equal(parseOptionIds({ optionIds: [] }), null);
  assert.equal(parseOptionIds({ optionIds: [1, "x"] }), null);
  assert.equal(parseOptionIds({}), null);
});

test("parseVoterId", () => {
  assert.equal(parseVoterId("a1b2c3d4e5f6"), "a1b2c3d4e5f6");
  assert.equal(parseVoterId("short"), null);
  assert.equal(parseVoterId("has spaces in it"), null);
  assert.equal(parseVoterId(undefined), null);
});
