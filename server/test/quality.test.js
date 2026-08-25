import test from "node:test";
import assert from "node:assert/strict";
import { assessAudioQuality } from "../src/quality.js";

test("marks a healthy recording as ready", () => {
  const result = assessAudioQuality({
    durationSeconds: 42,
    sampleRateHz: 48000,
    bitrateKbps: 128,
    loudnessDb: -18
  });

  assert.equal(result.score, 100);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.issues, []);
});

test("flags low-quality audio for re-recording", () => {
  const result = assessAudioQuality({
    durationSeconds: 1,
    sampleRateHz: 8000,
    bitrateKbps: 16,
    loudnessDb: -50
  });

  assert.equal(result.score, 0);
  assert.equal(result.status, "re-record");
  assert.equal(result.issues.length, 4);
});

test("routes borderline audio to manual review", () => {
  const result = assessAudioQuality({
    durationSeconds: 12,
    sampleRateHz: 16000,
    bitrateKbps: 20,
    loudnessDb: -45
  });

  assert.equal(result.score, 50);
  assert.equal(result.status, "review");
});
