import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, publicUploadPath } from "./config.js";
import { noteRepo, projectMemoryRepo } from "./db.js";
import {
  createEmbedding,
  createResponse,
  hasOpenAI,
  pseudoEmbedding,
  cosineSimilarity,
  heuristicSummary,
  heuristicTags,
} from "./openai.js";

const SOURCE_TYPES = new Set(["text", "link", "image"]);
const EXTRACTOR_MODEL = "openai/gpt-5.1";
const TOP_LEVEL_KIND_ORDER = [
  "preferences",
  "people",
  "commitments",
  "decisions",
  "knowledge",
  "resources",
  "events",
  "inbox",
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeExternalSourceId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^ext:/i, "");
  return normalized ? normalized.toLowerCase() : "";
}

function buildSourceId({ normalizedFilename, externalSourceId }) {
  const normalizedExternalSourceId = normalizeExternalSourceId(externalSourceId);
  if (normalizedExternalSourceId) {
    return {
      sourceId: `ext:${normalizedExternalSourceId}`,
      normalizedExternalSourceId,
      sourceIdStrategy: "external_source_id",
    };
  }

  return {
    sourceId: crypto.createHash("sha256").update(normalizedFilename, "utf8").digest("hex"),
    normalizedExternalSourceId: "",
    sourceIdStrategy: "filename_hash",
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseRangeDate(value, { endOfDay = false, fieldName = "date" } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`Missing ${fieldName}`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${raw}`);
  }
  return parsed.toISOString();
}

function titleCaseKind(kind) {
  const normalized = String(kind || "inbox")
    .trim()
    .toLowerCase();
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

function isoSlug(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSourceType(sourceType) {
  if (!sourceType) return "text";
  const normalized = String(sourceType).toLowerCase().trim();
  return SOURCE_TYPES.has(normalized) ? normalized : "text";
}

function buildProjectFallback(sourceUrl, tags) {
  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
      return host.split(".")[0] || "General";
    } catch {
      // no-op
    }
  }
  if (Array.isArray(tags) && tags.length > 0) {
    return tags[0];
  }
  return "General";
}

function parseJsonObject(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function textOnlyFromHtml(html) {
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchLinkPreview(urlString) {
  if (!urlString) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(urlString, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "ProjectMemoryBot/0.1",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const body = textOnlyFromHtml(html);
    return {
      title: titleMatch ? titleMatch[1].trim() : "",
      excerpt: body.slice(0, 1600),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  return {
    mime: match[1],
    base64: match[2],
  };
}

function mimeToExt(mime) {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

async function saveImageDataUrl(dataUrl) {
  const { mime, base64 } = parseDataUrl(dataUrl);
  const bytes = Buffer.from(base64, "base64");
  const extension = mimeToExt(mime);
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const absolutePath = path.join(config.uploadDir, fileName);

  await fs.writeFile(absolutePath, bytes);

  return {
    imagePath: publicUploadPath(fileName),
    imageAbsolutePath: absolutePath,
    imageMime: mime,
    imageSize: bytes.length,
  };
}

async function imagePathToDataUrl(imagePath) {
  if (!imagePath) return null;
  const fileName = path.basename(imagePath);
  const absolutePath = path.join(config.uploadDir, fileName);

  try {
    const bytes = await fs.readFile(absolutePath);
    const ext = path.extname(fileName).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/png";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function noteTextForEmbedding(note, linkPreview) {
  const parts = [
    note.content || "",
    note.summary || "",
    Array.isArray(note.tags) ? note.tags.join(" ") : "",
    note.project || "",
    note.sourceUrl || "",
    linkPreview?.title || "",
    linkPreview?.excerpt || "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function lexicalScore(note, queryTokens) {
  if (queryTokens.length === 0) return 0;
  const noteTokens = new Set(tokenize(`${note.content} ${note.summary} ${(note.tags || []).join(" ")} ${note.project || ""}`));
  let overlap = 0;
  for (const token of queryTokens) {
    if (noteTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / queryTokens.length;
}

async function buildEnrichment(note, linkPreview = null) {
  const fallbackSummary = heuristicSummary(note.content);
  const fallbackTags = heuristicTags(`${note.content} ${linkPreview?.title || ""}`);
  const fallbackProject = note.project || buildProjectFallback(note.sourceUrl, fallbackTags);

  if (!hasOpenAI()) {
    return {
      summary: fallbackSummary,
      tags: fallbackTags,
      project: fallbackProject,
      enrichmentSource: "heuristic",
    };
  }

  try {
    const userText = [
      `source_type: ${note.sourceType}`,
      note.sourceUrl ? `source_url: ${note.sourceUrl}` : "",
      note.content ? `content:\n${note.content}` : "",
      linkPreview?.title ? `link_title: ${linkPreview.title}` : "",
      linkPreview?.excerpt ? `link_excerpt: ${linkPreview.excerpt}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const content = [{ type: "input_text", text: userText }];
    if (note.sourceType === "image" && note.imagePath) {
      const imageDataUrl = await imagePathToDataUrl(note.imagePath);
      if (imageDataUrl) {
        content.push({
          type: "input_image",
          image_url: imageDataUrl,
        });
      }
    }

    const { text } = await createResponse({
      instructions:
        "You are extracting memory metadata for a single-user project notebook. Output JSON only with keys: summary (<=180 chars), tags (array of 3-8 short lowercase tags), project (2-4 words).",
      input: [
        {
          role: "user",
          content,
        },
      ],
      temperature: 0.1,
    });

    const parsed = parseJsonObject(text);
    const summary = typeof parsed?.summary === "string" && parsed.summary.trim() ? parsed.summary.trim().slice(0, 220) : fallbackSummary;
    const tags = Array.isArray(parsed?.tags)
      ? parsed.tags
          .map((tag) => String(tag).toLowerCase().trim())
          .filter(Boolean)
          .slice(0, 8)
      : fallbackTags;
    const project = typeof parsed?.project === "string" && parsed.project.trim() ? parsed.project.trim().slice(0, 80) : fallbackProject;

    return {
      summary,
      tags,
      project,
      enrichmentSource: "openai",
    };
  } catch {
    return {
      summary: fallbackSummary,
      tags: fallbackTags,
      project: fallbackProject,
      enrichmentSource: "heuristic",
    };
  }
}

function materializeCitation(note, score, rank) {
  return {
    rank,
    score,
    note: {
      id: note.id,
      content: note.content,
      sourceType: note.sourceType,
      sourceUrl: note.sourceUrl,
      imagePath: note.imagePath,
      summary: note.summary,
      tags: note.tags || [],
      project: note.project,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  };
}

export async function createMemory({ content = "", sourceType = "text", sourceUrl = "", imageDataUrl = null, project = "", metadata = {} }) {
  const normalizedSourceType = normalizeSourceType(sourceType);
  const normalizedSourceUrl = String(sourceUrl || "").trim();
  let normalizedContent = String(content || "").trim();

  if (!normalizedContent && normalizedSourceUrl) {
    normalizedContent = normalizedSourceUrl;
  }

  let imageData = null;
  if (imageDataUrl) {
    imageData = await saveImageDataUrl(imageDataUrl);
  }

  if (!normalizedContent && !imageData) {
    throw new Error("Missing content");
  }

  const linkPreview = normalizedSourceType === "link" && normalizedSourceUrl ? await fetchLinkPreview(normalizedSourceUrl) : null;

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const seedTags = heuristicTags(`${normalizedContent} ${normalizedSourceUrl}`);
  const note = noteRepo.createNote({
    id,
    content: normalizedContent,
    sourceType: normalizedSourceType,
    sourceUrl: normalizedSourceUrl || null,
    imagePath: imageData?.imagePath || null,
    summary: heuristicSummary(normalizedContent),
    tags: seedTags,
    project: project || null,
    createdAt,
    updatedAt: createdAt,
    embedding: null,
    metadata: {
      ...metadata,
      imageMime: imageData?.imageMime || null,
      imageSize: imageData?.imageSize || null,
      linkTitle: linkPreview?.title || null,
    },
  });

  const enrichment = await buildEnrichment(note, linkPreview);
  const embeddingText = noteTextForEmbedding(
    {
      ...note,
      summary: enrichment.summary,
      tags: enrichment.tags,
      project: enrichment.project,
    },
    linkPreview
  );

  let embedding;
  try {
    embedding = await createEmbedding(embeddingText);
  } catch {
    embedding = pseudoEmbedding(embeddingText);
  }

  return noteRepo.updateEnrichment({
    id,
    summary: enrichment.summary,
    tags: enrichment.tags,
    project: enrichment.project,
    embedding,
    metadata: {
      ...(note.metadata || {}),
      enrichmentSource: enrichment.enrichmentSource,
      enrichedAt: nowIso(),
    },
    updatedAt: nowIso(),
  });
}

export async function listRecentMemories(limit = 20) {
  return noteRepo.listRecent(clampInt(limit, 1, 200, 20));
}

export function listProjects() {
  return noteRepo.listProjects();
}

export async function searchMemories({ query = "", project = "", limit = 15 } = {}) {
  const boundedLimit = clampInt(limit, 1, 100, 15);
  const normalizedQuery = String(query || "").trim();
  const normalizedProject = String(project || "").trim();

  if (!normalizedQuery) {
    const notes = noteRepo.listByProject(normalizedProject || null, boundedLimit);
    return notes.map((note, index) => materializeCitation(note, 1 - index * 0.001, index + 1));
  }

  const notes = noteRepo.listByProject(normalizedProject || null, 500);
  if (notes.length === 0) return [];

  const queryTokens = tokenize(normalizedQuery);
  let queryEmbedding;
  try {
    queryEmbedding = await createEmbedding(normalizedQuery);
  } catch {
    queryEmbedding = pseudoEmbedding(normalizedQuery);
  }

  const ranked = notes.map((note) => {
    const noteEmbedding = Array.isArray(note.embedding) ? note.embedding : pseudoEmbedding(`${note.content}\n${note.summary}`);
    const semantic = cosineSimilarity(queryEmbedding, noteEmbedding);
    const lexical = lexicalScore(note, queryTokens);
    const freshnessBoost = Math.max(0, 1 - (Date.now() - new Date(note.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)) * 0.05;
    const score = semantic * 0.82 + lexical * 0.13 + freshnessBoost;
    return { note, score };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, boundedLimit).map((item, index) => materializeCitation(item.note, item.score, index + 1));
}

function buildCitationBlock(citations) {
  return citations
    .map((entry, idx) => {
      const label = `N${idx + 1}`;
      const note = entry.note;
      return [
        `[${label}] note_id=${note.id}`,
        `summary: ${note.summary || ""}`,
        `project: ${note.project || ""}`,
        `source_url: ${note.sourceUrl || ""}`,
        `content: ${note.content || ""}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function askMemories({ question, project = "", limit = 6 }) {
  const normalizedQuestion = String(question || "").trim();
  if (!normalizedQuestion) {
    throw new Error("Missing question");
  }

  const citations = await searchMemories({ query: normalizedQuestion, project, limit });
  if (citations.length === 0) {
    return {
      answer: "No relevant memory found yet. Save a few notes first.",
      citations: [],
      mode: "empty",
    };
  }

  if (!hasOpenAI()) {
    const answer = [
      "Based on your saved notes:",
      ...citations.slice(0, 4).map((entry, idx) => `- [N${idx + 1}] ${entry.note.summary || heuristicSummary(entry.note.content, 120)}`),
    ].join("\n");
    return {
      answer,
      citations,
      mode: "heuristic",
    };
  }

  try {
    const context = buildCitationBlock(citations);
    const { text } = await createResponse({
      instructions:
        "Answer ONLY using the provided memory snippets. Be concise. Every factual claim must cite at least one snippet using [N1], [N2], etc. If uncertain, say what is missing.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Question: ${normalizedQuestion}\n\nMemory snippets:\n${context}`,
            },
          ],
        },
      ],
      temperature: 0.2,
    });

    return {
      answer: text || "I could not generate an answer.",
      citations,
      mode: "openai",
    };
  } catch {
    const answer = [
      "I could not call the model, but these notes look relevant:",
      ...citations.slice(0, 4).map((entry, idx) => `- [N${idx + 1}] ${entry.note.summary || heuristicSummary(entry.note.content, 120)}`),
    ].join("\n");
    return {
      answer,
      citations,
      mode: "fallback",
    };
  }
}

export async function buildProjectContext({ task, project = "", limit = 8 }) {
  const normalizedTask = String(task || "").trim();
  const citations = await searchMemories({ query: normalizedTask || project || "recent", project, limit });
  if (citations.length === 0) {
    return {
      context: "No project context found yet.",
      citations: [],
      mode: "empty",
    };
  }

  if (!hasOpenAI()) {
    return {
      context: citations
        .map((entry, idx) => `[N${idx + 1}] ${entry.note.summary || heuristicSummary(entry.note.content, 120)}`)
        .join("\n"),
      citations,
      mode: "heuristic",
    };
  }

  try {
    const contextBlock = buildCitationBlock(citations);
    const { text } = await createResponse({
      instructions:
        "Build a short project context brief (decisions, open questions, next actions) from the notes. Cite snippets as [N1], [N2], etc.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Task: ${normalizedTask || "Build project context"}\n\nSnippets:\n${contextBlock}`,
            },
          ],
        },
      ],
      temperature: 0.2,
    });

    return {
      context: text || "No context generated.",
      citations,
      mode: "openai",
    };
  } catch {
    return {
      context: citations
        .map((entry, idx) => `[N${idx + 1}] ${entry.note.summary || heuristicSummary(entry.note.content, 120)}`)
        .join("\n"),
      citations,
      mode: "fallback",
    };
  }
}

export async function ingestProcessedMarkdown({
  filename,
  markdown,
  sourcePath = "",
  externalSourceId = "",
  metadata = {},
  agentfsUri = null,
}) {
  const normalizedFilename = String(filename || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();

  const { sourceId, normalizedExternalSourceId, sourceIdStrategy } = buildSourceId({
    normalizedFilename,
    externalSourceId,
  });

  if (!normalizedFilename && !normalizedExternalSourceId) {
    throw new Error("Missing filename or externalSourceId");
  }

  const strictMarkdown = String(markdown || "").replace(/\r\n/g, "\n");
  if (!strictMarkdown.trim()) {
    throw new Error("Missing markdown");
  }

  const fuzzyMarkdown = strictMarkdown
    .toLowerCase()
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const checksum = crypto.createHash("sha256").update(strictMarkdown, "utf8").digest("hex");
  const fuzzyHash = crypto.createHash("sha256").update(fuzzyMarkdown, "utf8").digest("hex");
  const createdAt = nowIso();

  const source = projectMemoryRepo.upsertSource({
    sourceId,
    sourceFilename: normalizedFilename ? path.basename(normalizedFilename) : normalizedExternalSourceId,
    sourcePath: sourcePath || normalizedFilename || null,
    sourceKind: "markdown",
    checksum,
    seenAt: createdAt,
    metadata: {
      ...metadata,
      ingestionMethod: "pipeline",
      sourceIdStrategy,
      externalSourceId: normalizedExternalSourceId || null,
    },
  });

  const versionResult = projectMemoryRepo.createVersionIfChanged({
    sourceId,
    checksum,
    fuzzyHash,
    contentMarkdown: strictMarkdown,
    agentfsUri,
    contentBytes: Buffer.byteLength(strictMarkdown, "utf8"),
    createdAt,
    metadata: {
      ...metadata,
      ingestedAt: createdAt,
    },
  });

  const existingForSource = projectMemoryRepo.listMemoryRecordsBySource(sourceId);
  const existingExtracted = existingForSource.filter((row) => isExtractedAtomicMemory(row));
  const hasLegacyDocumentMemory = existingForSource.some((row) => row.memoryId === sourceId);
  if (!versionResult.changed && existingExtracted.length > 0 && !hasLegacyDocumentMemory) {
    return {
      source,
      memory: existingExtracted[0],
      extractedMemories: existingExtracted,
      extractedCount: existingExtracted.length,
      extractionRunId: null,
      version: versionResult.row,
      changed: versionResult.changed,
      extractionSkipped: true,
    };
  }

  const extractionRunStartedAt = nowIso();
  const extractionRunId = projectMemoryRepo.startExtractionRun({
    sourceId,
    sourceVersion: versionResult.version,
    model: EXTRACTOR_MODEL,
    startedAt: extractionRunStartedAt,
    metadata: {
      sourceFilename: source.sourceFilename,
      sourceIdStrategy,
      externalSourceId: normalizedExternalSourceId || null,
      changed: versionResult.changed,
    },
  });

  let extraction;
  try {
    const extractedByAgent = await extractAtomicMemoriesViaAgent({
      sourceId,
      sourceFilename: source.sourceFilename,
      sourceVersion: versionResult.version,
      markdown: strictMarkdown,
    });

    extraction = await applyExtractedMemories({
      sourceId,
      sourceVersion: versionResult.version,
      extractedMemories: extractedByAgent,
      allowEmpty: false,
      metadata: {
        ...metadata,
        sourceIdStrategy,
        externalSourceId: normalizedExternalSourceId || null,
      },
    });

    projectMemoryRepo.finishExtractionRun({
      runId: extractionRunId,
      status: "success",
      finishedAt: nowIso(),
      extractedCount: extraction.extractedCount,
      metadata: {
        sourceFilename: source.sourceFilename,
      },
    });
  } catch (error) {
    projectMemoryRepo.finishExtractionRun({
      runId: extractionRunId,
      status: "failed",
      finishedAt: nowIso(),
      extractedCount: 0,
      errorText: error instanceof Error ? error.message : String(error),
      metadata: {
        sourceFilename: source.sourceFilename,
      },
    });
    throw error;
  }

  return {
    source,
    memory: extraction.extractedMemories[0] || null,
    extractedMemories: extraction.extractedMemories,
    extractedCount: extraction.extractedCount,
    extractionRunId,
    version: versionResult.row,
    changed: versionResult.changed,
  };
}

export async function listMemoryRecords(limit = 50) {
  return projectMemoryRepo.listMemoryRecords(clampInt(limit, 1, 500, 50));
}

export async function exportMemoriesDateRangeMarkdown({
  startDate,
  endDate,
  limit = 2000,
  outputDir = path.join(config.dataDir, "exports"),
} = {}) {
  const startIso = parseRangeDate(startDate, { fieldName: "startDate" });
  const endIso = parseRangeDate(endDate, { fieldName: "endDate", endOfDay: true });
  if (new Date(startIso).getTime() > new Date(endIso).getTime()) {
    throw new Error(`startDate must be <= endDate (startDate=${startIso}, endDate=${endIso})`);
  }

  const rows = projectMemoryRepo.listMemoryRecordsByUpdatedRange({
    startIso,
    endIso,
    limit: clampInt(limit, 1, 5000, 2000),
  });

  const groups = new Map();
  for (const row of rows) {
    const summary = normalizeSentence(row.effectiveSummary || row.summaryAuto || "", 800);
    if (!summary) continue;

    const kind = String(row.metadata?.extractedKind || "inbox").toLowerCase();
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({
      summary,
      sourceFilename: row.metadata?.sourceFilename || "(unknown)",
      updatedAt: row.updatedAt,
      confidence: Number.isFinite(Number(row.metadata?.extractionConfidence))
        ? Number(row.metadata?.extractionConfidence)
        : null,
      tags: Array.isArray(row.effectiveTags) ? row.effectiveTags.filter(Boolean) : [],
    });
  }
  for (const groupRows of groups.values()) {
    groupRows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  const orderedKinds = [...groups.keys()].sort((a, b) => {
    const ai = TOP_LEVEL_KIND_ORDER.indexOf(a);
    const bi = TOP_LEVEL_KIND_ORDER.indexOf(b);
    const left = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const right = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    return left - right || a.localeCompare(b);
  });

  const generatedAt = nowIso();
  const lines = [
    "# Agent Memory Brief",
    "",
    "Compact long-term memory context for assistant prompting.",
    "",
    "## Scope",
    `- Range (UTC): ${startIso} to ${endIso}`,
    `- Generated At (UTC): ${generatedAt}`,
    `- Memory Statements: ${rows.length}`,
    "",
  ];

  if (rows.length === 0) {
    lines.push("No memories found in this date range.");
    lines.push("");
  } else {
    for (const kind of orderedKinds) {
      const kindRows = groups.get(kind) || [];
      const seen = new Set();
      const uniqueRows = [];
      for (const row of kindRows) {
        const key = row.summary.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueRows.push(row);
      }

      const tagCounts = new Map();
      for (const row of uniqueRows) {
        for (const tag of row.tags) {
          const normalizedTag = String(tag || "")
            .trim()
            .toLowerCase();
          if (!normalizedTag) continue;
          tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) || 0) + 1);
        }
      }
      const topics = [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([tag]) => tag);

      lines.push(`## ${titleCaseKind(kind)}`);
      if (topics.length > 0) {
        lines.push(`Topics: ${topics.map((tag) => `\`${tag}\``).join(", ")}`);
      }
      lines.push("");
      for (const memory of uniqueRows) {
        const sourceSuffix = memory.sourceFilename && memory.sourceFilename !== "(unknown)"
          ? ` _(source: ${memory.sourceFilename})_`
          : "";
        const lowConfidenceSuffix = Number.isFinite(memory.confidence) && memory.confidence < 0.7
          ? " [low confidence]"
          : "";
        lines.push(`- ${memory.summary}${lowConfidenceSuffix}${sourceSuffix}`);
      }
      lines.push("");
    }
  }

  const markdown = `${lines.join("\n").trim()}\n`;
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `memory-export-${isoSlug(startIso)}-to-${isoSlug(endIso)}-${isoSlug(generatedAt)}.md`
  );
  await fs.writeFile(filePath, markdown, "utf8");

  return {
    startIso,
    endIso,
    generatedAt,
    count: rows.length,
    filePath,
    markdown,
  };
}

const CATEGORY_ID_BY_SLUG = {
  preferences: "cat_preferences",
  people: "cat_people",
  commitments: "cat_commitments",
  decisions: "cat_decisions",
  knowledge: "cat_knowledge",
  resources: "cat_resources",
  events: "cat_events",
  inbox: "cat_inbox",
};

function categoryIdForBucket(bucket) {
  return CATEGORY_ID_BY_SLUG[String(bucket || "").toLowerCase()] || CATEGORY_ID_BY_SLUG.inbox;
}

function normalizeSentence(text, maxLen = 280) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function findCitationOffsets(markdown, evidenceText, statement) {
  const baseText = String(markdown || "");
  const target = String(evidenceText || statement || "").trim();
  if (!target) return { startOffset: null, endOffset: null };
  const idx = baseText.toLowerCase().indexOf(target.toLowerCase());
  if (idx === -1) return { startOffset: null, endOffset: null };
  return {
    startOffset: idx,
    endOffset: idx + target.length,
  };
}

function extractionFingerprint(kind, statement) {
  const stable = `${String(kind || "").toLowerCase()}|${normalizeSentence(statement, 500).toLowerCase()}`;
  return crypto.createHash("sha256").update(stable, "utf8").digest("hex");
}

function extractedMemoryId(sourceId, fingerprint) {
  const stable = `${sourceId}|${fingerprint}`;
  return crypto.createHash("sha256").update(stable, "utf8").digest("hex");
}

function normalizeTagList(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function isExtractedAtomicMemory(memoryRow) {
  return String(memoryRow?.metadata?.memoryKind || "") === "extracted_atomic_memory";
}

async function extractAtomicMemoriesViaAgent({ sourceId, sourceFilename, sourceVersion, markdown }) {
  let module;
  try {
    module = await import("../mastra/agents.js");
  } catch (error) {
    throw new Error(
      `Mastra extraction layer unavailable. Ensure Mastra deps are installed before ingestion. Root cause: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (typeof module.runMemoryExtractorAgent !== "function") {
    throw new Error("Mastra extraction function runMemoryExtractorAgent is not defined.");
  }

  const result = await module.runMemoryExtractorAgent({
    sourceId,
    sourceFilename,
    sourceVersion,
    markdown,
  });

  if (!Array.isArray(result?.memories)) {
    throw new Error("Extractor agent returned invalid response: missing memories array.");
  }

  return result.memories;
}

export async function loadSourceVersionForExtraction({ sourceId, sourceVersion = null }) {
  const source = projectMemoryRepo.getSourceById(sourceId);
  if (!source) {
    throw new Error(`Unknown source_id: ${sourceId}`);
  }

  const versionRow =
    sourceVersion === null || sourceVersion === undefined
      ? projectMemoryRepo.getLatestVersion(sourceId)
      : projectMemoryRepo.getSourceVersion(sourceId, Number(sourceVersion));

  if (!versionRow) {
    throw new Error(`Source version not found for source_id=${sourceId} version=${String(sourceVersion ?? "latest")}`);
  }

  return {
    source,
    version: versionRow,
  };
}

export async function applyExtractedMemories({
  sourceId,
  sourceVersion,
  extractedMemories = [],
  metadata = {},
  allowEmpty = false,
} = {}) {
  const { source, version } = await loadSourceVersionForExtraction({ sourceId, sourceVersion });
  const existingForSource = projectMemoryRepo.listMemoryRecordsBySource(sourceId);
  const keepMemoryIds = new Set();
  const persistedMemories = [];
  const now = nowIso();
  const markdown = version.contentMarkdown || "";

  for (const row of extractedMemories) {
    const statement = normalizeSentence(row?.statement, 600);
    const kind = String(row?.kind || "").toLowerCase().trim();
    if (!statement || statement.length < 10 || !kind) continue;

    const fingerprint = extractionFingerprint(kind, statement);
    const memoryId = extractedMemoryId(sourceId, fingerprint);
    if (keepMemoryIds.has(memoryId)) continue;
    keepMemoryIds.add(memoryId);

    const citation = findCitationOffsets(markdown, row?.evidenceText, statement);
    const tags = normalizeTagList(row?.tags);
    const existing = existingForSource.find((item) => item.memoryId === memoryId);

    const persisted = projectMemoryRepo.upsertMemoryRecord({
      memoryId,
      sourceId,
      latestVersion: version.version,
      summaryAuto: statement,
      tagsAuto: tags,
      linksAuto: [],
      effectiveTitle: row?.title ? String(row.title).slice(0, 140) : null,
      effectiveSummary: statement,
      effectiveTags: tags,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      metadata: {
        ...metadata,
        sourceFilename: source.sourceFilename,
        sourceVersion: version.version,
        memoryKind: "extracted_atomic_memory",
        extractedKind: kind,
        extractionModel: EXTRACTOR_MODEL,
        extractedAt: now,
        extractionFingerprint: fingerprint,
        extractionConfidence: Number.isFinite(Number(row?.confidence)) ? Number(row.confidence) : null,
        citation: {
          sourceId,
          sourceFilename: source.sourceFilename,
          version: version.version,
          startOffset: citation.startOffset,
          endOffset: citation.endOffset,
        },
      },
    });

    projectMemoryRepo.replaceMemoryCategoriesBySource({
      memoryId,
      assignmentSource: "extractor_agent",
      assignments: [
        {
          categoryId: categoryIdForBucket(kind),
          confidence: Number.isFinite(Number(row?.confidence)) ? Number(row.confidence) : null,
          reason: "extractor_agent_kind",
        },
      ],
      assignedAt: now,
    });

    projectMemoryRepo.replaceMemoryEvidence({
      memoryId,
      sourceId,
      sourceVersion: version.version,
      createdAt: now,
      evidenceItems: [
        {
          startOffset: citation.startOffset,
          endOffset: citation.endOffset,
          evidenceText: row?.evidenceText ? normalizeSentence(row.evidenceText, 400) : statement,
          metadata: {
            extractedKind: kind,
            confidence: Number.isFinite(Number(row?.confidence)) ? Number(row.confidence) : null,
          },
        },
      ],
    });

    persistedMemories.push(persisted);
  }

  if (!allowEmpty && persistedMemories.length === 0) {
    throw new Error("Extractor produced zero atomic memories; refusing to erase existing memories.");
  }

  for (const existing of existingForSource) {
    if (existing.memoryId === sourceId) continue;
    if (isExtractedAtomicMemory(existing) && !keepMemoryIds.has(existing.memoryId)) {
      projectMemoryRepo.deleteMemoryRecord(existing.memoryId);
    }
  }

  // Always remove the legacy one-row-per-document memory representation.
  projectMemoryRepo.deleteMemoryRecord(sourceId);

  return {
    source,
    version,
    extractedMemories: persistedMemories,
    extractedCount: persistedMemories.length,
  };
}

export async function getMemoryDecisionBatch(limit = 200) {
  const rows = await listMemoryRecords(limit);
  return rows.map((row) => ({
    memoryId: row.memoryId,
    sourceId: row.sourceId,
    latestVersion: row.latestVersion,
    effectiveTitle: row.effectiveTitle,
    effectiveSummary: row.effectiveSummary,
    effectiveTags: row.effectiveTags,
    metadata: row.metadata,
  }));
}

export async function applyOrganizerDecisions({
  categoryAssignments = [],
  relatedLinks = [],
  assignmentSource = "organizer_agent",
  relationType = "related",
} = {}) {
  const appliedAt = nowIso();
  let appliedCategoryCount = 0;
  let appliedRelationCount = 0;

  for (const assignment of categoryAssignments) {
    const memoryId = String(assignment?.memoryId || "").trim();
    if (!memoryId) continue;
    const categoryId = String(assignment?.categoryId || "").trim() || categoryIdForBucket(assignment?.bucket);
    projectMemoryRepo.replaceMemoryCategoriesBySource({
      memoryId,
      assignmentSource,
      assignments: [
        {
          categoryId,
          confidence: Number.isFinite(Number(assignment?.confidence)) ? Number(assignment.confidence) : null,
          reason: assignment?.reason ? String(assignment.reason) : null,
        },
      ],
      assignedAt: appliedAt,
    });
    appliedCategoryCount += 1;
  }

  for (const link of relatedLinks) {
    const leftId = String(link?.memoryId || "").trim();
    const rightId = String(link?.relatedMemoryId || "").trim();
    if (!leftId || !rightId || leftId === rightId) continue;
    const confidence = Number.isFinite(Number(link?.confidence)) ? Number(link.confidence) : null;
    const reason = link?.reason ? String(link.reason) : null;
    projectMemoryRepo.upsertRelatedMemory({
      memoryId: leftId,
      relatedMemoryId: rightId,
      relationType,
      confidence,
      reason,
      linkedAt: appliedAt,
    });
    projectMemoryRepo.upsertRelatedMemory({
      memoryId: rightId,
      relatedMemoryId: leftId,
      relationType,
      confidence,
      reason,
      linkedAt: appliedAt,
    });
    appliedRelationCount += 2;
  }

  return {
    appliedCategoryCount,
    appliedRelationCount,
  };
}

export async function applyConsolidatorAliasProposals({
  aliasProposals = [],
  proposalSource = "consolidator_agent",
  defaultIsActive = false,
} = {}) {
  const rows = await listMemoryRecords(1000);
  const sourceIdByMemoryId = new Map(rows.map((row) => [row.memoryId, row.sourceId]));
  const updatedAt = nowIso();
  let appliedAliasCount = 0;

  for (const proposal of aliasProposals) {
    const canonicalSourceId =
      String(proposal?.canonicalSourceId || "").trim() ||
      sourceIdByMemoryId.get(String(proposal?.canonicalMemoryId || "").trim());
    const aliasSourceId =
      String(proposal?.aliasSourceId || "").trim() ||
      sourceIdByMemoryId.get(String(proposal?.aliasMemoryId || "").trim());

    if (!canonicalSourceId || !aliasSourceId || canonicalSourceId === aliasSourceId) {
      continue;
    }

    const confidence = Number.isFinite(Number(proposal?.confidence)) ? Number(proposal.confidence) : null;
    const reasonParts = [proposalSource, proposal?.reason ? String(proposal.reason).trim() : ""].filter(Boolean);
    projectMemoryRepo.upsertSourceAlias({
      aliasSourceId,
      canonicalSourceId,
      reason: reasonParts.join(":"),
      confidence,
      isActive: proposal?.isActive === undefined ? defaultIsActive : Boolean(proposal.isActive),
      updatedAt,
    });
    appliedAliasCount += 1;
  }

  return {
    appliedAliasCount,
  };
}
