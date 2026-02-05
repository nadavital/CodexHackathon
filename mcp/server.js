import process from "node:process";
import { config } from "../src/config.js";
import { taskRepo } from "../src/tasksDb.js";
import {
  askMemories,
  buildProjectContext,
  createMemory,
  getMemoryRawContent,
  listRecentMemories,
  readExtractedMarkdownMemory,
  searchRawMemories,
  searchMemories,
} from "../src/memoryService.js";

const PROTOCOL_VERSION = "2024-11-05";

const TOOL_DEFS = [
  {
    name: "personio_tasks_list_open",
    description: "Return open tasks in descending created order.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "personio_notes_search",
    description: "Search notes by semantic ranking or raw extracted content.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        searchMode: {
          type: "string",
          enum: ["semantic", "raw"],
          default: "semantic",
          description: "semantic = ranked note search, raw = extracted raw/markdown search",
        },
        project: { type: "string", description: "Optional project filter" },
        limit: { type: "number", description: "Max results", default: 8 },
        includeMarkdown: { type: "boolean", description: "Include markdown content in raw responses", default: true },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "personio_get_memory_file",
    description: "Return the single consolidated memory markdown file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Optional absolute/relative path override" },
        maxChars: { type: "number", description: "Maximum characters to return", default: 30000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "personio_memory_save_tool",
    description: "Save a new memory note/link/upload metadata.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Note content" },
        sourceType: { type: "string", enum: ["text", "link", "image", "file"], default: "text" },
        sourceUrl: { type: "string", description: "Source URL for link captures" },
        fileDataUrl: { type: "string", description: "Optional data URL for uploaded file bytes" },
        fileName: { type: "string", description: "Uploaded file name" },
        fileMimeType: { type: "string", description: "Uploaded file MIME type" },
        project: { type: "string", description: "Optional project label" },
      },
      additionalProperties: false,
    },
  },
];

// MCP stdio expects newline-delimited JSON-RPC messages on stdout.
function sendMessage(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function sendError(id, code, message, data = undefined) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function sendResult(id, result) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

async function callTool(name, args = {}) {
  switch (name) {
    case "personio_tasks_list_open": {
      const tasks = taskRepo.listOpenTasks();
      return { tasks };
    }
    case "personio_notes_search": {
      const searchMode = String(args.searchMode || "semantic").trim().toLowerCase();
      if (searchMode === "raw") {
        const results = await searchRawMemories({
          query: String(args.query || ""),
          project: String(args.project || ""),
          includeMarkdown: args.includeMarkdown !== false,
          limit: Number(args.limit || 8),
        });
        return { results, searchMode };
      }
      const results = await searchMemories({
        query: String(args.query || ""),
        project: String(args.project || ""),
        limit: Number(args.limit || 8),
      });
      return { results, searchMode: "semantic" };
    }
    case "personio_get_memory_file": {
      const memoryFile = await readExtractedMarkdownMemory({
        filePath: String(args.filePath || ""),
        maxChars: Number(args.maxChars || 30000),
      });
      return { memoryFile };
    }
    case "personio_memory_save_tool": {
      const note = await createMemory({
        content: String(args.content || ""),
        sourceType: String(args.sourceType || "text"),
        sourceUrl: String(args.sourceUrl || ""),
        fileDataUrl: String(args.fileDataUrl || ""),
        fileName: String(args.fileName || ""),
        fileMimeType: String(args.fileMimeType || ""),
        project: String(args.project || ""),
        metadata: { createdFrom: "mcp" },
      });
      return { note };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: config.mcpServerName,
        version: config.mcpServerVersion,
      },
    });
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: TOOL_DEFS });
    return;
  }

  if (method === "tools/call") {
    try {
      const name = params?.name;
      const args = params?.arguments || {};
      const result = await callTool(name, args);
      sendResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    } catch (error) {
      sendResult(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Unknown error",
          },
        ],
      });
    }
    return;
  }

  if (method === "ping") {
    sendResult(id, { ok: true, serverTime: new Date().toISOString() });
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = Buffer.alloc(0);

function tryParseMessages() {
  while (true) {
    // Standard MCP/LSP framing: Content-Length headers + JSON body.
    const delimiter = buffer.indexOf("\r\n\r\n");
    if (delimiter !== -1) {
      const headerText = buffer.slice(0, delimiter).toString("utf8");
      const headers = headerText.split("\r\n");
      let contentLength = 0;

      for (const header of headers) {
        const splitIndex = header.indexOf(":");
        if (splitIndex === -1) continue;
        const key = header.slice(0, splitIndex).trim().toLowerCase();
        const value = header.slice(splitIndex + 1).trim();
        if (key === "content-length") {
          contentLength = Number(value);
        }
      }

      if (Number.isFinite(contentLength) && contentLength > 0) {
        const bodyStart = delimiter + 4;
        const bodyEnd = bodyStart + contentLength;
        if (buffer.length < bodyEnd) return;

        const bodyText = buffer.slice(bodyStart, bodyEnd).toString("utf8");
        buffer = buffer.slice(bodyEnd);

        let message;
        try {
          message = JSON.parse(bodyText);
        } catch {
          continue;
        }

        handleRequest(message).catch((error) => {
          if (message && message.id !== undefined) {
            sendError(message.id, -32603, error instanceof Error ? error.message : "Internal error");
          }
        });
        continue;
      }
    }

    // Compatibility fallback: newline-delimited JSON.
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline).toString("utf8").replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    handleRequest(message).catch((error) => {
      if (message?.id !== undefined) {
        sendError(message.id, -32603, error instanceof Error ? error.message : "Internal error");
      }
    });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  tryParseMessages();
});

process.stdin.on("error", (error) => {
  process.stderr.write(`stdin error: ${error.message}\n`);
});

process.stderr.write(`MCP server started: ${config.mcpServerName}@${config.mcpServerVersion}\n`);
