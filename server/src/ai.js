import fs from "node:fs";
import path from "node:path";

const GROQ_API_BASE = process.env.GROQ_API_BASE || "https://api.groq.com/openai/v1";
const TRANSCRIPTION_MODEL = process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo";
const ANALYSIS_MODEL = process.env.GROQ_ANALYSIS_MODEL || "llama-3.1-8b-instant";

export function getAIConfigStatus() {
  return {
    configured: Boolean(process.env.GROQ_API_KEY),
    provider: "Groq",
    transcriptionModel: TRANSCRIPTION_MODEL,
    analysisModel: ANALYSIS_MODEL,
    autoProcess: process.env.AI_AUTO_PROCESS !== "false"
  };
}

async function groqRequest(endpoint, options) {
  const response = await fetch(`${GROQ_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      ...options.headers
    }
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: { message: raw } };
  }

  if (!response.ok) {
    const message = data.error?.message || `Groq request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function transcribeAudio({ filePath, mimeType, originalFilename }) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType || "audio/webm" }), originalFilename || path.basename(filePath));
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");

  const data = await groqRequest("/audio/transcriptions", { method: "POST", body: form });
  const transcript = String(data.text || "").trim();
  if (!transcript) throw new Error("The transcription service returned an empty transcript.");
  return transcript;
}

export function normalizeInsightResult(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const allowedSentiments = new Set(["positive", "neutral", "negative", "mixed"]);
  const allowedPriorities = new Set(["low", "medium", "high", "urgent"]);
  const topics = Array.isArray(source.key_topics)
    ? source.key_topics.map(topic => String(topic).trim()).filter(Boolean).slice(0, 6)
    : [];
  const sentiment = String(source.sentiment || "neutral").toLowerCase();
  const priority = String(source.priority || "medium").toLowerCase();

  return {
    summary: String(source.summary || "No summary generated.").trim().slice(0, 1200),
    sentiment: allowedSentiments.has(sentiment) ? sentiment : "neutral",
    priority: allowedPriorities.has(priority) ? priority : "medium",
    category: String(source.category || "General").trim().slice(0, 80),
    keyTopics: topics,
    recommendedAction: String(source.recommended_action || "Review the response.").trim().slice(0, 500)
  };
}

export async function analyzeTranscript(transcript, context = {}) {
  const systemPrompt = `You are an operations analyst for a voice-response workflow.
Return only valid JSON with these keys: summary, sentiment, priority, category, key_topics, recommended_action.
sentiment must be positive, neutral, negative, or mixed.
priority must be low, medium, high, or urgent.
key_topics must be an array of at most six short strings.
Do not approve or reject the response. A human reviewer owns the final decision.
Summarize only information present in the transcript.`;

  const userPrompt = `Project: ${context.projectName || "General"}
Response type: ${context.responseType || "Field interview"}
Field notes: ${context.notes || "None"}

Transcript:
${transcript}`;

  const data = await groqRequest("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      temperature: 0.1,
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("The insight model returned an empty response.");
  return normalizeInsightResult(JSON.parse(content));
}

export async function runVoiceAI({ filePath, mimeType, originalFilename, context }) {
  const transcript = await transcribeAudio({ filePath, mimeType, originalFilename });
  const insights = await analyzeTranscript(transcript, context);
  return { transcript, ...insights };
}
