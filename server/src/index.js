import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { extractAudioMetadata } from "./audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const uploadDir = path.resolve(__dirname, "..", "uploads");

fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed."));
    }
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/submissions", upload.single("audio"), async (req, res) => {
  console.log("POST /api/submissions received:", {
    file: req.file ? { originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size } : null,
    body: req.body
  });

  if (!req.file) {
    console.log("Upload rejected: no file present");
    return res.status(400).json({ error: "Audio file is required." });
  }

  const name = String(req.body.name ?? "").trim();
  const phone = String(req.body.phone ?? "").trim();

  if (!name || !phone) {
    console.log("Upload rejected: missing name or phone");
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Name and phone are required." });
  }

  try {
    console.log("Extracting metadata for:", req.file.path);
    const metadata = await extractAudioMetadata(req.file.path);
    console.log("Metadata extracted:", metadata);

    const insertSubmission = db.transaction(() => {
      let person = db
        .prepare("SELECT id FROM people WHERE phone = ?")
        .get(phone);

      if (!person) {
        const result = db
          .prepare("INSERT INTO people (name, phone) VALUES (?, ?)")
          .run(name, phone);
        person = { id: result.lastInsertRowid };
      } else {
        db.prepare("UPDATE people SET name = ? WHERE id = ?")
          .run(name, person.id);
      }

      const result = db.prepare(`
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
          loudness_db
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        metadata.loudnessDb
      );

      return result.lastInsertRowid;
    });

    const insertedId = insertSubmission();
    console.log("DB insert successful. Record id:", insertedId);
    res.status(201).json({
      id: insertedId,
      message: "Audio submitted successfully.",
      metadata
    });
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("Submission failed:", error);
    res.status(500).json({ error: error.message || "Audio processing failed." });
  }
});

app.get("/api/submissions", (_req, res) => {
  const rows = db.prepare(`
    SELECT
      s.id,
      p.name,
      p.phone,
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
    ORDER BY s.id DESC
  `).all();

  const normalized = rows.map(row => ({
    ...row,
    audio_url: row.audio_path.startsWith("http")
      ? row.audio_path
      : `http://localhost:${PORT}${row.audio_path.startsWith("/") ? row.audio_path : `/${row.audio_path}`}`
  }));

  console.log("GET /api/submissions returning:", rows.length, "rows");
  res.json(normalized);
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || "Request failed." });
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
