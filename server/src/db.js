import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audio_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    audio_path TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INTEGER NOT NULL,
    duration_seconds REAL,
    sample_rate_hz REAL,
    sample_rate_khz REAL,
    bitrate_bps REAL,
    bitrate_kbps REAL,
    loudness_db REAL,
    project_name TEXT NOT NULL DEFAULT 'General',
    response_type TEXT NOT NULL DEFAULT 'Field interview',
    notes TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending',
    review_notes TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES people(id)
  );
`);

const submissionColumns = new Set(
  db.prepare("PRAGMA table_info(audio_submissions)").all().map(column => column.name)
);

function ensureColumn(name, definition) {
  if (!submissionColumns.has(name)) {
    db.exec(`ALTER TABLE audio_submissions ADD COLUMN ${name} ${definition}`);
  }
}

ensureColumn("project_name", "TEXT NOT NULL DEFAULT 'General'");
ensureColumn("response_type", "TEXT NOT NULL DEFAULT 'Field interview'");
ensureColumn("notes", "TEXT");
ensureColumn("review_status", "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("review_notes", "TEXT");
ensureColumn("reviewed_at", "TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_audio_submissions_created_at
    ON audio_submissions(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audio_submissions_review_status
    ON audio_submissions(review_status);
`);

export default db;
