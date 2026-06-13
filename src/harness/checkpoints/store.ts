import type { DiagnosisOutput } from "../guardrails/schema";
import type { MaterialSnapshot } from "../material/store";
import type { DiagnosisInput } from "../types";
import type { CheckpointId, CheckpointResult } from "./definitions";

export interface CheckpointRecord {
  checkpointId: CheckpointId;
  result: CheckpointResult;
  materialSnapshot: MaterialSnapshot;
  draft?: DiagnosisOutput;
  completedStages: string[];
}

export interface RunState {
  requestId: string;
  input: DiagnosisInput;
  agentId: string;
  records: CheckpointRecord[];
}

const runStore = new Map<string, RunState>();

export class CheckpointStore {
  private requestId: string;
  private input: DiagnosisInput;
  private agentId: string;
  private records: CheckpointRecord[] = [];

  constructor(requestId: string, input: DiagnosisInput, agentId: string) {
    this.requestId = requestId;
    this.input = input;
    this.agentId = agentId;
  }

  save(params: {
    checkpointId: CheckpointId;
    result: CheckpointResult;
    materialSnapshot: MaterialSnapshot;
    draft?: DiagnosisOutput;
    completedStages: string[];
  }): void {
    const record: CheckpointRecord = {
      checkpointId: params.checkpointId,
      result: params.result,
      materialSnapshot: structuredClone(params.materialSnapshot),
      draft: params.draft ? structuredClone(params.draft) : undefined,
      completedStages: [...params.completedStages],
    };
    this.records.push(record);
    runStore.set(this.requestId, {
      requestId: this.requestId,
      input: this.input,
      agentId: this.agentId,
      records: [...this.records],
    });
  }

  getRecords(): CheckpointResult[] {
    return this.records.map((r) => r.result);
  }

  static getRun(requestId: string): RunState | undefined {
    return runStore.get(requestId);
  }

  static replayFrom(
    requestId: string,
    checkpointId: CheckpointId,
  ): CheckpointRecord | undefined {
    const run = runStore.get(requestId);
    if (!run) return undefined;
    return run.records.find((r) => r.checkpointId === checkpointId);
  }
}
