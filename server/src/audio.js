import fs from "node:fs";
import { spawn } from "node:child_process";
import ffprobeStatic from "ffprobe-static";
import ffmpegPath from "ffmpeg-static";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-3000)}`));
    });
  });
}

export async function extractAudioMetadata(filePath) {
  const probe = await run(ffprobeStatic.path, [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,bit_rate,duration:format=duration,bit_rate",
    "-of", "json",
    filePath
  ]);

  const parsed = JSON.parse(probe.stdout);
  const stream = parsed.streams?.[0] ?? {};
  const format = parsed.format ?? {};

  const duration = Number(stream.duration ?? format.duration);
  const sampleRateHz = Number(stream.sample_rate);
  const streamBitrate = Number(stream.bit_rate);
  const formatBitrate = Number(format.bit_rate);

  let bitrateBps = Number.isFinite(streamBitrate) && streamBitrate > 0
    ? streamBitrate
    : (Number.isFinite(formatBitrate) && formatBitrate > 0 ? formatBitrate : null);

  if (!bitrateBps && Number.isFinite(duration) && duration > 0) {
    const bytes = fs.statSync(filePath).size;
    bitrateBps = (bytes * 8) / duration;
  }

  let loudnessDb = null;

  try {
    const loudness = await run(ffmpegPath, [
      "-hide_banner",
      "-nostats",
      "-i", filePath,
      "-af", "loudnorm=I=-16:print_format=json",
      "-f", "null",
      "-"
    ]);

    const combinedOutput = `${loudness.stdout || ""}\n${loudness.stderr || ""}`;
    const jsonMatch = combinedOutput.match(/\{[\s\S]*?"input_i"\s*:\s*[-+\d.]+[\s\S]*?\}/);

    if (jsonMatch) {
      const loudnessJson = JSON.parse(jsonMatch[0]);
      loudnessDb = Number(loudnessJson.input_i);
    }
  } catch (_error) {
    loudnessDb = null;
  }

  return {
    durationSeconds: Number.isFinite(duration) ? duration : null,
    sampleRateHz: Number.isFinite(sampleRateHz) ? sampleRateHz : null,
    sampleRateKHz: Number.isFinite(sampleRateHz) ? sampleRateHz / 1000 : null,
    bitrateBps: Number.isFinite(bitrateBps) ? bitrateBps : null,
    bitrateKbps: Number.isFinite(bitrateBps) ? bitrateBps / 1000 : null,
    loudnessDb: Number.isFinite(loudnessDb) ? loudnessDb : null
  };
}
