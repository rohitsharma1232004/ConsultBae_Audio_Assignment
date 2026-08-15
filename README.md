# ConsultBae Task 3 — React Audio Collection App

A working mini audio collection app for the ConsultBae take-home assignment.

## Stack

- React + Vite frontend
- Node.js + Express backend
- SQLite database
- Multer for uploads
- `ffprobe` for duration, sample rate and bitrate
- `ffmpeg` `loudnorm` analysis for integrated loudness

The assignment explicitly requires a web page where a worker can enter name/phone, record or upload audio, submit it, store the audio and database record, automatically extract duration, sample rate (kHz), bitrate and loudness (dB), and provide a second submissions view with playback and properties. See the supplied assignment. 

## Prerequisites

- Node.js 18+
- npm
- Internet access for npm install

This project uses `ffmpeg-static` and `ffprobe-static`, so you do **not** need to install FFmpeg globally.

## Run

```bash
cd server
npm install
npm run dev
```

In another terminal:

```bash
cd client
npm install
npm run dev
```

Open the Vite URL shown by the client, normally:

`http://localhost:5173`

The backend runs on:

`http://localhost:5000`

## What is stored

`server/data/app.db`

Tables:

- `people`
- `audio_submissions`

Audio files are stored under:

`server/uploads/`

For every submission, the database stores:

- `duration_seconds`
- `sample_rate_hz`
- `sample_rate_khz`
- `bitrate_bps`
- `bitrate_kbps`
- `loudness_db`
- `mime_type`
- `file_size_bytes`
- `audio_path`

## Metadata implementation

`ffprobe` reads the media container/stream metadata. If a file does not expose a stream bitrate, the backend calculates an effective bitrate as:

`file size in bits / duration`

Loudness is measured with FFmpeg's `loudnorm` filter and the `input_i` value from its JSON analysis is stored as the integrated loudness value.

## API

### POST `/api/submissions`

Multipart form:

- `name`
- `phone`
- `audio`

### GET `/api/submissions`

Returns all submissions and extracted metadata.

### GET `/uploads/:filename`

Streams a stored audio file.

## Production note

Local disk is intentionally used for the take-home demo. For a 5,000-worker launch, move audio to object storage such as S3/Azure Blob and keep only the object key/URL in the database. Run metadata extraction asynchronously through a queue rather than blocking the upload request.
