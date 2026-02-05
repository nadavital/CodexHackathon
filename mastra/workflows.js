import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { runMemoryConsolidatorAgent, runMemoryExtractorAgent, runMemoryOrganizerAgent } from "./agents.js";
import {
  consolidatorDecisionSchema,
  extractorDecisionSchema,
  extractorInputSchema,
  memoryRecordSchema,
  organizerDecisionSchema,
} from "./schemas.js";
import {
  applyConsolidatorAliasesTool,
  applyExtractedMemoriesTool,
  applyOrganizerDecisionsTool,
  listMemoryBatchTool,
  loadSourceVersionTool,
} from "./tools.js";

const workflowInputSchema = z.object({
  limit: z.number().int().min(1).max(250).default(120),
});
const memoryBatchOutputSchema = z.object({
  records: z.array(memoryRecordSchema),
  processedCount: z.number().int().min(0),
});
const extractionWorkflowInputSchema = z.object({
  sourceId: z.string().min(1),
  sourceVersion: z.number().int().min(1).optional(),
});
const extractionAgentOutputSchema = z.object({
  sourceId: z.string().min(1),
  sourceVersion: z.number().int().min(1),
  memories: extractorDecisionSchema.shape.memories,
  summary: extractorDecisionSchema.shape.summary.optional(),
});

const extractionLoadStep = createStep({
  id: "extraction-load-source-version",
  description: "Load source markdown evidence for memory extraction.",
  inputSchema: extractionWorkflowInputSchema,
  outputSchema: extractorInputSchema,
  execute: async ({ inputData }) =>
    loadSourceVersionTool.execute({
      context: {
        sourceId: inputData.sourceId,
        sourceVersion: inputData.sourceVersion,
      },
    }),
});

const extractionAgentStep = createStep({
  id: "extraction-agent-decision",
  description: "Extract atomic memories from source markdown.",
  inputSchema: extractorInputSchema,
  outputSchema: extractionAgentOutputSchema,
  execute: async ({ inputData }) => {
    const decision = await runMemoryExtractorAgent(inputData);
    return {
      sourceId: inputData.sourceId,
      sourceVersion: inputData.sourceVersion,
      memories: decision.memories,
      summary: decision.summary,
    };
  },
});

const extractionApplyStep = createStep({
  id: "extraction-apply-memories",
  description: "Persist extracted memories through deterministic write tool.",
  inputSchema: extractionAgentOutputSchema,
  outputSchema: z.object({
    processedCount: z.number().int().min(0),
    extractedCount: z.number().int().min(0),
    summary: z.string(),
  }),
  execute: async ({ inputData }) => {
    const applied = await applyExtractedMemoriesTool.execute({
      context: {
        sourceId: inputData.sourceId,
        sourceVersion: inputData.sourceVersion,
        extractedMemories: inputData.memories,
        allowEmpty: false,
        metadata: {
          writtenBy: "memory-extraction-workflow",
        },
      },
    });
    return {
      processedCount: inputData.memories.length,
      extractedCount: applied.extractedCount,
      summary: `persisted ${applied.extractedCount} extracted memories`,
    };
  },
});

const organizerLoadStep = createStep({
  id: "organizer-load-memory-batch",
  description: "Load memory batch for organizer agent decisioning.",
  inputSchema: workflowInputSchema,
  outputSchema: memoryBatchOutputSchema,
  execute: async ({ inputData }) => listMemoryBatchTool.execute({ context: { limit: inputData.limit } }),
});

const organizerAgentStep = createStep({
  id: "organizer-agent-decision",
  description: "Generate organizer decisions as schema-validated structured output.",
  inputSchema: memoryBatchOutputSchema,
  outputSchema: organizerDecisionSchema,
  execute: async ({ inputData }) => runMemoryOrganizerAgent({ records: inputData.records }),
});

const organizerApplyStep = createStep({
  id: "organizer-apply-decisions",
  description: "Persist organizer decisions through deterministic write paths.",
  inputSchema: organizerDecisionSchema,
  outputSchema: z.object({
    processedCount: z.number().int().min(0),
    summary: z.string(),
    appliedCategoryCount: z.number().int().min(0),
    appliedRelationCount: z.number().int().min(0),
  }),
  execute: async ({ inputData }) => {
    const applied = await applyOrganizerDecisionsTool.execute({
      context: {
        categoryAssignments: inputData.categoryAssignments,
        relatedLinks: inputData.relatedLinks,
        assignmentSource: "organizer_agent",
      },
    });
    return {
      processedCount: inputData.categoryAssignments.length,
      summary: `applied ${applied.appliedCategoryCount} category assignments and ${applied.appliedRelationCount} related-memory links`,
      appliedCategoryCount: applied.appliedCategoryCount,
      appliedRelationCount: applied.appliedRelationCount,
    };
  },
});

const consolidatorLoadStep = createStep({
  id: "consolidator-load-memory-batch",
  description: "Load memory batch for consolidator alias proposal decisioning.",
  inputSchema: workflowInputSchema,
  outputSchema: memoryBatchOutputSchema,
  execute: async ({ inputData }) => listMemoryBatchTool.execute({ context: { limit: inputData.limit } }),
});

const consolidatorAgentStep = createStep({
  id: "consolidator-agent-decision",
  description: "Generate consolidation alias proposals as schema-validated structured output.",
  inputSchema: memoryBatchOutputSchema,
  outputSchema: consolidatorDecisionSchema,
  execute: async ({ inputData }) => runMemoryConsolidatorAgent({ records: inputData.records }),
});

const consolidatorApplyStep = createStep({
  id: "consolidator-apply-alias-proposals",
  description: "Persist consolidator alias proposals through deterministic write paths.",
  inputSchema: consolidatorDecisionSchema,
  outputSchema: z.object({
    processedCount: z.number().int().min(0),
    summary: z.string(),
    appliedAliasCount: z.number().int().min(0),
  }),
  execute: async ({ inputData }) => {
    const applied = await applyConsolidatorAliasesTool.execute({
      context: {
        aliasProposals: inputData.aliasProposals,
        proposalSource: "consolidator_agent",
        defaultIsActive: false,
      },
    });
    return {
      processedCount: inputData.aliasProposals.length,
      summary: `persisted ${applied.appliedAliasCount} alias proposals`,
      appliedAliasCount: applied.appliedAliasCount,
    };
  },
});

export const organizerWorkflow = createWorkflow({
  id: "memory-organizer-workflow",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    processedCount: z.number().int().min(0),
    summary: z.string(),
    appliedCategoryCount: z.number().int().min(0),
    appliedRelationCount: z.number().int().min(0),
  }),
  // Cron hint; use Inngest-backed scheduling when dependency wiring is enabled.
  cron: "*/10 * * * *",
})
  .then(organizerLoadStep)
  .then(organizerAgentStep)
  .then(organizerApplyStep)
  .commit();

export const extractionWorkflow = createWorkflow({
  id: "memory-extraction-workflow",
  inputSchema: extractionWorkflowInputSchema,
  outputSchema: z.object({
    processedCount: z.number().int().min(0),
    extractedCount: z.number().int().min(0),
    summary: z.string(),
  }),
})
  .then(extractionLoadStep)
  .then(extractionAgentStep)
  .then(extractionApplyStep)
  .commit();

export const consolidatorWorkflow = createWorkflow({
  id: "memory-consolidator-workflow",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    processedCount: z.number().int().min(0),
    summary: z.string(),
    appliedAliasCount: z.number().int().min(0),
  }),
  cron: "*/30 * * * *",
})
  .then(consolidatorLoadStep)
  .then(consolidatorAgentStep)
  .then(consolidatorApplyStep)
  .commit();
