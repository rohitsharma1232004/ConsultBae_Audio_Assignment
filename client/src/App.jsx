import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AudioLines,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileAudio,
  Headphones,
  LayoutDashboard,
  ListFilter,
  Mic2,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  Users,
  X
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

const RESPONSE_TYPES = [
  "Field interview",
  "Customer feedback",
  "Site inspection",
  "Voice verification",
  "Research response"
];

const REVIEW_OPTIONS = [
  { value: "pending", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "needs_follow_up", label: "Needs follow-up" }
];

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "—";
  const total = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function formatDate(value) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getAudioUrl(item) {
  if (item?.audio_url) return item.audio_url;
  if (!item?.audio_path) return "";
  if (/^https?:\/\//i.test(item.audio_path)) return item.audio_path;
  const cleaned = item.audio_path.startsWith("/") ? item.audio_path : `/${item.audio_path}`;
  return new URL(cleaned, API).toString();
}

function fallbackQuality(item) {
  if (item.quality) return item.quality;
  const checks = [
    Number(item.duration_seconds) >= 2,
    Number(item.sample_rate_hz) >= 16000,
    Number(item.bitrate_kbps) >= 32,
    Number(item.loudness_db) >= -35 && Number(item.loudness_db) <= -8
  ];
  const score = checks.filter(Boolean).length * 25;
  return { score, status: score >= 75 ? "ready" : score >= 50 ? "review" : "re-record", issues: [] };
}

export default function App() {
  const [view, setView] = useState("overview");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    projectName: "",
    responseType: RESPONSE_TYPES[0],
    notes: ""
  });
  const [file, setFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [overview, setOverview] = useState(null);
  const [search, setSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [submissionsResponse, overviewResponse] = await Promise.all([
        fetch(`${API}/api/submissions`),
        fetch(`${API}/api/overview`)
      ]);

      if (!submissionsResponse.ok || !overviewResponse.ok) {
        throw new Error("The workspace could not be loaded.");
      }

      const [submissionsData, overviewData] = await Promise.all([
        submissionsResponse.json(),
        overviewResponse.json()
      ]);
      setSubmissions(submissionsData);
      setOverview(overviewData);
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Could not connect to the API." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    return () => {
      clearInterval(timerRef.current);
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, [loadData]);

  const filteredSubmissions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return submissions.filter(item => {
      const matchesSearch = !query || [item.name, item.phone, item.project_name, item.response_type]
        .some(value => String(value || "").toLowerCase().includes(query));
      const matchesReview = reviewFilter === "all" || item.review_status === reviewFilter;
      const matchesQuality = qualityFilter === "all" || fallbackQuality(item).status === qualityFilter;
      return matchesSearch && matchesReview && matchesQuality;
    });
  }, [submissions, search, reviewFilter, qualityFilter]);

  const calculatedStats = useMemo(() => {
    const durations = submissions
      .map(item => Number(item.duration_seconds))
      .filter(Number.isFinite);
    return {
      total: Number(overview?.total_submissions ?? submissions.length),
      people: Number(overview?.unique_people ?? new Set(submissions.map(item => item.phone)).size),
      pending: Number(overview?.pending_reviews ?? submissions.filter(item => item.review_status === "pending").length),
      averageDuration: Number(overview?.average_duration_seconds ?? (
        durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : 0
      )),
      ready: submissions.filter(item => fallbackQuality(item).status === "ready").length
    };
  }, [overview, submissions]);

  const qualityBreakdown = useMemo(() => {
    const counts = { ready: 0, review: 0, "re-record": 0 };
    submissions.forEach(item => { counts[fallbackQuality(item).status] += 1; });
    return counts;
  }, [submissions]);

  function updateForm(field, value) {
    setForm(current => ({ ...current, [field]: value }));
  }

  async function startRecording() {
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice({ type: "error", text: "Microphone recording is not supported in this browser." });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mediaStreamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setFile(new File([blob], `field-response-${Date.now()}.webm`, { type: blob.type }));
        stream.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds(seconds => seconds + 1), 1000);
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Microphone permission was denied." });
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;
    mediaRecorderRef.current.stop();
    setRecording(false);
    clearInterval(timerRef.current);
    setNotice({ type: "success", text: "Recording captured and ready for analysis." });
  }

  function chooseFile(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith("audio/")) {
      setNotice({ type: "error", text: "Choose a valid audio file." });
      return;
    }
    if (selected.size > 25 * 1024 * 1024) {
      setNotice({ type: "error", text: "Audio files must be smaller than 25 MB." });
      return;
    }
    setFile(selected);
    setNotice(null);
  }

  async function submit(event) {
    event.preventDefault();
    setNotice(null);

    if (!form.name.trim() || !form.phone.trim() || !form.projectName.trim() || !file) {
      setNotice({ type: "error", text: "Name, phone, project and an audio response are required." });
      return;
    }

    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value.trim()));
    payload.append("audio", file);

    try {
      setSubmitting(true);
      const response = await fetch(`${API}/api/submissions`, { method: "POST", body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The response could not be captured.");

      setNotice({
        type: data.quality.status === "ready" ? "success" : "warning",
        text: `Response saved with an audio quality score of ${data.quality.score}/100.`
      });
      setForm({ name: "", phone: "", projectName: "", responseType: RESPONSE_TYPES[0], notes: "" });
      setFile(null);
      await loadData({ quiet: true });
      setView("library");
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Submission failed." });
    } finally {
      setSubmitting(false);
    }
  }

  async function updateReview(id, status) {
    try {
      const response = await fetch(`${API}/api/submissions/${id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Review status could not be updated.");
      setSubmissions(current => current.map(item => item.id === id ? updated : item));
      setNotice({ type: "success", text: "Review status updated." });
      const overviewResponse = await fetch(`${API}/api/overview`);
      if (overviewResponse.ok) setOverview(await overviewResponse.json());
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  const pageTitle = {
    overview: ["Operations overview", "Monitor collection progress and audio readiness."],
    capture: ["Capture a response", "Record or upload structured voice data from the field."],
    library: ["Response library", "Review, filter and approve every captured response."]
  }[view];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Go to overview">
          <span className="brand-mark"><AudioLines size={22} strokeWidth={2.4} /></span>
          <span><strong>FieldVoice</strong><small>Audio operations</small></span>
        </button>

        <nav className="nav" aria-label="Primary navigation">
          <NavButton active={view === "overview"} icon={LayoutDashboard} onClick={() => setView("overview")}>Overview</NavButton>
          <NavButton active={view === "capture"} icon={Plus} onClick={() => setView("capture")}>New capture</NavButton>
          <NavButton active={view === "library"} icon={Headphones} onClick={() => setView("library")}>Response library</NavButton>
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" />
          <div><strong>Workspace active</strong><small>Audio analysis enabled</small></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Voice data operations</p>
            <h1>{pageTitle[0]}</h1>
            <p>{pageTitle[1]}</p>
          </div>
          <div className="header-actions">
            <button className="icon-button" onClick={() => loadData()} aria-label="Refresh workspace" title="Refresh workspace">
              <RefreshCw size={18} />
            </button>
            <button className="primary-button" onClick={() => setView("capture")}>
              <Mic2 size={17} /> Capture audio
            </button>
          </div>
        </header>

        {notice && (
          <div className={`notice ${notice.type}`} role="status">
            {notice.type === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={16} /></button>
          </div>
        )}

        {view === "overview" && (
          <Overview
            loading={loading}
            stats={calculatedStats}
            qualityBreakdown={qualityBreakdown}
            recent={submissions.slice(0, 4)}
            projects={overview?.projects || []}
            onOpenLibrary={() => setView("library")}
            onCapture={() => setView("capture")}
          />
        )}

        {view === "capture" && (
          <CaptureForm
            form={form}
            updateForm={updateForm}
            file={file}
            setFile={setFile}
            recording={recording}
            recordSeconds={recordSeconds}
            submitting={submitting}
            startRecording={startRecording}
            stopRecording={stopRecording}
            chooseFile={chooseFile}
            submit={submit}
          />
        )}

        {view === "library" && (
          <Library
            loading={loading}
            submissions={filteredSubmissions}
            total={submissions.length}
            search={search}
            setSearch={setSearch}
            reviewFilter={reviewFilter}
            setReviewFilter={setReviewFilter}
            qualityFilter={qualityFilter}
            setQualityFilter={setQualityFilter}
            updateReview={updateReview}
            onCapture={() => setView("capture")}
          />
        )}
      </main>
    </div>
  );
}

function NavButton({ active, icon: Icon, onClick, children }) {
  return (
    <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>
      <Icon size={18} /> <span>{children}</span>
    </button>
  );
}

function Overview({ loading, stats, qualityBreakdown, recent, projects, onOpenLibrary, onCapture }) {
  const qualityTotal = Math.max(1, Object.values(qualityBreakdown).reduce((sum, value) => sum + value, 0));
  const statCards = [
    { label: "Total responses", value: stats.total, icon: FileAudio, tone: "violet" },
    { label: "Unique contributors", value: stats.people, icon: Users, tone: "blue" },
    { label: "Pending review", value: stats.pending, icon: Clock3, tone: "amber" },
    { label: "Ready for use", value: stats.ready, icon: ShieldCheck, tone: "green" }
  ];

  return (
    <section className="view-stack">
      <div className="stat-grid">
        {statCards.map(({ label, value, icon: Icon, tone }) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon ${tone}`}><Icon size={20} /></div>
            <span>{label}</span>
            <strong>{loading ? "—" : value}</strong>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <article className="panel quality-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Automated QA</p><h2>Audio readiness</h2></div>
            <Activity size={20} />
          </div>
          <p className="panel-copy">Every response is scored using duration, sample rate, bitrate and loudness checks.</p>
          <div className="quality-bars">
            <QualityBar label="Ready" count={qualityBreakdown.ready} percent={(qualityBreakdown.ready / qualityTotal) * 100} tone="ready" />
            <QualityBar label="Manual review" count={qualityBreakdown.review} percent={(qualityBreakdown.review / qualityTotal) * 100} tone="review" />
            <QualityBar label="Re-record" count={qualityBreakdown["re-record"]} percent={(qualityBreakdown["re-record"] / qualityTotal) * 100} tone="re-record" />
          </div>
          <div className="quality-summary">
            <div><strong>{formatDuration(stats.averageDuration)}</strong><span>Average length</span></div>
            <div><strong>{stats.total ? Math.round((stats.ready / stats.total) * 100) : 0}%</strong><span>Ready rate</span></div>
          </div>
        </article>

        <article className="panel project-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Collection progress</p><h2>Active projects</h2></div>
            <BarChart3 size={20} />
          </div>
          {projects.length ? (
            <div className="project-list">
              {projects.slice(0, 5).map((project, index) => (
                <div className="project-row" key={project.project_name}>
                  <span className="project-rank">{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{project.project_name}</strong><span>{project.submission_count} responses</span></div>
                  <div className="project-meter"><span style={{ width: `${Math.max(12, (project.submission_count / stats.total) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyCompact title="No projects yet" text="Create your first capture to start tracking a collection." action="Start capture" onAction={onCapture} />
          )}
        </article>
      </div>

      <article className="panel recent-panel">
        <div className="panel-heading panel-heading-row">
          <div><p className="section-kicker">Latest activity</p><h2>Recent responses</h2></div>
          <button className="text-button" onClick={onOpenLibrary}>View library</button>
        </div>
        {recent.length ? (
          <div className="recent-list">
            {recent.map(item => <RecentRow item={item} key={item.id} />)}
          </div>
        ) : (
          <EmptyCompact title="Your workspace is ready" text="Capture a response to see operational activity here." action="Capture response" onAction={onCapture} />
        )}
      </article>
    </section>
  );
}

function QualityBar({ label, count, percent, tone }) {
  return (
    <div className="quality-row">
      <div><span>{label}</span><strong>{count}</strong></div>
      <div className="bar-track"><span className={tone} style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function RecentRow({ item }) {
  const quality = fallbackQuality(item);
  return (
    <div className="recent-row">
      <div className="avatar">{item.name?.slice(0, 1).toUpperCase() || "?"}</div>
      <div className="recent-person"><strong>{item.name}</strong><span>{item.project_name || "General"}</span></div>
      <span className="response-type">{item.response_type || "Field interview"}</span>
      <span className={`quality-badge ${quality.status}`}>{quality.score}/100</span>
      <span className="recent-date">{formatDate(item.created_at)}</span>
    </div>
  );
}

function CaptureForm({ form, updateForm, file, setFile, recording, recordSeconds, submitting, startRecording, stopRecording, chooseFile, submit }) {
  return (
    <form className="capture-layout" onSubmit={submit}>
      <section className="panel form-panel">
        <div className="form-section-heading"><span>01</span><div><h2>Contributor details</h2><p>Connect the voice response to the right person and project.</p></div></div>
        <div className="form-grid">
          <Field label="Full name" required>
            <input value={form.name} onChange={event => updateForm("name", event.target.value)} placeholder="e.g. Ananya Verma" autoComplete="name" />
          </Field>
          <Field label="Phone number" required>
            <div className="input-with-icon"><Phone size={16} /><input value={form.phone} onChange={event => updateForm("phone", event.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoComplete="tel" /></div>
          </Field>
          <Field label="Project or campaign" required>
            <input value={form.projectName} onChange={event => updateForm("projectName", event.target.value)} placeholder="e.g. Retail CX Study — Delhi" />
          </Field>
          <Field label="Response type">
            <select value={form.responseType} onChange={event => updateForm("responseType", event.target.value)}>
              {RESPONSE_TYPES.map(type => <option key={type}>{type}</option>)}
            </select>
          </Field>
        </div>

        <div className="form-divider" />
        <div className="form-section-heading"><span>02</span><div><h2>Voice response</h2><p>Record in the browser or upload an existing file up to 25 MB.</p></div></div>

        <div className={recording ? "recorder active" : "recorder"}>
          <div className="recorder-visual">
            <span className="mic-orb"><Mic2 size={26} /></span>
            <div><strong>{recording ? "Recording in progress" : file ? "Audio ready" : "Ready to capture"}</strong><span>{recording ? `Listening · ${formatDuration(recordSeconds)}` : file ? file.name : "Use your microphone or choose a file"}</span></div>
          </div>
          <div className="waveform" aria-hidden="true">
            {Array.from({ length: 22 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 45}ms` }} />)}
          </div>
          <div className="recorder-actions">
            {recording ? (
              <button className="stop-button" type="button" onClick={stopRecording}><span /> Stop recording</button>
            ) : (
              <button className="record-button" type="button" onClick={startRecording}><Mic2 size={17} /> Start recording</button>
            )}
            <label className="upload-button">
              <Upload size={17} /> Upload file
              <input type="file" accept="audio/*" onChange={chooseFile} hidden />
            </label>
          </div>
          {file && !recording && (
            <div className="file-pill">
              <FileAudio size={16} /><span>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
              <button type="button" onClick={() => setFile(null)} aria-label="Remove selected file"><X size={15} /></button>
            </div>
          )}
        </div>

        <Field label="Collection notes" hint="Optional · visible to reviewers">
          <textarea value={form.notes} onChange={event => updateForm("notes", event.target.value)} maxLength={500} placeholder="Add field context, consent notes or follow-up details..." />
        </Field>

        <button className="submit-button" disabled={recording || submitting}>
          {submitting ? <><RefreshCw className="spin" size={18} /> Analyzing audio...</> : <><ShieldCheck size={18} /> Save and run quality checks</>}
        </button>
      </section>

      <aside className="capture-aside">
        <div className="panel checklist-card">
          <p className="section-kicker">Automatic checks</p>
          <h3>Quality gate</h3>
          <p>FieldVoice checks every recording before it enters the review queue.</p>
          <ul>
            <li><Clock3 size={16} /><span><strong>Duration</strong>Minimum 2 seconds</span></li>
            <li><Activity size={16} /><span><strong>Sample rate</strong>16 kHz or higher</span></li>
            <li><AudioLines size={16} /><span><strong>Bitrate</strong>32 kbps or higher</span></li>
            <li><BarChart3 size={16} /><span><strong>Loudness</strong>Between −35 and −8 dB</span></li>
          </ul>
        </div>
        <div className="privacy-card"><ShieldCheck size={21} /><div><strong>Controlled storage</strong><p>Files stay in your configured storage and metadata remains linked to each response.</p></div></div>
      </aside>
    </form>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <label className="field">
      <span>{label}{required && <em>*</em>}{hint && <small>{hint}</small>}</span>
      {children}
    </label>
  );
}

function Library({ loading, submissions, total, search, setSearch, reviewFilter, setReviewFilter, qualityFilter, setQualityFilter, updateReview, onCapture }) {
  return (
    <section className="panel library-panel">
      <div className="library-toolbar">
        <div className="search-box"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search person, phone or project..." /></div>
        <div className="filters">
          <span><ListFilter size={16} /> Filters</span>
          <select value={reviewFilter} onChange={event => setReviewFilter(event.target.value)} aria-label="Filter by review status">
            <option value="all">All review states</option>
            {REVIEW_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
          <select value={qualityFilter} onChange={event => setQualityFilter(event.target.value)} aria-label="Filter by audio quality">
            <option value="all">All quality levels</option>
            <option value="ready">Ready</option>
            <option value="review">Manual review</option>
            <option value="re-record">Re-record</option>
          </select>
        </div>
      </div>

      <div className="library-meta"><strong>{submissions.length}</strong><span>of {total} responses</span></div>

      {loading ? (
        <div className="loading-state"><RefreshCw className="spin" size={22} /> Loading response library...</div>
      ) : submissions.length ? (
        <div className="submission-list">
          {submissions.map(item => <SubmissionCard item={item} updateReview={updateReview} key={item.id} />)}
        </div>
      ) : (
        <div className="empty-state"><span><Headphones size={30} /></span><h3>No responses found</h3><p>Adjust the filters or capture a new voice response.</p><button className="primary-button" onClick={onCapture}><Mic2 size={17} /> Capture audio</button></div>
      )}
    </section>
  );
}

function SubmissionCard({ item, updateReview }) {
  const quality = fallbackQuality(item);
  const reviewLabel = REVIEW_OPTIONS.find(option => option.value === item.review_status)?.label || "Pending review";
  return (
    <article className="submission-card">
      <div className="submission-topline">
        <div className="person-block">
          <div className="avatar large">{item.name?.slice(0, 1).toUpperCase() || "?"}</div>
          <div><strong>{item.name}</strong><span>{item.phone}</span></div>
        </div>
        <div className="submission-context"><span>{item.project_name || "General"}</span><small>{item.response_type || "Field interview"} · {formatDate(item.created_at)}</small></div>
        <div className={`quality-score ${quality.status}`}><strong>{quality.score}</strong><span>quality</span></div>
      </div>

      <div className="audio-row">
        <audio controls preload="metadata" src={getAudioUrl(item)} />
        <div className="metrics">
          <Metric label="Duration" value={formatDuration(item.duration_seconds)} />
          <Metric label="Sample" value={`${formatNumber(item.sample_rate_khz)} kHz`} />
          <Metric label="Bitrate" value={`${formatNumber(item.bitrate_kbps)} kbps`} />
          <Metric label="Loudness" value={`${formatNumber(item.loudness_db)} dB`} />
        </div>
      </div>

      {(item.notes || quality.issues?.length > 0) && (
        <div className="submission-notes">
          {item.notes && <p><strong>Field note:</strong> {item.notes}</p>}
          {quality.issues?.length > 0 && <p className="quality-issues"><AlertCircle size={15} /><strong>QA:</strong> {quality.issues.join(" · ")}</p>}
        </div>
      )}

      <div className="review-row">
        <span className={`review-pill ${item.review_status || "pending"}`}>{reviewLabel}</span>
        <div>
          <button className={item.review_status === "needs_follow_up" ? "review-button active-warning" : "review-button"} onClick={() => updateReview(item.id, "needs_follow_up")}>Follow-up</button>
          <button className={item.review_status === "approved" ? "review-button active-success" : "review-button"} onClick={() => updateReview(item.id, "approved")}><CheckCircle2 size={15} /> Approve</button>
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyCompact({ title, text, action, onAction }) {
  return <div className="empty-compact"><AudioLines size={24} /><strong>{title}</strong><p>{text}</p><button className="text-button" onClick={onAction}>{action}</button></div>;
}
