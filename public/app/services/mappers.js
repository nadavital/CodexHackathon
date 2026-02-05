function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(candidates, fallback = "") {
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeDate(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return "";
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  return [];
}

export function normalizeSourceType(value) {
  const normalized = String(value || "text").toLowerCase().trim();
  return ["text", "link", "image"].includes(normalized) ? normalized : "text";
}

export function normalizeCitationLabel(value) {
  if (!value) return null;
  const match = String(value)
    .trim()
    .toUpperCase()
    .match(/^N(\d+)$/);
  if (!match) return null;

  const index = Number(match[1]);
  if (!Number.isFinite(index) || index < 1) return null;
  return `N${index}`;
}

export function snippet(text, limit = 180) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function pickPayloadArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  for (const key of keys) {
    const nested = payload[key];
    if (isRecord(nested) && Array.isArray(nested.items)) {
      return nested.items;
    }
  }

  return [];
}

export function normalizeNote(raw, index = 0) {
  const source = isRecord(raw) ? raw : {};
  const content = firstString([source.content, source.text, source.body, source.noteContent], "");
  const sourceUrl = firstString([source.sourceUrl, source.source_url, source.url, source.link], "");

  return {
    id: firstString([source.id, source.noteId, source.note_id], `note-${Date.now()}-${index}`),
    content: content || sourceUrl || "",
    sourceType: normalizeSourceType(source.sourceType || source.source_type || source.kind),
    sourceUrl,
    imagePath: firstString([source.imagePath, source.image_path, source.imageUrl, source.image_url], ""),
    summary: firstString([source.summary, source.aiSummary, source.excerpt, source.preview], snippet(content || sourceUrl, 160) || "(no summary)"),
    tags: normalizeTags(source.tags ?? source.tagList ?? source.keywords ?? source.labels),
    project: firstString([source.project, source.projectName, source.workspace], "general"),
    createdAt: normalizeDate(source.createdAt ?? source.created_at ?? source.timestamp ?? source.time),
    updatedAt: normalizeDate(source.updatedAt ?? source.updated_at ?? source.modifiedAt ?? source.modified_at),
  };
}

export function normalizeCitation(raw, index = 0) {
  const source = isRecord(raw) ? raw : {};
  const rank = Math.max(1, Math.floor(toFiniteNumber(source.rank ?? source.position, index + 1)));
  const label = normalizeCitationLabel(source.label) || `N${rank}`;
  const notePayload = source.note || source.memory || source.item || source.document || source;

  return {
    rank,
    label,
    score: toFiniteNumber(source.score ?? source.similarity ?? source.relevance ?? source.confidence, 0),
    note: normalizeNote(notePayload, index),
  };
}

function collectCitationLabels(text, maxIndex) {
  const labels = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(/\[(N?\d+)\]/gi)) {
    const raw = String(match[1] || "").toUpperCase();
    const numeric = raw.startsWith("N") ? Number(raw.slice(1)) : Number(raw);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > maxIndex) continue;
    const label = `N${numeric}`;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function adaptHealthResponse(payload) {
  const source = isRecord(payload) ? payload : {};
  const rawConfigured =
    source.openaiConfigured ??
    source.openai?.configured ??
    source.openai?.enabled ??
    source.features?.openai ??
    source.features?.openaiConfigured;

  let openaiConfigured = null;
  if (typeof rawConfigured === "boolean") {
    openaiConfigured = rawConfigured;
  } else if (rawConfigured === "true" || rawConfigured === "false") {
    openaiConfigured = rawConfigured === "true";
  }

  return {
    ok: source.ok !== false,
    openaiConfigured,
  };
}

export function adaptNotesResponse(payload) {
  const source = isRecord(payload) ? payload : {};
  const rawItems = pickPayloadArray(payload, ["items", "notes", "results", "data", "documents"]);
  const items = rawItems.map((entry, index) => normalizeCitation(entry, index));

  return {
    items,
    count: Math.max(0, Math.floor(toFiniteNumber(source.count ?? source.total ?? source.totalCount ?? source.meta?.count, items.length))),
  };
}

export function adaptAnswerResponse(payload, kind = "chat") {
  const source = isRecord(payload) ? payload : {};
  let rawCitations = pickPayloadArray(payload, ["citations", "sources", "evidence", "items"]);
  if (!rawCitations.length) {
    rawCitations = pickPayloadArray(source.data, ["citations", "sources", "evidence", "items"]);
  }

  const citations = rawCitations.map((entry, index) => normalizeCitation(entry, index));

  const textCandidates =
    kind === "context"
      ? [source.context, source.answer, source.text, source.output, source.message, source.data?.context, source.data?.answer]
      : [source.answer, source.text, source.output, source.message, source.context, source.data?.answer, source.data?.text];

  const text = firstString(textCandidates, kind === "context" ? "No context generated" : "No answer");
  const providedLabels = Array.isArray(source.usedCitationLabels)
    ? source.usedCitationLabels
    : Array.isArray(source.used_citation_labels)
      ? source.used_citation_labels
      : [];

  const normalizedProvided = providedLabels.map((label) => normalizeCitationLabel(label)).filter(Boolean);
  const inferred = collectCitationLabels(text, citations.length);

  return {
    text,
    citations,
    mode: firstString([source.mode, source.provider, source.strategy], "unknown"),
    usedCitationLabels: normalizedProvided.length ? normalizedProvided : inferred,
  };
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function guessTags(text, limit = 4) {
  const stopWords = new Set(["with", "this", "that", "from", "into", "have", "will", "your", "about", "project"]);
  const counts = new Map();

  tokenize(text).forEach((token) => {
    if (token.length < 4 || stopWords.has(token)) return;
    counts.set(token, (counts.get(token) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

export function createMockSeedNotes() {
  const now = Date.now();
  return [
    {
      id: "mock-launch-checklist",
      content: "Launch checklist drafted: pricing page copy, onboarding tour, and signup QA for desktop demo.",
      summary: "Launch checklist includes pricing copy, onboarding, and signup QA.",
      tags: ["launch", "onboarding", "qa"],
      project: "demo",
      sourceType: "text",
      sourceUrl: "",
      imagePath: "",
      createdAt: new Date(now - 1000 * 60 * 50).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 50).toISOString(),
    },
    {
      id: "mock-mcp-sync",
      content: "Keep MCP and OpenClaw tools aligned with the same create/search/context behavior.",
      summary: "Tool surfaces should share one memory contract.",
      tags: ["mcp", "openclaw", "contract"],
      project: "platform",
      sourceType: "text",
      sourceUrl: "",
      imagePath: "",
      createdAt: new Date(now - 1000 * 60 * 120).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 120).toISOString(),
    },
    {
      id: "mock-ui-stream",
      content: "Stream cards should stay compact. Full details can open in a separate focused surface.",
      summary: "Use compact stream previews with on-demand detail.",
      tags: ["ui", "stream", "cards"],
      project: "frontend",
      sourceType: "text",
      sourceUrl: "",
      imagePath: "",
      createdAt: new Date(now - 1000 * 60 * 240).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 240).toISOString(),
    },
  ];
}

export function filterAndRankMockNotes(mockNotes, { query, project, limit = 40 } = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedProject = String(project || "").trim().toLowerCase();
  const queryTokens = tokenize(normalizedQuery);
  const list = Array.isArray(mockNotes) ? mockNotes : [];

  const scored = list
    .filter((note) => {
      if (!normalizedProject) return true;
      return String(note.project || "").toLowerCase().includes(normalizedProject);
    })
    .map((note) => {
      if (!normalizedQuery) {
        return { note, score: 1 };
      }

      const haystack = `${note.content} ${note.summary} ${(note.tags || []).join(" ")} ${note.project || ""}`.toLowerCase();
      let overlap = 0;
      queryTokens.forEach((token) => {
        if (haystack.includes(token)) overlap += 1;
      });

      if (overlap === 0) return null;
      return {
        note,
        score: overlap / Math.max(1, queryTokens.length),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const createdA = Date.parse(a.note.createdAt || "") || 0;
      const createdB = Date.parse(b.note.createdAt || "") || 0;
      if (b.score !== a.score) return b.score - a.score;
      return createdB - createdA;
    })
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));

  return scored.map((entry, index) => ({
    rank: index + 1,
    label: `N${index + 1}`,
    score: entry.score,
    note: normalizeNote(entry.note, index),
  }));
}

export function buildLocalFallbackNote(payload) {
  const now = new Date().toISOString();
  const content = String(payload.content || "").trim() || String(payload.sourceUrl || "").trim() || "Image memory";
  const project = String(payload.project || "").trim() || "general";

  return {
    id: `local-${Date.now()}`,
    content,
    sourceType: normalizeSourceType(payload.sourceType),
    sourceUrl: String(payload.sourceUrl || "").trim(),
    imagePath: payload.sourceType === "image" ? String(payload.imageDataUrl || "") : "",
    summary: snippet(content, 160) || "Saved in local fallback mode",
    tags: guessTags(`${content} ${project}`),
    project,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildMockChatAnswer(mockNotes, question, project) {
  const citations = filterAndRankMockNotes(mockNotes, { query: question, project, limit: 6 });
  if (citations.length === 0) {
    return {
      text: "Not enough local memory yet. Save a few notes and retry your question.",
      citations: [],
      usedCitationLabels: [],
    };
  }

  const lines = citations.slice(0, 4).map((entry) => `- [${entry.label}] ${entry.note.summary || snippet(entry.note.content, 120)}`);

  return {
    text: ["Local fallback answer:", ...lines].join("\n"),
    citations,
    usedCitationLabels: citations.slice(0, 4).map((entry) => entry.label),
  };
}

export function buildMockContext(mockNotes, task, project) {
  const citations = filterAndRankMockNotes(mockNotes, { query: task || "recent", project, limit: 8 });
  if (citations.length === 0) {
    return {
      text: "No local context is available yet.",
      citations: [],
      usedCitationLabels: [],
    };
  }

  return {
    text: citations.map((entry) => `[${entry.label}] ${entry.note.summary || snippet(entry.note.content, 120)}`).join("\n"),
    citations,
    usedCitationLabels: citations.map((entry) => entry.label),
  };
}

export function conciseTechnicalError(error, contextLabel) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const compact = raw.replace(/\s+/g, " ").trim();

  if (!compact) return contextLabel;
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(compact)) {
    return `${contextLabel}: network request failed`;
  }

  return `${contextLabel}: ${compact.slice(0, 140)}`;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text, maxChars = 180) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

export function buildNoteTitle(note) {
  const content = normalizeText(note.content);
  if (!content && note.sourceType === "image") return "Image memory";
  if (!content) return "Untitled memory";

  const sentenceMatch = content.match(/^(.{10,130}?[.!?])(\s|$)/);
  const candidate = sentenceMatch ? sentenceMatch[1] : content;
  return truncateText(candidate, 100);
}

export function buildContentPreview(note) {
  const content = normalizeText(note.content);
  if (content) return truncateText(content, 220);
  if (note.sourceUrl) return truncateText(note.sourceUrl, 220);
  if (note.sourceType === "image") return "Image capture with no text description.";
  return "No content preview available.";
}

export function buildSummaryPreview(note, maxChars = 180) {
  const summary = normalizeText(note.summary);
  if (!summary || summary.toLowerCase() === "(no summary)") {
    return "No AI notes yet.";
  }
  return truncateText(summary, maxChars);
}

export function formatScore(score) {
  if (typeof score !== "number") return "";
  return `score ${score.toFixed(3)}`;
}

export function formatMeta(note, detailed = false) {
  const parts = [];
  if (note.sourceType) parts.push(note.sourceType);
  if (note.project) parts.push(`project: ${note.project}`);
  if (note.createdAt) {
    const created = new Date(note.createdAt);
    if (!Number.isNaN(created.getTime())) {
      parts.push(detailed ? created.toLocaleString() : created.toLocaleDateString());
    }
  }
  if (detailed && note.updatedAt && note.updatedAt !== note.createdAt) {
    const updated = new Date(note.updatedAt);
    if (!Number.isNaN(updated.getTime())) {
      parts.push(`updated ${updated.toLocaleString()}`);
    }
  }
  return parts.join(" • ");
}

export function compactUrl(urlString, maxLen = 52) {
  if (!urlString) return "";
  try {
    const parsed = new URL(urlString);
    const normalized = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen - 3)}...`;
  } catch {
    const normalized = String(urlString);
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen - 3)}...`;
  }
}

export function formatSourceText(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return truncateText(`${parsed.hostname}${parsed.pathname}`, 90);
  } catch {
    return truncateText(url, 90);
  }
}

export function extractStandaloneUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s]+/i);
  if (!match) return "";
  try {
    return new URL(match[0]).toString();
  } catch {
    return "";
  }
}

export function inferCaptureType(content, imageDataUrl) {
  if (imageDataUrl) {
    return { sourceType: "image", sourceUrl: "" };
  }

  const trimmed = String(content || "").trim();
  const url = extractStandaloneUrl(trimmed);
  if (!url) {
    return { sourceType: "text", sourceUrl: "" };
  }

  const remainder = trimmed.replace(url, "").trim();
  if (!remainder) {
    return { sourceType: "link", sourceUrl: url };
  }

  return { sourceType: "text", sourceUrl: "" };
}
