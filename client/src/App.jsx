import React, { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "https://consultbae-audio-assignment-3.onrender.com";

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const total = Math.round(Number(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function getAudioUrl(item) {
  if (!item?.audio_path) return "";
  if (/^https?:\/\//i.test(item.audio_path)) return item.audio_path;

  const cleaned = item.audio_path.startsWith("/") ? item.audio_path : `/${item.audio_path}`;
  return new URL(cleaned, API).toString();
}

export default function App() {
  const [view, setView] = useState("submit");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submissions, setSubmissions] = useState([]);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => () => clearInterval(timerRef.current), []);

  async function startRecording() {
    setError("");
    setStatus("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support microphone recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus"
      ];
      const mimeType = mimeCandidates.find(type =>
        MediaRecorder.isTypeSupported(type)
      );

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      chunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        setFile(
          new File([blob], `recording-${Date.now()}.webm`, {
            type: blob.type
          })
        );
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds(seconds => seconds + 1),
        1000
      );
    } catch (e) {
      setError(e.message || "Microphone permission was denied.");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setRecording(false);
    clearInterval(timerRef.current);
    setStatus("Recording captured. Ready to submit.");
  }

  function chooseFile(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;

    if (!selected.type.startsWith("audio/")) {
      setError("Please select an audio file.");
      return;
    }

    setError("");
    setStatus("");
    setFile(selected);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!name.trim() || !phone.trim() || !file) {
      console.log("submit blocked: missing name, phone, or audio file");
      setError("Name, phone number and an audio recording are required.");
      return;
    }

    const form = new FormData();
    form.append("name", name.trim());
    form.append("phone", phone.trim());
    form.append("audio", file);

    console.log("Submitting form to API:", API, {
      name: name.trim(),
      phone: phone.trim(),
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size
    });

    try {
      setStatus("Uploading and analyzing audio...");
      const response = await fetch(`${API}/api/submissions`, {
        method: "POST",
        body: form
      });

      const rawText = await response.text();
      console.log("POST response status:", response.status);
      console.log("POST response body:", rawText);

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: rawText };
      }

      if (!response.ok) {
        throw new Error(data.error || "Submission failed.");
      }

      console.log("Submission success payload:", data);
      setStatus(
        `Submitted successfully — ${formatDuration(data.metadata.durationSeconds)}, ` +
        `${formatNumber(data.metadata.sampleRateKHz, 1)} kHz, ` +
        `${formatNumber(data.metadata.bitrateKbps, 1)} kbps, ` +
        `${formatNumber(data.metadata.loudnessDb, 1)} dB`
      );

      const refreshed = await fetch(`${API}/api/submissions`);
      const refreshedText = await refreshed.text();
      console.log("GET submissions status:", refreshed.status);
      console.log("GET submissions body:", refreshedText);

      let refreshedData;
      try {
        refreshedData = JSON.parse(refreshedText);
      } catch {
        refreshedData = { error: refreshedText };
      }

      if (!refreshed.ok) throw new Error(refreshedData.error || "Could not reload submissions.");

      setSubmissions(refreshedData);
      setView("list");
      setFile(null);
      event.target.reset();
      console.log("After successful submit, submissions state set:", refreshedData);
    } catch (e) {
      console.error("Submission error:", e);
      setError(e.message || "Submission failed.");
      setStatus("");
    }
  }

  async function loadSubmissions() {
    setView("list");
    setError("");

    try {
      const response = await fetch(`${API}/api/submissions`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load submissions.");
      setSubmissions(data);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <p className="eyebrow">ConsultBae • Task 3</p>
          <h1>Audio Collection</h1>
          <p className="subtitle">
            Record or upload a worker response. Audio properties are extracted
            automatically on the server.
          </p>
        </div>

        <div className="tabs">
          <button
            className={view === "submit" ? "tab active" : "tab"}
            onClick={() => setView("submit")}
          >
            New submission
          </button>
          <button
            className={view === "list" ? "tab active" : "tab"}
            onClick={loadSubmissions}
          >
            Submissions
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {status && <div className="alert success">{status}</div>}

      {view === "submit" ? (
        <section className="card">
          <form onSubmit={submit}>
            <div className="grid">
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Worker name"
                  required
                />
              </label>

              <label>
                <span>Phone number</span>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  inputMode="tel"
                  required
                />
              </label>
            </div>

            <div className="audio-box">
              <div>
                <h2>Audio</h2>
                <p>Upload a file or record directly from the browser.</p>
              </div>

              <div className="actions">
                <label className="secondary button">
                  Choose audio
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={chooseFile}
                    hidden
                  />
                </label>

                {!recording ? (
                  <button type="button" className="primary button" onClick={startRecording}>
                    Start recording
                  </button>
                ) : (
                  <button type="button" className="danger button" onClick={stopRecording}>
                    Stop recording ({formatDuration(recordSeconds)})
                  </button>
                )}
              </div>

              {file && (
                <div className="selected">
                  <strong>{file.name}</strong>
                  <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              )}
            </div>

            <div className="metadata-note">
              <strong>Automatically extracted after upload</strong>
              <div className="chips">
                <span>Duration</span>
                <span>Sample rate</span>
                <span>Bitrate</span>
                <span>Loudness</span>
              </div>
            </div>

            <button className="submit" disabled={recording}>
              Submit audio
            </button>
          </form>
        </section>
      ) : (
        <section className="card">
          <div className="list-header">
            <div>
              <h2>All submissions</h2>
              <p>Stored records and server-side audio analysis.</p>
            </div>
            <button className="secondary button" onClick={loadSubmissions}>
              Refresh
            </button>
          </div>

          {submissions.length === 0 ? (
            <div className="empty">No submissions yet.</div>
          ) : (
            <div className="submission-list">
              {submissions.map(item => (
                <article className="submission" key={item.id}>
                  <div className="person">
                    <div className="avatar">
                      {item.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.phone}</span>
                    </div>
                  </div>

                  <audio
                    controls
                    preload="metadata"
                    src={getAudioUrl(item)}
                  />

                  <div className="metrics">
                    <Metric label="Duration" value={formatDuration(item.duration_seconds)} />
                    <Metric label="Sample rate" value={`${formatNumber(item.sample_rate_khz, 1)} kHz`} />
                    <Metric label="Bitrate" value={`${formatNumber(item.bitrate_kbps, 1)} kbps`} />
                    <Metric label="Loudness" value={`${formatNumber(item.loudness_db, 1)} dB`} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
