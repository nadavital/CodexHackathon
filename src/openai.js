import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export function hasOpenAI() {
  return Boolean(config.openaiApiKey);
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.openaiApiKey}`,
  };
}

function normalizeInput(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return [
      {
        role: "user",
        content: [{ type: "input_text", text: input }],
      },
    ];
  }
  return input;
}

export function extractOutputText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") continue;
      const content = item.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (typeof part.text === "string") {
          chunks.push(part.text);
        } else if (part.type === "output_text" && typeof part?.content === "string") {
          chunks.push(part.content);
        }
      }
    }
  }

  return chunks.join("\n").trim();
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

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  return {
    mime: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

function isUnsupportedFileError(error) {
  const msg = error instanceof Error ? error.message : String(error || "");
  return msg.includes("unsupported_file");
}

async function extractDocxTextViaTextutil(fileDataUrl, fileName) {
  const { bytes } = parseDataUrl(fileDataUrl);
  const safeName = path.basename(fileName || "upload.docx");
  const tempPath = path.join(os.tmpdir(), `pm-${crypto.randomUUID()}-${safeName}`);
  await fs.writeFile(tempPath, bytes);
  try {
    const { stdout } = await execFileAsync("textutil", ["-convert", "txt", "-stdout", tempPath], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return String(stdout || "").trim();
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function createResponse({ input, instructions, model = config.openaiChatModel, temperature = 0.2 }) {
  if (!hasOpenAI()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const payload = {
    model,
    input: normalizeInput(input),
    instructions,
    temperature,
  };

  const response = await fetch(`${config.openaiBaseUrl}/responses`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Responses API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    raw: data,
    text: extractOutputText(data),
  };
}

export async function createEmbedding(input, model = config.openaiEmbeddingModel) {
  if (!hasOpenAI()) {
    return pseudoEmbedding(input);
  }

  const response = await fetch(`${config.openaiBaseUrl}/embeddings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      input,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Embeddings API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error("Embeddings API returned no vector");
  }
  return vector;
}

export async function convertUploadToMarkdown({
  fileDataUrl,
  fileName = "upload.bin",
  fileMimeType = "application/octet-stream",
}) {
  if (!hasOpenAI()) {
    throw new Error("OPENAI_API_KEY is required for file upload parsing");
  }

  const isImage = String(fileMimeType).toLowerCase().startsWith("image/");
  const uploadPart = isImage
    ? {
        type: "input_image",
        image_url: fileDataUrl,
      }
    : {
        type: "input_file",
        filename: fileName,
        file_data: fileDataUrl,
      };

  const convertInstructions =
    "Extract the uploaded file into markdown. Return JSON only with keys: rawContent (plain text extraction), markdownContent (well-structured markdown). Do not wrap in code fences.";

  let rawContent = "";
  let markdownContent = "";
  try {
    const { text } = await createResponse({
      instructions: convertInstructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Convert this file to markdown.\nfile_name: ${fileName}\nfile_mime_type: ${fileMimeType}`,
            },
            uploadPart,
          ],
        },
      ],
      temperature: 0,
    });

    const parsed = parseJsonObject(text);
    rawContent = typeof parsed?.rawContent === "string" ? parsed.rawContent.trim() : "";
    markdownContent = typeof parsed?.markdownContent === "string" ? parsed.markdownContent.trim() : "";
  } catch (error) {
    const isDocx =
      fileMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileMimeType === "application/msword" ||
      /\.docx?$/i.test(fileName);
    if (!isDocx || !isUnsupportedFileError(error)) {
      throw error;
    }

    const extractedText = await extractDocxTextViaTextutil(fileDataUrl, fileName);
    if (!extractedText) {
      throw new Error("DOCX text extraction failed");
    }

    const { text } = await createResponse({
      instructions: convertInstructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Convert this extracted document text to markdown.\nfile_name: ${fileName}\nfile_mime_type: ${fileMimeType}\n\n${extractedText}`,
            },
          ],
        },
      ],
      temperature: 0,
    });
    const parsed = parseJsonObject(text);
    rawContent = typeof parsed?.rawContent === "string" ? parsed.rawContent.trim() : extractedText;
    markdownContent = typeof parsed?.markdownContent === "string" ? parsed.markdownContent.trim() : extractedText;
  }

  if (!rawContent && !markdownContent) {
    throw new Error("Could not parse uploaded file into raw/markdown content");
  }

  return {
    rawContent: rawContent || markdownContent,
    markdownContent: markdownContent || rawContent,
  };
}

export function pseudoEmbedding(input, dims = 256) {
  const vector = new Array(dims).fill(0);
  const tokens = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    const hash = crypto.createHash("sha256").update(token).digest();
    const a = hash.readUInt32BE(0) % dims;
    const b = hash.readUInt32BE(4) % dims;
    vector[a] += 1;
    vector[b] += 0.5;
  }

  return normalizeVector(vector);
}

export function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((acc, n) => acc + n * n, 0));
  if (norm === 0) return vector;
  return vector.map((n) => n / norm);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / Math.sqrt(magA * magB);
}

export function heuristicSummary(text, maxLen = 220) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No content";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 3)}...`;
}

export function heuristicTags(text, maxTags = 6) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "about",
    "have",
    "what",
    "when",
    "where",
    "which",
    "your",
    "you",
    "our",
    "are",
    "was",
    "were",
    "will",
    "can",
    "not",
  ]);

  const counts = new Map();
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags)
    .map(([token]) => token);
}
