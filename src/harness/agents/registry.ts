import type { DiagnosticAgent } from "./interface";
import { singlePassAgent } from "./single-pass-agent";
import { toolCallingAgent } from "./tool-calling-agent";

const AGENTS: Record<string, DiagnosticAgent> = {
  "tool-calling": toolCallingAgent,
  "single-pass": singlePassAgent,
};

export const DEFAULT_AGENT_ID = "tool-calling";

export function listAgents(): DiagnosticAgent[] {
  return Object.values(AGENTS);
}

export function resolveAgent(id?: string): DiagnosticAgent {
  const resolved = id ?? process.env.DIAGNOSTIC_AGENT ?? DEFAULT_AGENT_ID;
  const agent = AGENTS[resolved];
  if (!agent) {
    throw new Error(
      `Unknown agent "${resolved}". Available: ${Object.keys(AGENTS).join(", ")}`,
    );
  }
  return agent;
}
