import { Mastra } from "@mastra/core";
import { memoryConsolidatorAgent, memoryExtractorAgent, memoryOrganizerAgent } from "./agents.js";
import { organizerWorkflow, extractionWorkflow, consolidatorWorkflow } from "./workflows.js";

// This file intentionally keeps Mastra focused on orchestration.
// Core memory state and writes live in src/memoryService.js.
export const mastra = new Mastra({
  agents: {
    memoryOrganizerAgent,
    memoryConsolidatorAgent,
    memoryExtractorAgent,
  },
  workflows: {
    extractionWorkflow,
    organizerWorkflow,
    consolidatorWorkflow,
  },
});
