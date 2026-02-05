import process from "node:process";
import { config } from "../src/config.js";
import {
  askMemories,
  buildProjectContext,
  createMemory,
  listRecentMemories,
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
    name: "project_memory_save",
    description: "Save a new memory note/link/image metadata.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Note content" },
        sourceType: { type: "string", enum: ["text", "link", "image"], default: "text" },
        sourceUrl: { type: "string", description: "Source URL for link captures" },
        project: { type: "string", description: "Optional project label" },
      },
      required: ["content"],
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
    case "project_memory_save": {
      const note = await createMemory({
        content: String(args.content || ""),
        sourceType: String(args.sourceType || "text"),
        sourceUrl: String(args.sourceUrl || ""),
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
    if (delimiter === -1) return;

    const headerText = buffer.slice(0, delimiter).toString("utf8");
    const headers = headerText.split("\r\n");
    let contentLength = 0;

    for (const header of headers) {
      const [rawKey, rawVal] = header.split(":");
      if (!rawKey || !rawVal) continue;
      if (rawKey.toLowerCase() === "content-length") {
        contentLength = Number(rawVal.trim());
      }
    }

    if (!contentLength || buffer.length < delimiter + 4 + contentLength) {
      return;
    }

    const bodyStart = delimiter + 4;
    const bodyEnd = bodyStart + contentLength;
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
