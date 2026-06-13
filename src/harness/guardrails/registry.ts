import type { DiagnosisOutput } from "./schema";
import { diagnosisSchema } from "./schema";
import type { DiagnosisInput } from "../types";
import { validateDiagnosis, validateInput, type ValidationResult } from "./validator";

export type GuardrailStage = "pre-agent" | "post-agent";

export interface GuardrailDefinition {
  id: string;
  stage: GuardrailStage;
  description: string;
}

export const GUARDRAIL_DEFINITIONS: GuardrailDefinition[] = [
  {
    id: "input-scope",
    stage: "pre-agent",
    description: "No bypass/EV keywords; symptoms required",
  },
  {
    id: "output-schema",
    stage: "post-agent",
    description: "Diagnosis output must pass Zod diagnosisSchema",
  },
  {
    id: "output-safety",
    stage: "post-agent",
    description: "Blocklist regex and safety notes on risky steps",
  },
  {
    id: "confidence-floor",
    stage: "post-agent",
    description: "Low confidence requires at least one cited source",
  },
];

export function runInputGuardrails(input: DiagnosisInput): ValidationResult {
  return validateInput(input);
}

export function runOutputGuardrails(output: DiagnosisOutput): ValidationResult {
  const base = validateDiagnosis(output);
  const issues = [...base.issues];

  const schemaResult = diagnosisSchema.safeParse(output);
  if (!schemaResult.success && !issues.some((i) => i.startsWith("Schema validation"))) {
    issues.push(`Schema validation failed: ${schemaResult.error.message}`);
  }

  if (output.confidence === "low" && output.sources.length === 0) {
    issues.push(
      "Low confidence diagnosis requires at least one cited source or human clarification",
    );
  }

  return { valid: issues.length === 0, issues };
}
