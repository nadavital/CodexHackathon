import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  applyExtractedMemories,
  applyConsolidatorAliasProposals,
  applyOrganizerDecisions,
  getMemoryDecisionBatch,
  loadSourceVersionForExtraction,
} from "../src/memoryService.js";
import {
  applyExtractorInputSchema,
  applyExtractorOutputSchema,
  applyConsolidatorInputSchema,
  applyConsolidatorOutputSchema,
  applyOrganizerInputSchema,
  applyOrganizerOutputSchema,
  extractorInputSchema,
  memoryRecordSchema,
} from "./schemas.js";

export const listMemoryBatchTool = createTool({
  id: "list_memory_batch",
  description: "Load a bounded memory batch for organizer/consolidator agent decisioning.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(250).default(120),
  }),
  outputSchema: z.object({
    records: z.array(memoryRecordSchema),
    processedCount: z.number().int().min(0),
  }),
  execute: async ({ context }) => {
    const records = await getMemoryDecisionBatch(context.limit);
    return {
      records,
      processedCount: records.length,
    };
  },
});

export const loadSourceVersionTool = createTool({
  id: "load_source_version_for_extraction",
  description: "Load canonical source/version markdown evidence for extraction.",
  inputSchema: extractorInputSchema
    .pick({
      sourceId: true,
      sourceVersion: true,
    })
    .partial({
      sourceVersion: true,
    }),
  outputSchema: extractorInputSchema,
  execute: async ({ context }) => {
    const loaded = await loadSourceVersionForExtraction({
      sourceId: context.sourceId,
      sourceVersion: context.sourceVersion ?? null,
    });
    return {
      sourceId: loaded.source.sourceId,
      sourceFilename: loaded.source.sourceFilename,
      sourceVersion: loaded.version.version,
      markdown: loaded.version.contentMarkdown,
    };
  },
});

export const applyExtractedMemoriesTool = createTool({
  id: "apply_extracted_memories",
  description: "Deterministically persist extracted atomic memories with evidence and categories.",
  inputSchema: applyExtractorInputSchema,
  outputSchema: applyExtractorOutputSchema,
  execute: async ({ context }) => {
    const result = await applyExtractedMemories(context);
    return {
      extractedCount: result.extractedCount,
    };
  },
});

export const applyOrganizerDecisionsTool = createTool({
  id: "apply_organizer_decisions",
  description: "Deterministically persist organizer category and relationship decisions.",
  inputSchema: applyOrganizerInputSchema,
  outputSchema: applyOrganizerOutputSchema,
  execute: async ({ context }) => applyOrganizerDecisions(context),
});

export const applyConsolidatorAliasesTool = createTool({
  id: "apply_consolidator_aliases",
  description: "Deterministically persist consolidator alias proposals.",
  inputSchema: applyConsolidatorInputSchema,
  outputSchema: applyConsolidatorOutputSchema,
  execute: async ({ context }) => applyConsolidatorAliasProposals(context),
});
