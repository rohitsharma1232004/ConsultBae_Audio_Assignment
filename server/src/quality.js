const RULES = {
  minDurationSeconds: 2,
  minSampleRateHz: 16000,
  minBitrateKbps: 32,
  minLoudnessDb: -35,
  maxLoudnessDb: -8
};

export function assessAudioQuality(metadata) {
  const checks = [
    {
      passed: Number(metadata.durationSeconds) >= RULES.minDurationSeconds,
      issue: "Recording is shorter than 2 seconds"
    },
    {
      passed: Number(metadata.sampleRateHz) >= RULES.minSampleRateHz,
      issue: "Sample rate is below 16 kHz"
    },
    {
      passed: Number(metadata.bitrateKbps) >= RULES.minBitrateKbps,
      issue: "Bitrate is below 32 kbps"
    },
    {
      passed:
        Number(metadata.loudnessDb) >= RULES.minLoudnessDb &&
        Number(metadata.loudnessDb) <= RULES.maxLoudnessDb,
      issue: "Loudness is outside the recommended range"
    }
  ];

  const passedChecks = checks.filter(check => check.passed).length;
  const score = passedChecks * 25;
  const status = score >= 75 ? "ready" : score >= 50 ? "review" : "re-record";

  return {
    score,
    status,
    issues: checks.filter(check => !check.passed).map(check => check.issue)
  };
}

export const qualityRules = RULES;
