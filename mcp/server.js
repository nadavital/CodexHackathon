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
    name: "project_memory_search",
    description: "Search saved memories by semantic similarity and lexical match.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Optional project filter" },
        limit: { type: "number", description: "Max results", default: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "project_memory_search_raw_content",
    description: "Search extracted raw/markdown content with lexical ranking.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Optional project filter" },
        includeMarkdown: { type: "boolean", description: "Include markdown content in response", default: true },
        limit: { type: "number", description: "Max results", default: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "project_memory_get_raw_content",
    description: "Get full extracted raw/markdown content by memory id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id" },
        includeMarkdown: { type: "boolean", default: true },
        maxChars: { type: "number", default: 12000 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "project_memory_read_extracted_markdown",
    description: "Read the consolidated markdown memory file.",
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
    name: "project_memory_save",
    description: "Save a new memory note/link/image/file metadata.",
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
  {
    name: "project_memory_recent",
    description: "Get recent saved memories.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "project_memory_context",
    description: "Build a grounded project context brief with citations.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task to build context for" },
        project: { type: "string" },
        limit: { type: "number", default: 8 },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "project_memory_ask",
    description: "Ask a grounded question over memory with citations.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        project: { type: "string" },
        limit: { type: "number", default: 6 },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "project_memory_tasks_list_open",
    description: "List open tasks from the local task store.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

function sendMessage(payload) {
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json, "utf8");
  process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${json}`);
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
    case "project_memory_search": {
      const results = await searchMemories({
        query: String(args.query || ""),
        project: String(args.project || ""),
        limit: Number(args.limit || 8),
      });
      return { results };
    }
    case "project_memory_search_raw_content": {
      const results = await searchRawMemories({
        query: String(args.query || ""),
        project: String(args.project || ""),
        includeMarkdown: args.includeMarkdown !== false,
        limit: Number(args.limit || 8),
      });
      return { results };
    }
    case "project_memory_get_raw_content": {
      const note = await getMemoryRawContent({
        id: String(args.id || ""),
        includeMarkdown: args.includeMarkdown !== false,
        maxChars: Number(args.maxChars || 12000),
      });
      return { note };
    }
    case "project_memory_read_extracted_markdown": {
      const memoryFile = await readExtractedMarkdownMemory({
        filePath: String(args.filePath || ""),
        maxChars: Number(args.maxChars || 30000),
      });
      return { memoryFile };
    }
    case "project_memory_save": {
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
    case "project_memory_recent": {
      const notes = await listRecentMemories(Number(args.limit || 10));
      return { notes };
    }
    case "project_memory_context": {
      const context = await buildProjectContext({
        task: String(args.task || ""),
        project: String(args.project || ""),
        limit: Number(args.limit || 8),
      });
      return context;
    }
    case "project_memory_ask": {
      const answer = await askMemories({
        question: String(args.question || ""),
        project: String(args.project || ""),
        limit: Number(args.limit || 6),
      });
      return answer;
    }
    case "project_memory_tasks_list_open": {
      const tasks = taskRepo.listOpenTasks();
      return { tasks };
    }
    // Legacy aliases kept for backward compatibility with early backend prototypes.
    case "personio_tasks_list_open":
      return callTool("project_memory_tasks_list_open", args);
    case "personio_notes_search": {
      const searchMode = String(args.searchMode || "semantic").trim().toLowerCase();
      if (searchMode === "raw") {
        return callTool("project_memory_search_raw_content", args);
      }
      return callTool("project_memory_search", args);
    }
    case "personio_get_memory_file":
      return callTool("project_memory_read_extracted_markdown", args);
    case "personio_memory_save_tool":
      return callTool("project_memory_save", args);
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
