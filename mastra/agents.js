import { Agent } from "@mastra/core/agent";
import { hasOpenAI } from "../src/openai.js";
import { consolidatorDecisionSchema, extractorDecisionSchema, organizerDecisionSchema } from "./schemas.js";

function fallbackOrganizer(records = []) {
  const categoryAssignments = records.slice(0, 100).map((record) => ({
    memoryId: record.memoryId,
    bucket: "inbox",
    confidence: 0.25,
    reason: "fallback_default",
  }));
  return {
    categoryAssignments,
    relatedLinks: [],
    summary: "fallback organizer output used because model is unavailable",
  };
}

function fallbackConsolidator(records = []) {
  return {
    aliasProposals: [],
    summary: `fallback consolidator output used with ${records.length} records`,
  };
}

export const memoryOrganizerAgent = new Agent({
  id: "memory-organizer-agent",
  name: "Memory Organizer Agent",
  instructions: [
    "You classify consumer memory items into top-level buckets and suggest related-memory links.",
    "Never invent memory IDs. Only use memory IDs present in the input.",
    "Prefer conservative links with explicit confidence when uncertain.",
    "Return only structured output that matches the provided schema.",
  ].join("\n"),
  model: "openai/gpt-5.1",
});

export const memoryConsolidatorAgent = new Agent({
  id: "memory-consolidator-agent",
  name: "Memory Consolidator Agent",
  instructions: [
    "You propose duplicate/alias candidates for memory sources.",
    "Avoid aggressive merges. Favor high-confidence duplicate pairs only.",
    "Set isActive false for review-first behavior unless exact duplicate confidence is very high.",
    "Return only structured output that matches the provided schema.",
  ].join("\n"),
  model: "openai/gpt-5.1",
});

export const memoryExtractorAgent = new Agent({
  id: "memory-extractor-agent",
  name: "Memory Extractor Agent",
  instructions: [
    "Extract atomic user memory units from input markdown.",
    "A memory unit must be concise, standalone, and useful for future personalization.",
    "Prefer durable facts, preferences, commitments, decisions, events, people context, and high-value knowledge/resources.",
    "Do not copy full paragraphs verbatim. Produce short normalized statements.",
    "Return only structured output that matches the provided schema.",
  ].join("\n"),
  model: "openai/gpt-5.1",
});

export async function runMemoryOrganizerAgent({ records }) {
  if (!hasOpenAI()) {
    return organizerDecisionSchema.parse(fallbackOrganizer(records));
  }

  const prompt = [
    "Classify each memory record into one top-level bucket and suggest related links where justified.",
    "Buckets: preferences, people, commitments, decisions, knowledge, resources, events, inbox.",
    "Input records JSON:",
    JSON.stringify(records),
  ].join("\n\n");

  const response = await memoryOrganizerAgent.generate(prompt, {
    structuredOutput: {
      schema: organizerDecisionSchema,
      errorStrategy: "strict",
    },
  });

  return organizerDecisionSchema.parse(response.object);
}

export async function runMemoryConsolidatorAgent({ records }) {
  if (!hasOpenAI()) {
    return consolidatorDecisionSchema.parse(fallbackConsolidator(records));
  }

  const prompt = [
    "Find likely duplicate/alias memory pairs for review-first consolidation.",
    "Do not merge automatically. Focus on high-confidence pairs and provide concise reasons.",
    "Input records JSON:",
    JSON.stringify(records),
  ].join("\n\n");

  const response = await memoryConsolidatorAgent.generate(prompt, {
    structuredOutput: {
      schema: consolidatorDecisionSchema,
      errorStrategy: "strict",
    },
  });

  return consolidatorDecisionSchema.parse(response.object);
}

export async function runMemoryExtractorAgent({ sourceId, sourceFilename, sourceVersion, markdown }) {
  if (!hasOpenAI()) {
    throw new Error("OPENAI_API_KEY is required for memory extraction.");
  }

  const prompt = [
    "Extract atomic memories from this source.",
    "Output each memory as one concise statement with category and optional tags/evidence excerpt.",
    "Source context:",
    JSON.stringify({
      sourceId,
      sourceFilename,
      sourceVersion,
    }),
    "Markdown:",
    markdown,
  ].join("\n\n");

  const response = await memoryExtractorAgent.generate(prompt, {
    temperature: 0,
    structuredOutput: {
      schema: extractorDecisionSchema,
      errorStrategy: "strict",
    },
  });

  return extractorDecisionSchema.parse(response.object);
}
