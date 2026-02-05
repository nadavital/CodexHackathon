import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, publicUploadPath } from "./config.js";
import { noteRepo } from "./db.js";
import {
  convertUploadToMarkdown,
  createEmbedding,
  createResponse,
  hasOpenAI,
  pseudoEmbedding,
  cosineSimilarity,
  heuristicSummary,
  heuristicTags,
} from "./openai.js";

const SOURCE_TYPES = new Set(["text", "link", "image", "file"]);

function nowIso() {
  return new Date().toISOString();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
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
    bytes: Buffer.from(match[2], "base64"),
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
  const { mime, bytes } = parseDataUrl(dataUrl);
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

function parseGenericDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid file data URL");
  }
  return {
    mime: match[1],
    base64: match[2],
    bytes: Buffer.from(match[2], "base64"),
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
    note.rawContent || "",
    note.markdownContent || "",
    note.fileName || "",
    note.fileMime || "",
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
  const noteTokens = new Set(
    tokenize(
      `${note.content} ${note.rawContent || ""} ${note.markdownContent || ""} ${note.summary} ${(note.tags || []).join(" ")} ${note.project || ""} ${note.fileName || ""}`
    )
  );
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
      note.fileName ? `file_name: ${note.fileName}` : "",
      note.fileMime ? `file_mime: ${note.fileMime}` : "",
      note.content ? `content:\n${note.content}` : "",
      note.rawContent ? `raw_content:\n${note.rawContent.slice(0, 8000)}` : "",
      note.markdownContent ? `markdown_content:\n${note.markdownContent.slice(0, 8000)}` : "",
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
      fileName: note.fileName,
      fileMime: note.fileMime,
      fileSize: note.fileSize,
      rawContent: note.rawContent,
      markdownContent: note.markdownContent,
      summary: note.summary,
      tags: note.tags || [],
      project: note.project,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  };
}

export async function createMemory({
  content = "",
  sourceType = "text",
  sourceUrl = "",
  imageDataUrl = null,
  fileDataUrl = null,
  fileName = "",
  fileMimeType = "",
  project = "",
  metadata = {},
}) {
  const requestedSourceType = normalizeSourceType(sourceType);
  const normalizedSourceUrl = String(sourceUrl || "").trim();
  let normalizedContent = String(content || "").trim();
  const normalizedFileDataUrl = String(fileDataUrl || imageDataUrl || "").trim() || null;
  const normalizedFileName = String(fileName || "").trim();
  const normalizedFileMimeType = String(fileMimeType || "").trim().toLowerCase();

  let uploadMime = normalizedFileMimeType || null;
  let uploadSize = null;
  if (normalizedFileDataUrl) {
    const parsedData = parseGenericDataUrl(normalizedFileDataUrl);
    uploadMime = uploadMime || parsedData.mime;
    uploadSize = parsedData.bytes.length;
  }

  const normalizedSourceType =
    normalizedFileDataUrl && uploadMime
      ? uploadMime.startsWith("image/")
        ? "image"
        : "file"
      : requestedSourceType;

  if (!normalizedContent && normalizedSourceUrl) {
    normalizedContent = normalizedSourceUrl;
  }

  let imageData = null;
  if (normalizedFileDataUrl && uploadMime?.startsWith("image/")) {
    imageData = await saveImageDataUrl(normalizedFileDataUrl);
  }

  let rawContent = null;
  let markdownContent = null;
  if (normalizedFileDataUrl) {
    const parsedUpload = await convertUploadToMarkdown({
      fileDataUrl: normalizedFileDataUrl,
      fileName: normalizedFileName || `upload.${uploadMime?.split("/")[1] || "bin"}`,
      fileMimeType: uploadMime || "application/octet-stream",
    });
    rawContent = parsedUpload.rawContent || null;
    markdownContent = parsedUpload.markdownContent || null;
  }

  if (!normalizedContent && markdownContent) {
    normalizedContent = markdownContent.slice(0, 12000).trim();
  }
  if (!normalizedContent && rawContent) {
    normalizedContent = rawContent.slice(0, 12000).trim();
  }

  if (!normalizedContent && !normalizedFileDataUrl && !imageData) {
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
    fileName: normalizedFileName || null,
    fileMime: uploadMime || null,
    fileSize: uploadSize,
    rawContent,
    markdownContent,
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
      fileMime: uploadMime || null,
      fileSize: uploadSize,
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
