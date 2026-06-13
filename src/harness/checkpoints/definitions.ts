export type CheckpointId =
  | "input_valid"
  | "material_ready"
  | "agent_produced_draft"
  | "output_safe";

export interface CheckpointDefinition {
  id: CheckpointId;
  afterStage: string;
  description: string;
}

export const CHECKPOINT_DEFINITIONS: CheckpointDefinition[] = [
  {
    id: "input_valid",
    afterStage: "input_received",
    description: "Input passes declared pre-agent guardrails",
  },
  {
    id: "material_ready",
    afterStage: "prefetch",
    description: "Context pack built; vehicle valid if VIN given or symptoms matched",
  },
  {
    id: "agent_produced_draft",
    afterStage: "agent_execute",
    description: "Agent returned a non-null, schema-parseable draft",
  },
  {
    id: "output_safe",
    afterStage: "guardrails",
    description: "All post-agent guardrails pass",
  },
];

export interface CheckpointResult {
  checkpointId: CheckpointId;
  passed: boolean;
  failures: string[];
  timestamp: string;
}

export interface HumanEscalation {
  questions: string[];
  reason: string;
}
