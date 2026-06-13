export type AlarmSeverity = "info" | "warning" | "critical";

export interface HarnessAlarm {
  type: string;
  severity: AlarmSeverity;
  context: Record<string, unknown>;
  recommendedAction: string;
}

export type AlarmType =
  | "guardrail_violation"
  | "checkpoint_failed"
  | "service_error"
  | "human_escalation"
  | "material_incomplete";
