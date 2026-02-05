import crypto from "node:crypto";
import { config } from "./config.js";

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
