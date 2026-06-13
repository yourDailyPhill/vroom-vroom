import type { HarnessAlarm } from "../alarms/types";
import type { CheckpointResult } from "../checkpoints/definitions";
import type { DiagnosisOutcome, DiagnosisTrace, TraceEntry } from "../types";
import { DEFAULT_GEMINI_MODEL } from "../config/model";

export interface StructuredLog {
  requestId: string;
  agentId: string;
  agentName: string;
  vin?: string;
  dtcs: string[];
  symptoms: string;
  toolCalls: Array<{ name: string; detail: string; durationMs?: number }>;
  webSearches: Array<{ query: string; resultCount: number; offline: boolean }>;
  loopIterations: number;
  guardrailHits: string[];
  checkpointResults: CheckpointResult[];
  alarms: HarnessAlarm[];
  latencyMs: number;
  modelId: string;
  offlineMode: boolean;
  outcome?: DiagnosisOutcome;
  timestamp: string;
}

export class DiagnosisLogger {
  readonly requestId: string;
  private entries: TraceEntry[] = [];
  private toolCallCount = 0;
  private webSearchCount = 0;
  private guardrailHits: string[] = [];
  private checkpointResults: CheckpointResult[] = [];
  private alarms: HarnessAlarm[] = [];
  private loopIterations = 0;
  private startTime = Date.now();
  private vin?: string;
  private dtcs: string[] = [];
  private symptoms = "";
  private agentId = "unknown";
  private agentName = "unknown";
  private modelId = DEFAULT_GEMINI_MODEL;
  private offlineMode = false;
  private onTrace?: (entry: TraceEntry) => void;

  constructor(
    requestId: string,
    options?: { onTrace?: (entry: TraceEntry) => void },
  ) {
    this.requestId = requestId;
    this.onTrace = options?.onTrace;
  }

  setAgent(agentId: string, agentName: string): void {
    this.agentId = agentId;
    this.agentName = agentName;
  }

  setInput(params: {
    symptoms: string;
    vin?: string;
    dtcs?: string[];
  }): void {
    this.symptoms = params.symptoms;
    this.vin = params.vin;
    this.dtcs = params.dtcs ?? [];
  }

  setModelId(modelId: string): void {
    this.modelId = modelId;
  }

  setOfflineMode(offline: boolean): void {
    this.offlineMode = offline;
  }

  status(message: string): void {
    this.addEntry({ type: "status", name: "status", detail: message });
  }

  tool(name: string, detail: string, durationMs?: number): void {
    this.toolCallCount += 1;
    this.addEntry({ type: "tool", name, detail, durationMs });
  }

  search(query: string, resultCount: number, offline: boolean): void {
    this.webSearchCount += 1;
    this.addEntry({
      type: "search",
      name: "searchWeb",
      detail: `${query} → ${resultCount} results${offline ? " (offline)" : ""}`,
    });
  }

  guardrail(hit: string): void {
    this.guardrailHits.push(hit);
    this.addEntry({ type: "guardrail", name: "validator", detail: hit });
  }

  checkpoint(result: CheckpointResult): void {
    this.checkpointResults.push(result);
    this.addEntry({
      type: "checkpoint",
      name: result.checkpointId,
      detail: result.passed ? "PASS" : `FAIL: ${result.failures.join("; ")}`,
    });
  }

  alarm(alarm: HarnessAlarm): void {
    this.alarms.push(alarm);
    this.addEntry({
      type: "alarm",
      name: alarm.type,
      detail: alarm.recommendedAction,
    });
  }

  iteration(count: number): void {
    this.loopIterations = count;
  }

  error(message: string): void {
    this.addEntry({ type: "error", name: "error", detail: message });
  }

  private addEntry(partial: Omit<TraceEntry, "timestamp">): void {
    const entry: TraceEntry = {
      ...partial,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    this.onTrace?.(entry);
  }

  buildTrace(): DiagnosisTrace {
    return {
      requestId: this.requestId,
      agentId: this.agentId,
      agentName: this.agentName,
      entries: this.entries,
      toolCallCount: this.toolCallCount,
      webSearchCount: this.webSearchCount,
      guardrailHits: this.guardrailHits,
      checkpointResults: this.checkpointResults,
      alarms: this.alarms,
      loopIterations: this.loopIterations,
      latencyMs: Date.now() - this.startTime,
      modelId: this.modelId,
      offlineMode: this.offlineMode,
    };
  }

  flush(outcome?: DiagnosisOutcome): StructuredLog {
    const trace = this.buildTrace();
    const log: StructuredLog = {
      requestId: this.requestId,
      agentId: this.agentId,
      agentName: this.agentName,
      vin: this.vin,
      dtcs: this.dtcs,
      symptoms: this.symptoms,
      toolCalls: trace.entries
        .filter((e) => e.type === "tool")
        .map((e) => ({
          name: e.name,
          detail: e.detail,
          durationMs: e.durationMs,
        })),
      webSearches: trace.entries
        .filter((e) => e.type === "search")
        .map((e) => ({
          query: e.detail.split(" → ")[0] ?? e.detail,
          resultCount: parseInt(e.detail.match(/→ (\d+) results/)?.[1] ?? "0", 10),
          offline: e.detail.includes("(offline)"),
        })),
      loopIterations: trace.loopIterations,
      guardrailHits: trace.guardrailHits,
      checkpointResults: trace.checkpointResults,
      alarms: trace.alarms,
      latencyMs: trace.latencyMs,
      modelId: trace.modelId,
      offlineMode: trace.offlineMode,
      outcome,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify({ level: "info", event: "diagnosis_complete", ...log }));
    return log;
  }
}
