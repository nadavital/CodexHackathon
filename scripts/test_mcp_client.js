import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = "/Users/jaidevshah/CodexHackathon";
const SERVER_PATH = path.join(ROOT, "mcp/server.js");

function encodeMessage(payload) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function parseMessagesFromBuffer(buffer) {
  const messages = [];
  let remainder = buffer;

  while (true) {
    const headerEnd = remainder.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = remainder.slice(0, headerEnd).toString("utf8");
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) break;

    const contentLength = Number(m[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (remainder.length < bodyEnd) break;

    const body = remainder.slice(bodyStart, bodyEnd).toString("utf8");
    try {
      messages.push(JSON.parse(body));
    } catch {
      // skip malformed message
    }

    remainder = remainder.slice(bodyEnd);
  }

  return { messages, remainder };
}

function parseToolPayload(callResponse) {
  if (callResponse?.result?.isError) {
    return {
      ok: false,
      error: callResponse?.result?.content?.[0]?.text || "Unknown tool error",
    };
  }

  const text = callResponse?.result?.content?.[0]?.text;
  if (!text) return { ok: false, error: "Missing tool response content" };

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: `Could not parse tool response JSON: ${error.message}` };
  }
}

async function main() {
  const child = spawn("node", [SERVER_PATH], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  const responsesById = new Map();

  child.stdout.on("data", (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    const parsed = parseMessagesFromBuffer(stdoutBuffer);
    stdoutBuffer = parsed.remainder;
    for (const msg of parsed.messages) {
      if (msg?.id !== undefined) responsesById.set(msg.id, msg);
    }
  });

  child.stderr.on("data", (chunk) => {
    const line = chunk.toString("utf8").trim();
    if (line) {
      // Keep stderr visible for debugging startup issues.
      console.error(`[mcp-server] ${line}`);
    }
  });

  function waitForResponse(id, timeoutMs = 15000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (responsesById.has(id)) {
          clearInterval(timer);
          resolve(responsesById.get(id));
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for response id=${id}`));
        }
      }, 20);
    });
  }

  async function rpc(method, params) {
    const id = nextId++;
    child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
    return await waitForResponse(id);
  }

  try {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05" });
    console.log("initialize:", init.result?.serverInfo || init.error);

    const list = await rpc("tools/list", {});
    const tools = list.result?.tools || [];
    const toolNames = tools.map((t) => t.name);
    console.log("tools/list count:", toolNames.length);
    console.log("tools:", toolNames.join(", "));

    const checks = [
      { name: "project_memory_recent", args: { limit: 3 } },
      { name: "project_memory_search", args: { query: "pdf", limit: 3 } },
      { name: "project_memory_search_raw_content", args: { query: "receipt", limit: 3 } },
      { name: "project_memory_read_extracted_markdown", args: { maxChars: 200 } },
      { name: "project_memory_save", args: { content: `MCP client check ${new Date().toISOString()}`, sourceType: "text", project: "MCP Client Test" } },
      { name: "project_memory_context", args: { task: "Summarize MCP test state", limit: 3 } },
      { name: "project_memory_ask", args: { question: "What PDFs were recently ingested?", limit: 3 } },
    ];

    let rawContentTargetId = null;
    for (const check of checks) {
      const call = await rpc("tools/call", { name: check.name, arguments: check.args });
      const parsed = parseToolPayload(call);
      if (!parsed.ok) {
        console.error(`${check.name}: ERROR -> ${parsed.error}`);
        continue;
      }

      const topKeys = Object.keys(parsed.data || {});
      console.log(`${check.name}: OK keys=${topKeys.join(",")}`);

      if (check.name === "project_memory_recent") {
        const notes = parsed.data?.notes || [];
        const withRaw = notes.find((n) => typeof n.rawContent === "string" && n.rawContent.length > 0);
        rawContentTargetId = withRaw?.id || notes[0]?.id || null;
      }
    }

    if (rawContentTargetId) {
      const rawCall = await rpc("tools/call", {
        name: "project_memory_get_raw_content",
        arguments: { id: rawContentTargetId, maxChars: 600 },
      });
      const parsed = parseToolPayload(rawCall);
      if (!parsed.ok) {
        console.error(`project_memory_get_raw_content: ERROR -> ${parsed.error}`);
      } else {
        const rawLen = String(parsed.data?.note?.rawContent || "").length;
        const mdLen = String(parsed.data?.note?.markdownContent || "").length;
        console.log(`project_memory_get_raw_content: OK rawLen=${rawLen} mdLen=${mdLen}`);
      }
    } else {
      console.warn("project_memory_get_raw_content: skipped (no note id found)");
    }

    console.log("MCP client test completed.");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("MCP client test failed:", error.message);
  process.exit(1);
});
