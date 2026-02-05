import {
  askMemories,
  buildProjectContext,
  createMemory,
  ingestProcessedMarkdown,
  listMemoryRecords,
  listRecentMemories,
  searchMemories,
} from "../src/memoryService.js";

async function run() {
  const [, , toolName, rawArgs] = process.argv;
  if (!toolName) {
    process.stderr.write("Usage: node openclaw/bridge.js <tool_name> '<json_args>'\n");
    process.exit(1);
  }

  let args = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      process.stderr.write("Invalid JSON args\n");
      process.exit(1);
    }
  }

  try {
    let result;
    switch (toolName) {
      case "project_memory_search":
        result = await searchMemories({
          query: String(args.query || ""),
          project: String(args.project || ""),
          limit: Number(args.limit || 8),
        });
        break;
      case "project_memory_save":
        result = await createMemory({
          content: String(args.content || ""),
          sourceType: String(args.sourceType || "text"),
          sourceUrl: String(args.sourceUrl || ""),
          project: String(args.project || ""),
          metadata: { createdFrom: "openclaw" },
        });
        break;
      case "project_memory_recent":
        result = await listRecentMemories(Number(args.limit || 10));
        break;
      case "project_memory_context":
        result = await buildProjectContext({
          task: String(args.task || ""),
          project: String(args.project || ""),
          limit: Number(args.limit || 8),
        });
        break;
      case "project_memory_ask":
        result = await askMemories({
          question: String(args.question || ""),
          project: String(args.project || ""),
          limit: Number(args.limit || 6),
        });
        break;
      case "project_memory_ingest_processed":
        result = await ingestProcessedMarkdown({
          filename: String(args.filename || ""),
          markdown: String(args.markdown || ""),
          sourcePath: String(args.sourcePath || ""),
          externalSourceId: String(args.externalSourceId || ""),
          agentfsUri: args.agentfsUri ? String(args.agentfsUri) : null,
          metadata: { createdFrom: "openclaw" },
        });
        break;
      case "project_memory_records":
        result = await listMemoryRecords(Number(args.limit || 20));
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`
    );
    process.exit(1);
  }
}

run();
