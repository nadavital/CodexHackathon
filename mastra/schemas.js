import { z } from "zod";

const memoryIdSchema = z.string().min(1);
const topLevelBucketSchema = z.enum([
  "preferences",
  "people",
  "commitments",
  "decisions",
  "knowledge",
  "resources",
  "events",
  "inbox",
]);
const confidenceSchema = z.number().min(0).max(1);
const extractedKindSchema = z.enum([
  "preferences",
  "people",
  "commitments",
  "decisions",
  "knowledge",
  "resources",
  "events",
  "inbox",
]);

export const memoryRecordSchema = z.object({
  memoryId: memoryIdSchema,
  sourceId: z.string().min(1),
  latestVersion: z.number().int().min(1),
  effectiveTitle: z.string().nullable().optional(),
  effectiveSummary: z.string().nullable().optional(),
  effectiveTags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const organizerInputSchema = z.object({
  records: z.array(memoryRecordSchema).max(250),
});

export const organizerDecisionSchema = z.object({
  categoryAssignments: z
    .array(
      z.object({
        memoryId: memoryIdSchema,
        bucket: topLevelBucketSchema,
        confidence: confidenceSchema.optional(),
        reason: z.string().max(240).optional(),
      })
    )
    .max(300)
    .default([]),
  relatedLinks: z
    .array(
      z.object({
        memoryId: memoryIdSchema,
        relatedMemoryId: memoryIdSchema,
        confidence: confidenceSchema.optional(),
        reason: z.string().max(240).optional(),
      })
    )
    .max(1000)
    .default([]),
  summary: z.string().max(400).optional(),
});

export const consolidatorInputSchema = z.object({
  records: z.array(memoryRecordSchema).max(250),
});

export const consolidatorDecisionSchema = z.object({
  aliasProposals: z
    .array(
      z.object({
        canonicalMemoryId: memoryIdSchema,
        aliasMemoryId: memoryIdSchema,
        confidence: confidenceSchema.optional(),
        reason: z.string().max(240).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .max(500)
    .default([]),
  summary: z.string().max(400).optional(),
});

export const extractorInputSchema = z.object({
  sourceId: z.string().min(1),
  sourceFilename: z.string().min(1),
  sourceVersion: z.number().int().min(1),
  markdown: z.string().min(1),
});

export const extractedMemorySchema = z.object({
  kind: extractedKindSchema,
  statement: z.string().min(10).max(600),
  title: z.string().max(140).optional(),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
  confidence: confidenceSchema.optional(),
  evidenceText: z.string().max(400).optional(),
});

export const extractorDecisionSchema = z.object({
  memories: z.array(extractedMemorySchema).max(50).default([]),
  summary: z.string().max(400).optional(),
});

export const applyExtractorInputSchema = z.object({
  sourceId: z.string().min(1),
  sourceVersion: z.number().int().min(1),
  extractedMemories: z.array(extractedMemorySchema).max(50),
  allowEmpty: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const applyExtractorOutputSchema = z.object({
  extractedCount: z.number().int().min(0),
});

export const applyOrganizerInputSchema = z.object({
  categoryAssignments: organizerDecisionSchema.shape.categoryAssignments,
  relatedLinks: organizerDecisionSchema.shape.relatedLinks,
  assignmentSource: z.string().min(1).default("organizer_agent"),
});

export const applyOrganizerOutputSchema = z.object({
  appliedCategoryCount: z.number().int().min(0),
  appliedRelationCount: z.number().int().min(0),
});

export const applyConsolidatorInputSchema = z.object({
  aliasProposals: consolidatorDecisionSchema.shape.aliasProposals,
  proposalSource: z.string().min(1).default("consolidator_agent"),
  defaultIsActive: z.boolean().default(false),
});

export const applyConsolidatorOutputSchema = z.object({
  appliedAliasCount: z.number().int().min(0),
});
