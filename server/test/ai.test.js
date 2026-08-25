import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInsightResult } from "../src/ai.js";

test("normalizes structured AI insight output", () => {
  const result = normalizeInsightResult({
    summary: "Customer reported repeated delivery delays.",
    sentiment: "NEGATIVE",
    priority: "HIGH",
    category: "Delivery experience",
    key_topics: ["late delivery", "communication"],
    recommended_action: "Escalate to the logistics team."
  });

  assert.equal(result.sentiment, "negative");
  assert.equal(result.priority, "high");
  assert.deepEqual(result.keyTopics, ["late delivery", "communication"]);
});

test("falls back safely when model enums are unexpected", () => {
  const result = normalizeInsightResult({
    summary: "Short response",
    sentiment: "confused",
    priority: "critical",
    key_topics: "not-an-array"
  });

  assert.equal(result.sentiment, "neutral");
  assert.equal(result.priority, "medium");
  assert.deepEqual(result.keyTopics, []);
});

test("handles a non-object model response without crashing", () => {
  const result = normalizeInsightResult(null);

  assert.equal(result.summary, "No summary generated.");
  assert.equal(result.category, "General");
  assert.equal(result.recommendedAction, "Review the response.");
});
