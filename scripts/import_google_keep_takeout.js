import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { config } from "../src/config.js";
import { createMemory } from "../src/memoryService.js";

function usage() {
  console.log(`\nUsage:\n  node scripts/import_google_keep_takeout.js /path/to/Takeout [--project "Google Keep"] [--dry-run]\n\nNotes:\n- Expects Google Keep JSON exports (usually under: Takeout/Keep/*.json).\n- Creates one Project Memory note per Keep note.\n- Uses metadata.keepId to avoid duplicate imports in subsequent runs (best-effort).\n`);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeKeepText(keep) {
  const title = String(keep.title || "").trim();
  const text = String(keep.textContent || "").trim();
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (text) lines.push(text);

  const labels = Array.isArray(keep.labels) ? keep.labels.map((l) => l?.name).filter(Boolean) : [];
  if (labels.length) lines.push(`\nLabels: ${labels.join(", ")}`);

  const created = keep.createdTimestampUsec ? new Date(Number(keep.createdTimestampUsec) / 1000).toISOString() : null;
  const updated = keep.userEditedTimestampUsec ? new Date(Number(keep.userEditedTimestampUsec) / 1000).toISOString() : null;
  if (created) lines.push(`\nCreated: ${created}`);
  if (updated) lines.push(`Updated: ${updated}`);

  return lines.join("\n\n").trim();
}

async function loadExistingKeepIds() {
  // Dedupe strategy: scan notes table metadata_json for keepId.
  // Works fine for hackathon-scale DB sizes.
  const db = new DatabaseSync(config.dbPath);
  let rows = [];
  try {
    rows = db.prepare("SELECT metadata_json FROM notes WHERE metadata_json IS NOT NULL AND metadata_json <> '{}' ").all();
  } catch {
    rows = [];
  }
  const ids = new Set();
  for (const row of rows) {
    const meta = safeJsonParse(row.metadata_json);
    const keepId = meta?.keepId;
    if (keepId) ids.add(String(keepId));
  }
  db.close();
  return ids;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const takeoutPath = path.resolve(args[0]);
  const projectIdx = args.findIndex((a) => a === "--project");
  const project = projectIdx !== -1 ? String(args[projectIdx + 1] || "Google Keep").trim() : "Google Keep";
  const dryRun = args.includes("--dry-run");

  const keepDirCandidates = [
    path.join(takeoutPath, "Keep"),
    path.join(takeoutPath, "Google Keep"),
    path.join(takeoutPath, "Takeout", "Keep"),
  ];

  const keepDir = keepDirCandidates.find((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  if (!keepDir) {
    console.error(`Could not find Keep directory under: ${takeoutPath}`);
    console.error("Tried:");
    keepDirCandidates.forEach((p) => console.error(`- ${p}`));
    process.exit(1);
  }

  const files = fs
    .readdirSync(keepDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.join(keepDir, name));

  if (files.length === 0) {
    console.error(`No .json files found in: ${keepDir}`);
    process.exit(1);
  }

  const existingKeepIds = await loadExistingKeepIds();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf8");
    const keep = safeJsonParse(raw);
    if (!keep) {
      failed += 1;
      continue;
    }

    const keepId = String(keep.id || keep.noteId || "").trim();
    if (keepId && existingKeepIds.has(keepId)) {
      skipped += 1;
      continue;
    }

    const content = normalizeKeepText(keep);
    if (!content) {
      skipped += 1;
      continue;
    }

    const labels = Array.isArray(keep.labels) ? keep.labels.map((l) => l?.name).filter(Boolean) : [];

    if (dryRun) {
      imported += 1;
      continue;
    }

    try {
      await createMemory({
        content,
        sourceType: "text",
        project,
        metadata: {
          createdFrom: "google-keep-import",
          keepId: keepId || null,
          keepLabels: labels,
          keepFile: path.basename(filePath),
          keepCreatedTimestampUsec: keep.createdTimestampUsec || null,
          keepUserEditedTimestampUsec: keep.userEditedTimestampUsec || null,
        },
      });
      imported += 1;
    } catch {
      failed += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        keepDir,
        totalFiles: files.length,
        imported,
        skipped,
        failed,
        dryRun,
        project,
      },
      null,
      2
    )
  );
}

main();
