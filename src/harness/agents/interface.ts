import type { DiagnosisOutput } from "../guardrails/schema";
import type { MaterialSnapshot } from "../material/store";
import type { DiagnosisInput, ProgressEvent } from "../types";

export type AgentFeedback =
  | { kind: "rewrite"; issues: string[]; previousDraft: DiagnosisOutput }
  | { kind: "gather_more"; reason: string }
  | { kind: "human_answers"; answers: Record<string, string> };

export interface AgentExecutionResult {
  draft: DiagnosisOutput;
  investigationNotes?: string;
  iterations: number;
  modelId: string;
}

export interface ToolLogger {
  tool: (name: string, detail: string, durationMs?: number) => void;
  search: (query: string, resultCount: number, offline: boolean) => void;
  iteration: (count: number) => void;
  setOfflineMode: (offline: boolean) => void;
}

export interface HarnessToolRegistry {
  tools: Record<string, unknown>;
  contextJson: string;
}

export interface AgentExecutionContext {
  input: DiagnosisInput;
  material: MaterialSnapshot;
  feedback?: AgentFeedback;
  tools: HarnessToolRegistry;
  signal: AbortSignal;
  emitProgress: (event: ProgressEvent) => void;
  toolLogger: ToolLogger;
}

export interface DiagnosticAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  execute(ctx: AgentExecutionContext): Promise<AgentExecutionResult>;
}
