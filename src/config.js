import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT_DIR, ".env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const splitAt = trimmed.indexOf("=");
    if (splitAt === -1) {
      continue;
    }
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(ENV_FILE);

const DATA_DIR = path.join(ROOT_DIR, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function parsePort(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDataPath(value, fallbackAbsolutePath) {
  if (!value) return fallbackAbsolutePath;
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

export const config = {
  port: parsePort(process.env.PORT, 8787),
  openaiApiKey:
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_key_here"
      ? process.env.OPENAI_API_KEY
      : "",
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  dbPath: path.join(DATA_DIR, "project-memory.db"),
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  mcpServerName: process.env.MCP_SERVER_NAME || "project-memory",
  mcpServerVersion: process.env.MCP_SERVER_VERSION || "0.1.0",
  consolidatedMemoryMarkdownFile: resolveDataPath(
    process.env.CONSOLIDATED_MEMORY_MARKDOWN_FILE,
    path.join(DATA_DIR, "consolidated-memory.md")
  ),
  extractedMemoryMarkdownFile: resolveDataPath(
    process.env.EXTRACTED_MEMORY_MARKDOWN_FILE,
    path.join(DATA_DIR, "extracted-memory.md")
  ),
};

export function publicUploadPath(fileName) {
  return `/uploads/${fileName}`;
}
