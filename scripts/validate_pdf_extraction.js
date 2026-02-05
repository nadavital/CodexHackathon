import { getMemoryRawContent } from "../src/memoryService.js";

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/validate_pdf_extraction.js <note-id>");
  process.exit(1);
}

const note = await getMemoryRawContent({ id, includeMarkdown: true, maxChars: 30000 });

const ok = Boolean(note && (note.rawContent || "").length > 0 && (note.markdownContent || "").length > 0);

console.log(
  JSON.stringify(
    {
      id,
      ok,
      fileName: note.fileName,
      fileMime: note.fileMime,
      rawChars: (note.rawContent || "").length,
      markdownChars: (note.markdownContent || "").length,
    },
    null,
    2
  )
);

if (!ok) process.exit(2);
