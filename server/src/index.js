import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { extractAudioMetadata } from "./audio.js";
import { assessAudioQuality } from "./quality.js";
import { getAIConfigStatus, runVoiceAI } from "./ai.js";

const currentFile = fileURLToPath(import.meta.url);
const __dirname = path.dirname(currentFile);
const app = express();
const PORT = process.env.PORT || 5000;
const uploadDir = path.resolve(__dirname, "..", "uploads");
const allowedReviewStatuses = new Set(["pending", "approved", "needs_follow_up"]);
const aiProcessing = new Set();
const allowedOrigins = String(process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

fs.mkdirSync(uploadDir, { recursive: true });

app.set("trust proxy", 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Origin is not allowed."));
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use("/uploads", express.static(uploadDir, { fallthrough: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only audio files are allowed."));
  }
});

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isValidPhone(phone) {
  return /^[+\d][\d\s()-]{7,21}$/.test(phone);
}

function metadataFromRow(row) {
  return {
    durationSeconds: row.duration_seconds,
    sampleRateHz: row.sample_rate_hz,
    sampleRateKHz: row.sample_rate_khz,
    bitrateBps: row.bitrate_bps,
    bitrateKbps: row.bitrate_kbps,
    loudnessDb: row.loudness_db
  };
}

function serializeSubmission(row, req) {
  const audioPath = row.audio_path.startsWith("/") ? row.audio_path : `/${row.audio_path}`;
  const audioUrl = row.audio_path.startsWith("http")
    ? row.audio_path
    : `${req.protocol}://${req.get("host")}${audioPath}`;

  let aiTopics = [];
  try {
    aiTopics = JSON.parse(row.ai_topics_json || "[]");
  } catch {
    aiTopics = [];
  }

  const { ai_topics_json: _internalTopics, ...safeRow } = row;
  return {
    ...safeRow,
    audio_url: audioUrl,
    ai_topics: aiTopics,
    quality: assessAudioQuality(metadataFromRow(row))
  };
}

const submissionSelect = `
  SELECT
    s.id,
    p.name,
    p.phone,
    s.project_name,
    s.response_type,
    s.notes,
    s.review_status,
    s.review_notes,
    s.reviewed_at,
    s.transcript,
    s.ai_summary,
    s.ai_sentiment,
    s.ai_priority,
    s.ai_category,
    s.ai_topics_json,
    s.ai_recommended_action,
    s.ai_status,
    s.ai_error,
    s.ai_processed_at,
    s.original_filename,
    s.audio_path,
    s.mime_type,
    s.file_size_bytes,
    s.duration_seconds,
    s.sample_rate_hz,
    s.sample_rate_khz,
    s.bitrate_bps,
    s.bitrate_kbps,
    s.loudness_db,
    s.created_at
  FROM audio_submissions s
  JOIN people p ON p.id = s.person_id
`;

async function processSubmissionAI(id) {
  if (aiProcessing.has(id)) return false;

  const config = getAIConfigStatus();
  if (!config.configured) {
    db.prepare("UPDATE audio_submissions SET ai_status = 'not_configured' WHERE id = ?").run(id);
    throw new Error("Groq AI is not configured on this server.");
  }

  const task = db.prepare(`
    SELECT stored_filename, original_filename, mime_type, project_name, response_type, notes
    FROM audio_submissions
    WHERE id = ?
  `).get(id);
  if (!task) return null;

  aiProcessing.add(id);
  db.prepare(`
    UPDATE audio_submissions
    SET ai_status = 'processing', ai_error = NULL
    WHERE id = ?
  `).run(id);

  try {
    const result = await runVoiceAI({
      filePath: path.join(uploadDir, task.stored_filename),
      mimeType: task.mime_type,
      originalFilename: task.original_filename,
      context: {
        projectName: task.project_name,
        responseType: task.response_type,
        notes: task.notes
      }
    });

    db.prepare(`
      UPDATE audio_submissions
      SET
        transcript = ?,
        ai_summary = ?,
        ai_sentiment = ?,
        ai_priority = ?,
        ai_category = ?,
        ai_topics_json = ?,
        ai_recommended_action = ?,
        ai_status = 'completed',
        ai_error = NULL,
        ai_processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.transcript,
      result.summary,
      result.sentiment,
      result.priority,
      result.category,
      JSON.stringify(result.keyTopics),
      result.recommendedAction,
      id
    );

    return true;
  } catch (error) {
    db.prepare(`
      UPDATE audio_submissions
      SET ai_status = 'failed', ai_error = ?
      WHERE id = ?
    `).run(cleanText(error.message || "AI processing failed.", 400), id);
    throw error;
  } finally {
    aiProcessing.delete(id);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "voiceops-ai-api", timestamp: new Date().toISOString() });
});

app.get("/api/ai/status", (_req, res) => {
  res.json(getAIConfigStatus());
});

app.post("/api/submissions", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Audio file is required." });
  }

  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 24);
  const projectName = cleanText(req.body.projectName, 100) || "General";
  const responseType = cleanText(req.body.responseType, 60) || "Field interview";
  const notes = cleanText(req.body.notes, 500);

  if (!name || !phone) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Name and phone are required." });
  }

  if (!isValidPhone(phone)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Enter a valid phone number." });
  }

  try {
    const metadata = await extractAudioMetadata(req.file.path);
    const quality = assessAudioQuality(metadata);
    const aiConfig = getAIConfigStatus();
    const aiStatus = aiConfig.configured
      ? (aiConfig.autoProcess ? "queued" : "pending")
      : "not_configured";

    const insertSubmission = db.transaction(() => {
      let person = db.prepare("SELECT id FROM people WHERE phone = ?").get(phone);

      if (!person) {
        const result = db
          .prepare("INSERT INTO people (name, phone) VALUES (?, ?)")
          .run(name, phone);
        person = { id: result.lastInsertRowid };
      } else {
        db.prepare("UPDATE people SET name = ? WHERE id = ?").run(name, person.id);
      }

      return db.prepare(`
        INSERT INTO audio_submissions (
          person_id,
          original_filename,
          stored_filename,
          audio_path,
          mime_type,
          file_size_bytes,
          duration_seconds,
          sample_rate_hz,
          sample_rate_khz,
          bitrate_bps,
          bitrate_kbps,
          loudness_db,
          project_name,
          response_type,
          notes,
          ai_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        person.id,
        req.file.originalname,
        req.file.filename,
        `/uploads/${req.file.filename}`,
        req.file.mimetype,
        req.file.size,
        metadata.durationSeconds,
        metadata.sampleRateHz,
        metadata.sampleRateKHz,
        metadata.bitrateBps,
        metadata.bitrateKbps,
        metadata.loudnessDb,
        projectName,
        responseType,
        notes || null,
        aiStatus
      ).lastInsertRowid;
    });

    const insertedId = insertSubmission();
    const row = db.prepare(`${submissionSelect} WHERE s.id = ?`).get(insertedId);

    if (aiStatus === "queued") {
      setImmediate(() => {
        processSubmissionAI(insertedId).catch(error => {
          console.error(`AI processing failed for submission ${insertedId}:`, error.message);
        });
      });
    }

    res.status(201).json({
      message: aiStatus === "queued"
        ? "Voice response captured. AI processing has started."
        : "Voice response captured successfully.",
      submission: serializeSubmission(row, req),
      metadata,
      quality
    });
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("Audio processing failed:", error);
    res.status(500).json({ error: "The audio could not be processed. Please try another file." });
  }
});

app.get("/api/submissions", (req, res) => {
  const search = cleanText(req.query.search, 80);
  const status = cleanText(req.query.status, 30);
  const project = cleanText(req.query.project, 100);
  const filters = [];
  const params = [];

  if (search) {
    filters.push("(p.name LIKE ? OR p.phone LIKE ? OR s.project_name LIKE ?)");
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }

  if (status && allowedReviewStatuses.has(status)) {
    filters.push("s.review_status = ?");
    params.push(status);
  }

  if (project) {
    filters.push("s.project_name = ?");
    params.push(project);
  }

  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const rows = db
    .prepare(`${submissionSelect}${where} ORDER BY s.id DESC LIMIT 250`)
    .all(...params);

  res.json(rows.map(row => serializeSubmission(row, req)));
});

app.get("/api/overview", (_req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_submissions,
      COUNT(DISTINCT person_id) AS unique_people,
      ROUND(AVG(duration_seconds), 1) AS average_duration_seconds,
      SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending_reviews,
      SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) AS approved_reviews,
      SUM(CASE WHEN ai_status = 'completed' THEN 1 ELSE 0 END) AS ai_completed,
      SUM(CASE WHEN ai_status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS ai_processing
    FROM audio_submissions
  `).get();

  const projects = db.prepare(`
    SELECT project_name, COUNT(*) AS submission_count
    FROM audio_submissions
    GROUP BY project_name
    ORDER BY submission_count DESC, project_name ASC
    LIMIT 8
  `).all();

  res.json({ ...totals, projects });
});

app.post("/api/submissions/:id/analyze", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  if (!getAIConfigStatus().configured) {
    return res.status(503).json({ error: "Groq AI is not configured on this server." });
  }

  try {
    const result = await processSubmissionAI(id);
    if (result === null) return res.status(404).json({ error: "Submission not found." });
    if (result === false) return res.status(409).json({ error: "AI processing is already running." });
    const row = db.prepare(`${submissionSelect} WHERE s.id = ?`).get(id);
    res.json(serializeSubmission(row, req));
  } catch (error) {
    res.status(error.status === 429 ? 429 : 502).json({
      error: error.status === 429
        ? "Groq rate limit reached. Retry shortly."
        : "AI processing failed. Check the server configuration and retry."
    });
  }
});

app.patch("/api/submissions/:id/review", (req, res) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body.status, 30);
  const reviewNotes = cleanText(req.body.reviewNotes, 500);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  if (!allowedReviewStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid review status." });
  }

  const result = db.prepare(`
    UPDATE audio_submissions
    SET review_status = ?, review_notes = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, reviewNotes || null, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const row = db.prepare(`${submissionSelect} WHERE s.id = ?`).get(id);
  res.json(serializeSubmission(row, req));
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Audio file must be smaller than 25 MB." });
  }

  res.status(400).json({ error: error.message || "Request failed." });
});

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  app.listen(PORT, () => {
    console.log(`VoiceOps AI API running on http://localhost:${PORT}`);
  });
}

export default app;
